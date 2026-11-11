import PublishIcon from "@mui/icons-material/Publish";
import SearchIcon from "@mui/icons-material/Search";
import CheckIcon from "@mui/icons-material/CheckCircleOutlined";
import WarningIcon from "@mui/icons-material/WarningAmber";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  Menu,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { useCanEdit } from "../components/ReadOnly";
import { UnpublishDialog, type UnpublishImpact } from "../components/UnpublishDialog";
import type { SlotRow } from "../lib/baseSchedule";
import type { TaskType } from "../lib/catalog";
import type { Cycle } from "../lib/cycles";
import { TZ, dayKey } from "../lib/dates";
import { fairRows, shortGroupName, verdicts, type FairRow } from "../lib/fairness";
import {
  ROLE_LABEL,
  byProfile,
  bySlot,
  loads,
  rankCandidates,
  summarizeReasons,
  type SlotView,
  type Candidate,
  type DraftAssignment,
  type Role,
} from "../lib/draft";
import { effective, REASON_LABEL, reasonText, type PotentialCell, type SnapshotSoldier } from "../lib/potential";
import { prevCycle, prevMean, previousCycle, type PrevCycle } from "../lib/prevCycle";
import { eligibilityOf, noWork, noWorkGroups, noWorkText, slotsByCategory, type EligRow } from "../lib/eligibility";
import type { ExistingSoldier } from "../lib/roster";
import { poolName, poolNames } from "../lib/schedule";

const dayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" });
const hm = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dm = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric" });
const span = (a: string, b: string) => {
  const sameDay = dayKey(a) === dayKey(b);
  return `${hm.format(new Date(a))} – ${sameDay ? "" : dm.format(new Date(b)) + " "}${hm.format(new Date(b))}`;
};

function Loading() {
  return (
    <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

export interface Ctx {
  cycle: Cycle;
  slots: SlotRow[];
  tasks: Map<string, TaskType>;
  soldiers: Map<string, ExistingSoldier>;
  assignments: DraftAssignment[];
  reload: () => void;
  locked: boolean;
}

// ---------------------------------------------------------------------------
// Assign / replace dialog
// ---------------------------------------------------------------------------

/**
 * Picks a soldier for a duty: candidates ranked by fit and load, with what each one breaks.
 * Before publishing it edits the draft (a reason always); after publishing ("published") it puts
 * the soldier straight onto the board, and asks for a reason only when a rule is broken.
 */
export function AssignDialog(props: { ctx: Ctx; slot: SlotRow; role: Role; current: DraftAssignment | null; onClose: () => void; published?: boolean }) {
  const { api } = useAuth();
  const { ctx, slot, current } = props;
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api!
      .slotCandidates(slot.id)
      .then((c) => setCands(rankCandidates(c)))
      .catch((e) => setError((e as Error).message));
  }, [api, slot.id]);

  const shown = (cands ?? []).filter((c) => {
    const s = ctx.soldiers.get(c.soldier_id);
    if (q && !s?.full_name.includes(q.trim())) return false;
    if (!showAll && (c.reasons.length > 0 || c.in_slot)) return false;
    return true;
  });

  async function run(f: () => Promise<unknown>) {
    if (!reason.trim() && (!props.published || warn)) return setError(props.published ? "החייל מפר כלל – חובה לכתוב סיבה" : "חובה לכתוב נימוק");
    setBusy(true);
    setError(null);
    try {
      await f();
      props.onClose();
      ctx.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const task = ctx.tasks.get(slot.task_type_id);
  const warn = chosen && (chosen.reasons.length > 0 || chosen.conflicts.length > 0);

  return (
    <Dialog open onClose={props.onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>
        {current ? `החלפת ${ROLE_LABEL[current.role]}` : `שיבוץ ${ROLE_LABEL[props.role]}`} – {task?.name}
        <Typography variant="body2" color="text.secondary">
          {dayFmt.format(new Date(slot.starts_at))}, {span(slot.starts_at, slot.ends_at)}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {current && (
            <Alert severity="info" icon={false}>
              <b>{ctx.soldiers.get(current.soldier_id)?.full_name}</b> · {current.explanation}
            </Alert>
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <TextField
              size="small"
              placeholder="חיפוש לפי שם"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
              sx={{ flex: 1, minWidth: 160 }}
            />
            <FormControlLabel control={<Switch checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />} label="גם לא זכאים" />
          </Stack>
          {!cands ? (
            <Loading />
          ) : (
            <List dense sx={{ maxHeight: 340, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
              {shown.slice(0, 150).map((c) => {
                const s = ctx.soldiers.get(c.soldier_id);
                const bad = c.reasons.length > 0;
                return (
                  <ListItemButton key={c.soldier_id} selected={chosen?.soldier_id === c.soldier_id} onClick={() => setChosen(c)} disabled={!!c.in_slot}>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                          <span>{s?.full_name ?? "?"}</span>
                          <Typography component="span" variant="caption" color="text.secondary">
                            {s?.gaf_name} · {s?.rank_name}
                          </Typography>
                          {c.in_slot && <Chip size="small" label={`כבר ${ROLE_LABEL[c.in_slot]}`} />}
                          {bad && <Chip size="small" color="error" variant="outlined" label="לא זכאי" />}
                          {c.conflicts.length > 0 && <Chip size="small" color="warning" variant="outlined" label="חופף" />}
                        </Stack>
                      }
                      secondary={
                        <>
                          ניקוד צפוי {c.cycle_points.toFixed(1)} · {c.cycle_duties} תורנויות במחזור
                          {bad && ` · ${reasonText(c.reasons)}`}
                          {c.conflicts.length > 0 &&
                            ` · ${c.conflicts.map((x) => `${x.task} ${dm.format(new Date(x.starts_at))}`).join(", ")}`}
                        </>
                      }
                    />
                  </ListItemButton>
                );
              })}
              {shown.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                  אין חיילים זכאים פנויים. הפעל "גם לא זכאים" כדי לראות את כולם והסיבות.
                </Typography>
              )}
            </List>
          )}
          {warn && (
            <Alert severity="warning">
              {chosen!.reasons.length > 0 && <div>לא זכאי: {reasonText(chosen!.reasons)}.</div>}
              {chosen!.conflicts.length > 0 && <div>חופף לתורנות אחרת.</div>}
              אפשר לשבץ בכל זאת – {props.published ? "עם סיבה, שנשמרת ביומן" : "הנימוק נשמר ביומן"}.
            </Alert>
          )}
          <TextField
            label={props.published ? (warn ? "סיבה (חובה – החייל מפר כלל)" : "הערה (לא חובה)") : "נימוק (חובה)"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {current && (
          <Button color="error" disabled={busy} onClick={() => run(() => api!.removeAssignment(current.id, reason))} sx={{ ml: "auto" }}>
            הסרה בלי מחליף
          </Button>
        )}
        <Button onClick={props.onClose}>ביטול</Button>
        <Button
          variant="contained"
          disabled={busy || !chosen}
          onClick={() =>
            run(() =>
              props.published
                ? api!.assignPublished(slot.id, props.role, chosen!.soldier_id, reason.trim() || null)
                : api!.manualAssign(slot.id, props.role, chosen!.soldier_id, current?.id ?? null, reason),
            )
          }
        >
          {current ? "החלפה" : "שיבוץ"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// By slot
// ---------------------------------------------------------------------------

type BoardFilter = "" | "missing" | "manual" | "weekend";

/**
 * The whole cycle as one list, day by day (the day stays on top while scrolling). One search finds
 * a soldier, a duty or a date ("6.1"); chips narrow to gaps, manual changes or weekends. A name
 * opens a menu: the soldier's details, or replacing him.
 */
function BoardView({
  ctx,
  q,
  filter,
  setFilter,
  who,
  setWho,
  onOpenSoldier,
}: {
  ctx: Ctx;
  q: string;
  filter: BoardFilter;
  setFilter: (f: BoardFilter) => void;
  who: string | null;
  setWho: (id: string | null) => void;
  onOpenSoldier: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ slot: SlotRow; role: Role; current: DraftAssignment | null } | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; a: DraftAssignment; slot: SlotRow } | null>(null);
  const views = useMemo(() => bySlot(ctx.slots, ctx.assignments), [ctx.slots, ctx.assignments]);
  const name = (id: string) => ctx.soldiers.get(id)?.full_name ?? "";
  const terms = q.trim().split(/\s+/).filter(Boolean);
  const dateWords = (iso: string) => {
    const [y, m, d] = dayKey(iso).split("-").map(Number);
    return `${d}.${m} ${d}/${m} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} ${d}.${m}.${y}`;
  };
  const isWeekend = (k: SlotRow, v: SlotView) =>
    [...v.performers, ...v.reserves].some((a) => (a.weekend_units ?? 0) > 0) || [5, 6].includes(new Date(dayKey(k.starts_at) + "T12:00:00Z").getUTCDay());

  const counts = { missing: 0, manual: 0, weekend: 0 };
  for (const k of ctx.slots) {
    const v = views.get(k.id)!;
    if (v.missingPerformers + v.missingReserves > 0) counts.missing++;
    if ([...v.performers, ...v.reserves].some((a) => a.source === "manual")) counts.manual++;
    if (isWeekend(k, v)) counts.weekend++;
  }
  const shown = ctx.slots.filter((k) => {
    const v = views.get(k.id)!;
    const people = [...v.performers, ...v.reserves];
    if (who && !people.some((a) => a.soldier_id === who)) return false;
    if (filter === "missing" && v.missingPerformers + v.missingReserves === 0) return false;
    if (filter === "manual" && !people.some((a) => a.source === "manual")) return false;
    if (filter === "weekend" && !isWeekend(k, v)) return false;
    if (terms.length) {
      const hay = [ctx.tasks.get(k.task_type_id)?.name ?? "", ...people.map((a) => name(a.soldier_id)), dateWords(k.starts_at)].join(" ");
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const byDay = new Map<string, SlotRow[]>();
  for (const k of shown) byDay.set(dayKey(k.starts_at), [...(byDay.get(dayKey(k.starts_at)) ?? []), k]);

  const Name = ({ a, slot }: { a: DraftAssignment; slot: SlotRow }) => {
    const s = ctx.soldiers.get(a.soldier_id);
    return (
      <Tooltip title={a.explanation ?? ""}>
        <Chip
          size="small"
          variant={a.role === "performer" ? "filled" : "outlined"}
          color={a.source === "manual" ? "secondary" : "default"}
          label={`${a.role === "reserve" ? "עתודה: " : ""}${s?.full_name ?? "?"}`}
          onClick={(e) => setMenu({ el: e.currentTarget, a, slot })}
          sx={{ maxWidth: "100%" }}
        />
      </Tooltip>
    );
  };
  const Missing = ({ slot, role, n }: { slot: SlotRow; role: Role; n: number }) =>
    n > 0 ? (
      <Chip
        size="small"
        color="error"
        label={`חסר ${ROLE_LABEL[role]}${n > 1 ? ` ×${n}` : ""}`}
        onClick={ctx.locked ? undefined : () => setEditing({ slot, role, current: null })}
      />
    ) : null;
  const chip = (f: BoardFilter, label: string) => (
    <Chip
      key={f || "all"}
      label={label}
      color={filter === f ? "primary" : "default"}
      variant={filter === f ? "filled" : "outlined"}
      onClick={() => setFilter(f)}
    />
  );

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5, "& > *": { flexShrink: 0 } }}>
        {chip("", `הכל · ${ctx.slots.length}`)}
        {counts.missing > 0 && chip("missing", `חסרים · ${counts.missing}`)}
        {counts.manual > 0 && chip("manual", `ידני · ${counts.manual}`)}
        {chip("weekend", `סופ״ש וחגים · ${counts.weekend}`)}
      </Stack>
      {who && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => setWho(null)}>
              הכול
            </Button>
          }
        >
          {shown.length ? (
            <>
              התורנויות של <b>{name(who)}</b> ({shown.length})
            </>
          ) : (
            <>
              ל<b>{name(who)}</b> אין תורנויות בטיוטה.{" "}
              <Button size="small" onClick={() => onOpenSoldier(who)}>
                למה?
              </Button>
            </>
          )}
        </Alert>
      )}
      {shown.length === 0 && !who && <Alert severity="info">אין משבצות שמתאימות לחיפוש.</Alert>}
      {[...byDay].map(([day, list]) => (
        <Box key={day}>
          <Typography
            variant="subtitle1"
            sx={{
              position: "sticky",
              top: { xs: 56, sm: 64 },
              zIndex: 2,
              bgcolor: "background.default",
              py: 0.5,
              fontWeight: 700,
              color: "primary.main",
            }}
          >
            {dayFmt.format(new Date(day + "T12:00:00Z"))}
          </Typography>
          <Stack spacing={1}>
            {list.map((k) => {
              const v = views.get(k.id)!;
              const t = ctx.tasks.get(k.task_type_id);
              return (
                <Paper key={k.id} variant="outlined" sx={{ p: 1.25, borderInlineStart: `4px solid ${t?.color ?? "#999"}`, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.75 }}>
                    <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                      {t?.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                      {span(k.starts_at, k.ends_at)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
                    {v.performers.map((a) => (
                      <Name key={a.id} a={a} slot={k} />
                    ))}
                    <Missing slot={k} role="performer" n={v.missingPerformers} />
                    {v.reserves.map((a) => (
                      <Name key={a.id} a={a} slot={k} />
                    ))}
                    <Missing slot={k} role="reserve" n={v.missingReserves} />
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Box>
      ))}
      <Menu open={!!menu} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            onOpenSoldier(menu!.a.soldier_id);
            setMenu(null);
          }}
        >
          פרטי {name(menu?.a.soldier_id ?? "")}
        </MenuItem>
        {!ctx.locked && (
          <MenuItem
            onClick={() => {
              setEditing({ slot: menu!.slot, role: menu!.a.role, current: menu!.a });
              setMenu(null);
            }}
          >
            החלפה או הסרה
          </MenuItem>
        )}
      </Menu>
      {editing && <AssignDialog ctx={ctx} {...editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Load per soldier
// ---------------------------------------------------------------------------

/** The fairness picture of the draft – shared by the health tile and the soldiers view. */
function useFairness(ctx: Ctx, snapshot: SnapshotSoldier[], cells: PotentialCell[] | null, categories: Map<string, string>, tolerance: number) {
  const ls = useMemo(() => loads(snapshot, ctx.assignments), [snapshot, ctx.assignments]);
  const groupName = useMemo(() => poolNames(snapshot), [snapshot]);
  const rank = useMemo(() => new Map(snapshot.map((s) => [s.soldier_id, s.rank_name])), [snapshot]);
  // the duty categories each soldier is open to, by name (the potential matrix)
  const openNames = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of cells ?? []) if (effective(c) > 0) m.set(c.soldier_id, [...(m.get(c.soldier_id) ?? []), categories.get(c.category_id) ?? "?"]);
    return m;
  }, [cells, categories]);
  const profileOf = useCallback(
    (id: string) => (cells ? [...(openNames.get(id) ?? [])].sort((a, b) => a.localeCompare(b, "he")).join(" + ") : "הכול"),
    [cells, openNames],
  );
  const rows = useMemo(() => fairRows(ls, profileOf, tolerance), [ls, profileOf, tolerance]);
  const verdict = useMemo(() => verdicts(rows), [rows]);
  const outliers = useMemo(() => rows.filter((r) => r.outlier).length, [rows]);
  // what each soldier can be given at all: open categories and the slots the cycle has for them
  const perCategory = useMemo(() => slotsByCategory(ctx.slots, ctx.tasks), [ctx.slots, ctx.tasks]);
  const cellsOf = useMemo(() => {
    const m = new Map<string, PotentialCell[]>();
    for (const c of cells ?? []) m.set(c.soldier_id, [...(m.get(c.soldier_id) ?? []), c]);
    return m;
  }, [cells]);
  const elig = useCallback(
    (id: string): EligRow[] => eligibilityOf(id, cellsOf.get(id) ?? [], categories, perCategory),
    [cellsOf, categories, perCategory],
  );
  const idle = useMemo(
    () => noWorkGroups(snapshot.map((s) => s.soldier_id), elig, (id) => rank.get(id) ?? ""),
    [snapshot, elig, rank],
  );
  return { ls, groupName, rank, openNames, rows, verdict, outliers, tolerance, hasCells: !!cells, elig, idle };
}
type Fairness = ReturnType<typeof useFairness>;

function LoadTab({
  ctx,
  fair,
  q,
  onlyOut,
  setOnlyOut,
  onOpen,
  tash,
  prev,
}: {
  ctx: Ctx;
  fair: Fairness;
  q: string;
  onlyOut: boolean;
  setOnlyOut: (v: boolean) => void;
  onOpen: (soldierId: string) => void;
  tash: Map<string, boolean>;
  prev: PrevCycle | null;
}) {
  const { ls, groupName, rank, openNames, rows, verdict, tolerance } = fair;
  const keys = [...verdict.keys()].sort((a, b) => verdict.get(b)!.soldiers - verdict.get(a)!.soldiers);
  const [picked, setPool] = useState("");
  // "only outliers" from the health tile opens the first group that has some
  const pool = keys.includes(picked) ? picked : (onlyOut ? keys.find((k) => verdict.get(k)!.outliers.length) : undefined) ?? keys[0] ?? "";
  const v = verdict.get(pool);
  const credited = ls.some((l) => l.creditDays > 0);

  const [gaf, setGaf] = useState("");
  const [sort, setSort] = useState<"diff" | "score" | "name">("score");

  const inPool = rows.filter((r) => r.pool === pool);
  const gafim = [...new Set(inPool.map((r) => ctx.soldiers.get(r.soldier_id)?.gaf_name ?? ""))].filter(Boolean).sort();
  const name = (id: string) => ctx.soldiers.get(id)?.full_name ?? "?";
  const shown = inPool
    .filter((r) => (!q || name(r.soldier_id).includes(q.trim())) && (!gaf || ctx.soldiers.get(r.soldier_id)?.gaf_name === gaf) && (!onlyOut || r.outlier))
    .sort((a, b) =>
      sort === "name" ? name(a.soldier_id).localeCompare(name(b.soldier_id), "he") : sort === "diff" ? Math.abs(b.diff) - Math.abs(a.diff) : b.expected - a.expected,
    );
  const top = Math.max(1, ...inPool.map((r) => Math.max(r.expected, r.ref + r.limit)));
  const profiles = fair.hasCells ? byProfile(inPool, (id) => [...(openNames.get(id) ?? [])]) : [];
  const notCompared = inPool.filter((r) => !r.compared).length;
  // a signed number keeps its sign on the left inside Hebrew text
  const sign = (n: number) => `\u2066${n > 0 ? "+" : ""}${n.toFixed(1)}\u2069`;

  const idleCount = fair.idle.reduce((n, g) => n + g.ids.length, 0);

  return (
    <Stack spacing={2}>
      {idleCount > 0 && (
        <Accordion variant="outlined" disableGutters sx={{ borderColor: "warning.light" }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <WarningIcon color="warning" fontSize="small" />
              <Typography variant="subtitle2">
                {idleCount} חיילים בלי אף משימה אפשרית במחזור – לא בגלל האיזון
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                הם לא כשירים לאף קטגוריה, או כשירים רק לקטגוריות שאין להן משבצות במחזור. מה שקובע זה רשימת הדרגות של כל סוג תורנות בקטלוג
                וסוגי המשבצות בלוח הבסיס.
              </Typography>
              {fair.idle.map((g) => (
                <Box key={g.key}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {g.label} ({g.ids.length})
                  </Typography>
                  <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                    {g.ids
                      .map((id) => ({ id, n: name(id) }))
                      .sort((a, b) => a.n.localeCompare(b.n, "he"))
                      .map(({ id, n }) => (
                        <Chip key={id} size="small" variant="outlined" label={`${n} · ${rank.get(id) ?? ""}`} onClick={() => onOpen(id)} />
                      ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {keys.map((p) => {
          const g = verdict.get(p)!;
          const bad = g.outliers.length > 0;
          return (
            <Tooltip key={p} title={poolName(groupName, p)}>
              <Chip
                icon={bad ? <WarningIcon /> : <CheckIcon />}
                label={`${shortGroupName(poolName(groupName, p))} (${g.soldiers})${bad ? ` · ${g.outliers.length} חורגים` : ""}`}
                color={p === pool ? "primary" : bad ? "warning" : "default"}
                variant={p === pool ? "filled" : "outlined"}
                onClick={() => setPool(p)}
              />
            </Tooltip>
          );
        })}
      </Stack>

      {v &&
        (v.outliers.length === 0 ? (
          <Alert severity="success">
            <b>הוגן:</b> כל {v.compared} החיילים שנבדקו בקבוצה בטווח של ±{tolerance}% מממוצע מי שזכאים לאותן תורנויות.
          </Alert>
        ) : (
          <Alert severity="warning">
            <b>{v.outliers.length} חורגים</b> מטווח ±{tolerance}%. הכי רחוק: {name(v.outliers[0].soldier_id)} {sign(v.outliers[0].diff)} נק׳ (ממוצע
            עמיתיו {v.outliers[0].ref.toFixed(1)}).
            <Button size="small" sx={{ mr: 1 }} onClick={() => setOnlyOut(true)}>
              הצגת החורגים
            </Button>
          </Alert>
        ))}

      {prev &&
        (() => {
          const m = prevMean(prev, inPool.map((r) => r.soldier_id));
          const now = inPool.length ? inPool.reduce((n, r) => n + r.points, 0) / inPool.length : 0;
          return (
            <Typography variant="body2" color="text.secondary">
              {m
                ? `רפרנס – ${prev.name}: ממוצע ${m.mean.toFixed(1)} נק׳ לחייל בקבוצה הזו (${m.n} חיילים שהיו בו). במחזור הזה: ${now.toFixed(1)}.`
                : `רפרנס – ${prev.name}: אף חייל בקבוצה הזו לא היה בו.`}
            </Typography>
          );
        })()}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr auto" }, alignItems: "center", mb: 1.5 }}>
          <TextField size="small" select label="גף" value={gaf} onChange={(e) => setGaf(e.target.value)}>
            <MenuItem value="">כל הגפים</MenuItem>
            {gafim.map((g) => (
              <MenuItem key={g} value={g}>
                {g}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" select label="מיון" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <MenuItem value="score">לפי ניקוד</MenuItem>
            <MenuItem value="diff">לפי פער מהממוצע</MenuItem>
            <MenuItem value="name">לפי שם</MenuItem>
          </TextField>
          <FormControlLabel control={<Switch checked={onlyOut} onChange={(e) => setOnlyOut(e.target.checked)} />} label="רק חורגים" />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          הפס = הניקוד הצפוי (קודם + זיכוי + המחזור). הקו = ממוצע מי שזכאים לאותן תורנויות, והרקע סביבו = הטווח המותר. לחיצה על חייל מציגה את
          הפירוט.
        </Typography>
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
          {shown.map((r) => {
            const s = ctx.soldiers.get(r.soldier_id);
            const pct = (n: number) => `${Math.max(0, Math.min(100, (n / top) * 100))}%`;
            return (
              <Box
                key={r.soldier_id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r.soldier_id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(r.soldier_id))}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr 76px", sm: "200px 1fr 92px" },
                  gap: { xs: 0.5, sm: 1.5 },
                  alignItems: "center",
                  py: 0.75,
                  px: 0.5,
                  cursor: "pointer",
                  borderRadius: 1,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: 14 }} noWrap>
                    {s?.full_name}
                    {r.manual > 0 && <Chip size="small" color="secondary" variant="outlined" label="ידני" sx={{ mr: 0.5, height: 18 }} />}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {s?.gaf_name} · {rank.get(r.soldier_id)}
                    {tash.has(r.soldier_id) ? (tash.get(r.soldier_id) ? " · ת״ש 7 (חלק מהמחזור)" : " · ת״ש 7") : ""} · {r.duties} תורנויות
                    {r.weekends ? ` · ${r.weekends} סופ״ש` : ""}
                    {r.reserves ? ` · ${r.reserves} עתודות` : ""}
                    {prev?.members.has(r.soldier_id) ? ` · קודם: ${(prev.load.get(r.soldier_id)?.points ?? 0).toFixed(1)}` : ""}
                  </Typography>
                </Box>
                <Box sx={{ position: "relative", height: 14, gridColumn: { xs: "1 / -1", sm: "auto" }, gridRow: { xs: 2, sm: "auto" } }}>
                  {r.compared && (
                    <Box
                      sx={{
                        position: "absolute",
                        insetInlineStart: pct(Math.max(0, r.ref - r.limit)),
                        width: `calc(${pct(r.ref + r.limit)} - ${pct(Math.max(0, r.ref - r.limit))})`,
                        top: 0,
                        bottom: 0,
                        bgcolor: "action.selected",
                        borderRadius: 0.5,
                      }}
                    />
                  )}
                  <Box
                    sx={{
                      position: "absolute",
                      insetInlineStart: 0,
                      width: pct(r.expected),
                      top: 3,
                      bottom: 3,
                      borderRadius: 0.5,
                      bgcolor: !r.compared ? "grey.400" : r.outlier ? (r.diff > 0 ? "warning.main" : "info.main") : "primary.main",
                    }}
                  />
                  {r.compared && (
                    <Box sx={{ position: "absolute", insetInlineStart: pct(r.ref), top: -2, bottom: -2, width: 2, bgcolor: "text.primary" }} />
                  )}
                </Box>
                <Box sx={{ textAlign: "end" }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{r.expected.toFixed(1)}</Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: !r.compared ? "text.disabled" : r.outlier ? (r.diff > 0 ? "warning.dark" : "info.dark") : "text.secondary" }}
                  >
                    {r.compared ? sign(r.diff) : noWork(fair.elig(r.soldier_id)) ? "אין משימה" : "לא נבדק"}
                  </Typography>
                </Box>
              </Box>
            );
          })}
          {shown.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 2 }}>
              {onlyOut ? "אין חורגים בקבוצה הזו." : "אין חיילים שמתאימים לחיפוש."}
            </Typography>
          )}
        </Stack>
      </Paper>

      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">פירוט לפי קטגוריות{notCompared ? ` · ${notCompared} לא נבדקו` : ""}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              קבוצה = חיילים מאותה אוכלוסייה שיכולים להתחלק בעומס. בתוכה, כל חייל נמדד מול מי שזכאים לאותן קטגוריות תורנות. חייל שלא זכאי לאף
              קטגוריה, או שהוא היחיד בצירוף שלו, לא נבדק.
              {credited && " זיכוי = ימים מחוץ ליחידה שלא מבחירה, כפול העומס היומי הממוצע של הקבוצה."}
            </Typography>
            {profiles.length > 0 && (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {["קטגוריות פתוחות", "חיילים", "ממוצע", "מינימום", "מקסימום"].map((h) => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profiles.map((p) => (
                    <TableRow key={p.key}>
                      <TableCell>{p.key}</TableCell>
                      <TableCell>{p.soldiers}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{p.mean.toFixed(1)}</TableCell>
                      <TableCell>{p.min.toFixed(1)}</TableCell>
                      <TableCell>{p.max.toFixed(1)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>

    </Stack>
  );
}

/** His points in the previous cycle, next to the mean of his peers there. */
function PrevLine({ prev, soldierId, peers }: { prev: PrevCycle; soldierId: string; peers: string[] }) {
  if (!prev.members.has(soldierId)) {
    return (
      <Typography variant="body2" color="text.secondary">
        במחזור הקודם ({prev.name}) הוא לא היה.
      </Typography>
    );
  }
  const mine = prev.load.get(soldierId) ?? { points: 0, duties: 0 };
  const m = prevMean(prev, peers);
  return (
    <Typography variant="body2" color="text.secondary">
      במחזור הקודם ({prev.name}): <b>{mine.points.toFixed(1)} נק׳</b> ב-{mine.duties} תורנויות
      {m ? ` · ממוצע עמיתיו שם: ${m.mean.toFixed(1)}` : ""}.
    </Typography>
  );
}

/** What he can be given in the cycle: rank and service, then each duty category – open or why not. */
function EligibilityCard({ elig, snap, rankName, tash }: { elig: EligRow[]; snap: SnapshotSoldier | undefined; rankName: string; tash?: boolean }) {
  const why = noWorkText(elig, rankName);
  const tags = [
    rankName && `דרגה: ${rankName}`,
    snap && (snap.service_type === "career" ? "קבע" : "חובה"),
    snap?.is_parent && "משרת הורה",
    snap?.qualifies_day_only && !snap.is_parent && "פטור מזכה",
    tash !== undefined && (tash ? "ת״ש 7 בחלק מהמחזור" : "ת״ש 7 – לן בבית"),
  ].filter(Boolean) as string[];
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" gutterBottom>
        כשירות במחזור
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
        {tags.map((t) => (
          <Chip key={t} size="small" label={t} />
        ))}
      </Stack>
      {why && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {why} לכן אין לו תורנויות – זה לא האיזון. משנים ברשימת הדרגות של סוג התורנות בקטלוג או בלוח הבסיס.
        </Alert>
      )}
      {elig.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          הפוטנציאל לא חושב, אז אין פירוט כשירות.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>קטגוריה</TableCell>
              <TableCell>כשיר</TableCell>
              <TableCell>משבצות</TableCell>
              <TableCell>למה לא</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {elig.map((e) => (
              <TableRow key={e.category_id}>
                <TableCell>{e.name}</TableCell>
                <TableCell sx={{ color: e.open ? "success.main" : "text.disabled", whiteSpace: "nowrap" }}>
                  {e.open ? (e.value < 1 ? `חלקית (${Math.round(e.value * 100)}%)` : "כן") : "לא"}
                  {e.override ? " · ידני" : ""}
                </TableCell>
                <TableCell sx={{ color: e.slots === 0 ? "warning.main" : undefined }}>{e.slots}</TableCell>
                <TableCell sx={{ color: "text.secondary", fontSize: 12 }}>
                  {e.open ? (e.slots === 0 ? "אין משבצות במחזור" : "") : reasonText(e.reasons) || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

/** One soldier's load: how the score is built, and his duties in the draft. */
function SoldierLoadDialog(props: {
  ctx: Ctx;
  row: FairRow;
  rankName: string;
  tolerance: number;
  /** his eligibility per duty category (empty when no potential was computed) */
  elig: EligRow[];
  snap: SnapshotSoldier | undefined;
  /** ת"ש 7: undefined = no, false = all the cycle, true = part of it */
  tash: boolean | undefined;
  prev: PrevCycle | null;
  /** the soldiers he is measured against (same group and open categories) */
  peers: string[];
  onClose: () => void;
  onShowSlots: () => void;
}) {
  const { ctx, row: r } = props;
  const { api } = useAuth();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const s = ctx.soldiers.get(r.soldier_id);
  const slotOf = new Map(ctx.slots.map((k) => [k.id, k]));
  // "why few duties": the candidate check of every slot, a few at a time, summed for him
  const [why, setWhy] = useState<{ reason: string; slots: number }[] | null>(null);
  const [whyProgress, setWhyProgress] = useState<number | null>(null);
  async function checkWhy() {
    const ids = ctx.slots.map((k) => k.id);
    const found: (Candidate | undefined)[] = [];
    setWhyProgress(0);
    for (let i = 0; i < ids.length; i += 8) {
      const batch = await Promise.all(ids.slice(i, i + 8).map((id) => api!.slotCandidates(id).catch(() => [] as Candidate[])));
      for (const cs of batch) found.push(cs.find((c) => c.soldier_id === r.soldier_id));
      setWhyProgress(Math.min(ids.length, i + 8) / ids.length);
    }
    setWhy(summarizeReasons(found));
    setWhyProgress(null);
  }
  const WHY_LABEL: Record<string, string> = {
    ...REASON_LABEL,
    busy: "משובץ באותו זמן בתורנות אחרת (כולל מנוחה)",
    assigned: "משובץ בה",
    free: "זכאי ופנוי – המנוע בחר אחרים לטובת האיזון",
  };
  const mine = ctx.assignments
    .filter((a) => a.soldier_id === r.soldier_id && !["dropped", "swapped_out", "cancelled_approved"].includes(a.status))
    .map((a) => ({ a, k: slotOf.get(a.slot_id) }))
    .filter((x) => x.k)
    .sort((x, y) => x.k!.starts_at.localeCompare(y.k!.starts_at));
  return (
    <Dialog open onClose={props.onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>
        {s?.full_name}
        <Typography variant="body2" color="text.secondary">
          {s?.gaf_name} · {props.rankName}
          {r.profile && r.profile !== "הכול" ? ` · זכאי ל: ${r.profile}` : ""}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, textAlign: "center" }}>
            {(
              [
                ["קודם", r.baseline],
                ["זיכוי", r.credit],
                ["במחזור", r.points],
                ["צפוי", r.expected],
              ] as [string, number][]
            ).map(([label, n]) => (
              <Paper key={label} variant="outlined" sx={{ p: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography sx={{ fontWeight: label === "צפוי" ? 700 : 500 }}>{n.toFixed(1)}</Typography>
              </Paper>
            ))}
          </Box>
          {r.creditDays > 0 && (
            <Typography variant="caption" color="text.secondary">
              זיכוי על {r.creditDays} ימים מחוץ ליחידה שלא מבחירה.
            </Typography>
          )}
          {props.prev && <PrevLine prev={props.prev} soldierId={r.soldier_id} peers={props.peers} />}
          <EligibilityCard elig={props.elig} snap={props.snap} rankName={props.rankName} tash={props.tash} />
          {r.compared ? (
            <Alert severity={r.outlier ? "warning" : "success"} icon={false}>
              ממוצע מי שזכאים לאותן תורנויות: {r.ref.toFixed(1)} · הפער: {`\u2066${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}\u2069`} (מותר ±
              {r.limit.toFixed(1)}, {props.tolerance}%){r.outlier ? " – חורג" : " – בטווח"}
            </Alert>
          ) : (
            <Alert severity="info" icon={false}>
              לא נבדק:{" "}
              {noWork(props.elig)
                ? "אין לו אף משימה אפשרית במחזור (פירוט בכשירות למעלה)"
                : r.profile
                  ? "הוא היחיד בקבוצה עם הצירוף הזה של תורנויות"
                  : "לא זכאי לאף קטגוריית תורנות"}
              .
            </Alert>
          )}
          <Box>
            {why === null ? (
              <Button size="small" variant="outlined" onClick={checkWhy} disabled={whyProgress !== null}>
                {whyProgress === null ? "למה מעט תורנויות? בדיקת כל המשבצות" : `בודק… ${Math.round(whyProgress * 100)}%`}
              </Button>
            ) : (
              <>
                <Typography variant="subtitle2" gutterBottom>
                  מה מנע תורנויות ({ctx.slots.length} משבצות במחזור)
                </Typography>
                <Table size="small">
                  <TableBody>
                    {why.map((w) => (
                      <TableRow key={w.reason}>
                        <TableCell sx={{ width: 64, fontWeight: 600 }}>{w.slots}</TableCell>
                        <TableCell sx={{ color: w.reason === "free" ? "success.main" : undefined }}>{WHY_LABEL[w.reason] ?? w.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Typography variant="caption" color="text.secondary">
                  משבצת אחת יכולה להיספר בכמה סיבות.
                </Typography>
              </>
            )}
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              התורנויות שלו בטיוטה ({mine.length})
            </Typography>
            {mine.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                אין.
              </Typography>
            ) : (
              <Table size="small">
                <TableBody>
                  {mine.map(({ a, k }) => (
                    <TableRow key={a.id}>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{dayFmt.format(new Date(k!.starts_at))}</TableCell>
                      <TableCell>
                        {ctx.tasks.get(k!.task_type_id)?.name}
                        {a.role === "reserve" && <Chip size="small" variant="outlined" label="עתודה" sx={{ mr: 0.5 }} />}
                        {a.source === "manual" && <Chip size="small" color="secondary" variant="outlined" label="ידני" sx={{ mr: 0.5 }} />}
                      </TableCell>
                      <TableCell sx={{ textAlign: "end" }}>{a.role === "performer" ? `${a.normalized_points} נק׳` : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onShowSlots}>הצגה ב"לפי משבצת"</Button>
        <Button onClick={props.onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/**
 * The draft, on one screen: three health tiles (gaps, fairness, manual changes) with the publish
 * button, one search for both views, and the two views – the board (duties day by day) and the
 * soldiers (load and fairness). A soldier's details open from either view.
 */
function DraftBody(props: {
  ctx: Ctx;
  snapshot: SnapshotSoldier[];
  cells: PotentialCell[] | null;
  categories: Map<string, string>;
  tolerance: number;
  tash: Map<string, boolean>;
  prev: PrevCycle | null;
  missing: number;
  missingR: number;
  published: boolean;
  onPublish: () => void;
}) {
  const { ctx } = props;
  const navigate = useNavigate();
  const fair = useFairness(ctx, props.snapshot, props.cells, props.categories, props.tolerance);
  const [view, setView] = useState<"board" | "soldiers">("board");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<BoardFilter>("");
  const [who, setWho] = useState<string | null>(null);
  const [onlyOut, setOnlyOut] = useState(false);
  const [soldier, setSoldier] = useState<string | null>(null);
  const manual = ctx.assignments.filter((a) => a.source === "manual").length;
  const gaps = props.missing + props.missingR;
  const row = soldier ? fair.rows.find((r) => r.soldier_id === soldier) : undefined;

  const Tile = (p: { tone: "error" | "success" | "warning" | "secondary" | "default"; title: string; value: string; onClick?: () => void }) => (
    <Paper
      variant="outlined"
      component={p.onClick ? "button" : "div"}
      onClick={p.onClick}
      sx={{
        all: p.onClick ? "unset" : undefined,
        boxSizing: "border-box",
        flex: "1 0 120px",
        p: 1.25,
        borderRadius: 2,
        border: 1,
        borderColor: p.tone === "default" ? "divider" : `${p.tone}.main`,
        bgcolor: "background.paper",
        cursor: p.onClick ? "pointer" : "default",
        textAlign: "start",
        "&:hover": p.onClick ? { bgcolor: "action.hover" } : undefined,
        "&:focus-visible": { outline: 2, outlineColor: "primary.main" },
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {p.title}
      </Typography>
      <Typography sx={{ fontWeight: 700, color: p.tone === "default" ? "text.primary" : `${p.tone}.main` }}>{p.value}</Typography>
    </Paper>
  );

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ gap: 1, overflowX: "auto", pb: 0.5, alignItems: "stretch" }}>
        <Tile
          tone={gaps ? "error" : "success"}
          title={gaps ? "חסרים" : "איוש"}
          value={
            gaps
              ? [props.missing ? `${props.missing} מבצעים` : "", props.missingR ? `${props.missingR} עתודות` : ""].filter(Boolean).join(" · ")
              : "✓ הכול מאויש"
          }
          onClick={
            gaps
              ? () => {
                  if (props.published) return navigate("/cycle/operate");
                  setView("board");
                  setWho(null);
                  setFilter("missing");
                }
              : undefined
          }
        />
        <Tile
          tone={fair.outliers ? "warning" : "success"}
          title={`הוגנות (±${props.tolerance}%)`}
          value={fair.outliers ? `${fair.outliers} חורגים` : "✓ הוגן"}
          onClick={() => {
            setView("soldiers");
            setOnlyOut(fair.outliers > 0);
          }}
        />
        <Tile
          tone={manual ? "secondary" : "default"}
          title="שינויים ידניים"
          value={String(manual)}
          onClick={
            manual
              ? () => {
                  setView("board");
                  setWho(null);
                  setFilter("manual");
                }
              : undefined
          }
        />
        {!props.published && (
          <Box sx={{ display: "flex", alignItems: "center", flex: "1 0 auto", justifyContent: "flex-end" }}>
            <Button variant="contained" startIcon={<PublishIcon />} onClick={props.onPublish}>
              פרסום
            </Button>
          </Box>
        )}
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <Tabs value={view} onChange={(_, v) => setView(v)} sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40 } }}>
          <Tab value="board" label="לוח" />
          <Tab value="soldiers" label="חיילים" />
        </Tabs>
        <TextField
          size="small"
          placeholder={view === "board" ? "חיפוש: חייל, תורנות או תאריך (6.1)" : "חיפוש לפי שם"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          sx={{ flex: 1 }}
        />
      </Stack>

      {view === "board" ? (
        <BoardView ctx={ctx} q={q} filter={filter} setFilter={setFilter} who={who} setWho={setWho} onOpenSoldier={setSoldier} />
      ) : (
        <LoadTab ctx={ctx} fair={fair} q={q} onlyOut={onlyOut} setOnlyOut={setOnlyOut} onOpen={setSoldier} tash={props.tash} prev={props.prev} />
      )}

      {soldier && row && (
        <SoldierLoadDialog
          ctx={ctx}
          row={row}
          rankName={fair.rank.get(soldier) ?? ""}
          tolerance={props.tolerance}
          elig={fair.elig(soldier)}
          snap={props.snapshot.find((x) => x.soldier_id === soldier)}
          tash={props.tash.get(soldier)}
          prev={props.prev}
          peers={fair.rows.filter((x) => x.pool === row.pool && x.profile === row.profile).map((x) => x.soldier_id)}
          onClose={() => setSoldier(null)}
          onShowSlots={() => {
            setWho(soldier);
            setFilter("");
            setQ("");
            setView("board");
            setSoldier(null);
          }}
        />
      )}
    </Stack>
  );
}

export function DraftPage() {
  const { api, me } = useAuth();
  const canEdit = useCanEdit();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const { cycleId, reload: reloadCycle } = useCycle();
  const [tasks, setTasks] = useState<Map<string, TaskType>>(new Map());
  const [soldiers, setSoldiers] = useState<Map<string, ExistingSoldier>>(new Map());
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [assignments, setAssignments] = useState<DraftAssignment[] | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotSoldier[]>([]);
  const [cells, setCells] = useState<PotentialCell[] | null>(null);
  const [tash, setTash] = useState<Map<string, boolean>>(new Map()); // ת"ש 7: soldier → only part of the cycle
  const [prev, setPrev] = useState<PrevCycle | null>(null);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [tolerance, setTolerance] = useState(20);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState<UnpublishImpact | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api!.scoringSettings().then((x) => setTolerance(x.fairness_tolerance_pct), () => undefined);
    Promise.all([api!.cycles(), api!.taskTypes(), api!.soldiers(), api!.dutyCategories()])
      .then(([c, t, s, cats]) => {
        setCategories(new Map(cats.map((x) => [x.id, x.name])));
        setCycles(c);
        setTasks(new Map(t.map((x) => [x.id, x])));
        setSoldiers(new Map(s.map((x) => [x.id, x])));
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [api]);

  const load = useCallback(async () => {
    if (!cycleId) return;
    try {
      const [sl, as, sn] = await Promise.all([api!.cycleSlots(cycleId), api!.draftAssignments(cycleId), api!.snapshotSoldiers(cycleId)]);
      setSlots(sl);
      setAssignments(as);
      setSnapshot(sn);
      api!.potentialMatrix(cycleId).then(setCells).catch(() => setCells(null));
      api!
        .cycleHomeNightly(cycleId)
        .then((r) => setTash(new Map(r.map((x) => [x.soldier_id, x.partial]))))
        .catch(() => setTash(new Map()));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, [api, cycleId]);
  useEffect(() => {
    setSlots(null);
    setAssignments(null);
    setCells(null);
    void load();
  }, [load]);

  // the previous cycle, as a reference for the scores
  const before = cycles && cycleId ? (() => { const cur = cycles.find((c) => c.id === cycleId); return cur ? previousCycle(cycles, cur) : undefined; })() : undefined;
  const beforeId = before?.id;
  const beforeName = before?.name;
  useEffect(() => {
    setPrev(null);
    if (!beforeId || !beforeName) return;
    Promise.all([api!.draftAssignments(beforeId), api!.snapshotSoldiers(beforeId)])
      .then(([as, sn]) => setPrev(prevCycle(beforeName, as, sn.map((x) => x.soldier_id))))
      .catch(() => setPrev(null));
  }, [api, beforeId, beforeName]);

  if (!cycles) return msg ? <Alert severity="error">{msg.text}</Alert> : <Loading />;
  const cycle = cycles.find((c) => c.id === cycleId);
  const locked = !!cycle && (cycle.status === "published" || cycle.status === "closed");
  const views = slots && assignments ? bySlot(slots, assignments) : null;
  const missing = views ? [...views.values()].reduce((n, v) => n + v.missingPerformers, 0) : 0;
  const missingR = views ? [...views.values()].reduce((n, v) => n + v.missingReserves, 0) : 0;

  async function publish() {
    try {
      await api!.publishCycle(cycleId);
      setPublishing(false);
      setMsg({ ok: true, text: "הלוח פורסם. הוא מופיע עכשיו ב\"לוח מפורסם\" לכל מי שיש לו גישה." });
      setCycles(await api!.cycles());
      void reloadCycle();
      void load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setPublishing(false);
    }
  }

  return (
    <Stack spacing={2}>
      {msg && (
        <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}
      {!cycle ? (
        <Alert severity="info">אין מחזור.</Alert>
      ) : !slots || !assignments ? (
        <Loading />
      ) : assignments.length === 0 ? null : (
        <>
          <DraftBody
            ctx={{ cycle, slots, tasks, soldiers, assignments, reload: load, locked: locked || !canEdit }}
            snapshot={snapshot}
            cells={cells}
            categories={categories}
            tolerance={tolerance}
            tash={tash}
            prev={prev}
            missing={missing}
            missingR={missingR}
            published={locked}
            onPublish={() => setPublishing(true)}
          />
          {cycle.status === "published" && me?.roles.includes("coordinator") && (() => {
            const now = Date.now();
            const started = cycle.start_date <= dayKey(new Date()) || slots.some((s) => Date.parse(s.starts_at) <= now);
            const impact = {
              assignments: assignments.filter((a) => a.status === "assigned" || a.status === "reserve_idle").length,
              nextWeek: slots.filter((s) => Date.parse(s.starts_at) - now < 7 * 86_400_000).length,
            };
            return (
              <Paper variant="outlined" sx={{ p: 2, borderColor: "error.light" }}>
                <Typography variant="h3" color="error.main" sx={{ mb: 0.5 }}>
                  פעולות רגישות
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {started
                      ? "המחזור כבר התחיל, ולכן אי אפשר לבטל את הפרסום. שינויים במחזור שרץ נעשים בתפעול השוטף."
                      : "ביטול פרסום מחזיר את המחזור לטיוטה כדי לתקן ולפרסם שוב. אפשרי רק לפני שהמחזור מתחיל."}
                  </Typography>
                  <Button color="error" variant="outlined" disabled={started} onClick={() => setUnpublishing(impact)}>
                    ביטול פרסום
                  </Button>
                </Stack>
              </Paper>
            );
          })()}
        </>
      )}
      {unpublishing && cycle && (
        <UnpublishDialog
          cycle={cycle}
          impact={unpublishing}
          onClose={() => setUnpublishing(null)}
          onDone={(n) => {
            setUnpublishing(null);
            setMsg({ ok: true, text: `הפרסום בוטל: ${n} שיבוצים חזרו לטיוטה, והמחזור הוסר מהלוח המפורסם.` });
            void api!.cycles().then(setCycles);
            void reloadCycle();
            void load();
          }}
        />
      )}
      <Dialog open={publishing} onClose={() => setPublishing(false)} maxWidth="xs" fullWidth>
        <DialogTitle>פרסום הלוח</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2">
              הטיוטה של {cycle?.name} תפורסם ותופיע ב"לוח מפורסם". אחרי הפרסום הלוח נעול לעריכה בעורך; כל שינוי עובר דרך החלפה או הפלה ומתועד.
            </Typography>
            {missing + missingR > 0 && (
              <Alert severity="warning">
                חסרים {[missing ? `${missing} מבצעים` : "", missingR ? `${missingR} עתודות` : ""].filter(Boolean).join(" ו-")}. אפשר לפרסם בכל
                זאת – משבצת בלי מבצע מסומנת באדום בלוח עד שתאויש.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPublishing(false)}>ביטול</Button>
          <Button variant="contained" onClick={publish}>
            פרסום
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

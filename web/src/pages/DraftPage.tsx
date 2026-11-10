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
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
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
  weeksOf,
  type Candidate,
  type DraftAssignment,
  type Role,
} from "../lib/draft";
import { effective, REASON_LABEL, reasonText, type PotentialCell, type SnapshotSoldier } from "../lib/potential";
import type { ExistingSoldier } from "../lib/roster";
import { poolName, poolNames } from "../lib/schedule";

const dayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" });
const hm = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dm = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "numeric", month: "numeric" });
const span = (a: string, b: string) => {
  const sameDay = dayKey(a) === dayKey(b);
  return `${hm.format(new Date(a))} – ${sameDay ? "" : dm.format(new Date(b)) + " "}${hm.format(new Date(b))}`;
};
const fmtDay = (d: string) => d.split("-").reverse().join("/");

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

type Only = "" | "missing" | "manual";

function SlotsTab({
  ctx,
  only,
  setOnly,
  who,
  setWho,
}: {
  ctx: Ctx;
  only: Only;
  setOnly: (o: Only) => void;
  who?: string | null;
  setWho?: (id: string | null) => void;
}) {
  const weeks = useMemo(() => weeksOf(ctx.cycle.start_date, ctx.cycle.end_date), [ctx.cycle]);
  const firstWithWork = useMemo(() => {
    const first = ctx.slots[0]?.starts_at;
    if (!first) return weeks[0];
    const d = dayKey(first);
    return [...weeks].reverse().find((w) => w <= d) ?? weeks[0];
  }, [ctx.slots, weeks]);
  const [week, setWeek] = useState<string>("");
  const [task, setTask] = useState("");
  const [editing, setEditing] = useState<{ slot: SlotRow; role: Role; current: DraftAssignment | null } | null>(null);
  const views = useMemo(() => bySlot(ctx.slots, ctx.assignments), [ctx.slots, ctx.assignments]);
  const wk = week || firstWithWork;
  const wkEnd = useMemo(() => {
    const d = new Date(wk + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  }, [wk]);

  const shown = ctx.slots.filter((s) => {
    const d = dayKey(s.starts_at);
    const v = views.get(s.id)!;
    if (who) return [...v.performers, ...v.reserves].some((a) => a.soldier_id === who);
    if (only === "missing") return v.missingPerformers + v.missingReserves > 0 && (!task || s.task_type_id === task);
    if (only === "manual") return [...v.performers, ...v.reserves].some((a) => a.source === "manual") && (!task || s.task_type_id === task);
    return d >= wk && d <= wkEnd && (!task || s.task_type_id === task);
  });
  const byDay = new Map<string, SlotRow[]>();
  for (const s of shown) byDay.set(dayKey(s.starts_at), [...(byDay.get(dayKey(s.starts_at)) ?? []), s]);
  const taskIds = [...new Set(ctx.slots.map((s) => s.task_type_id))];

  const Name = ({ a, slot }: { a: DraftAssignment; slot: SlotRow }) => {
    const s = ctx.soldiers.get(a.soldier_id);
    return (
      <Tooltip title={a.explanation ?? ""}>
        <Chip
          size="small"
          variant={a.role === "performer" ? "filled" : "outlined"}
          color={a.source === "manual" ? "secondary" : "default"}
          label={`${s?.full_name ?? "?"} · ${s?.gaf_name ?? ""}`}
          onClick={ctx.locked ? undefined : () => setEditing({ slot, role: a.role, current: a })}
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

  return (
    <Stack spacing={2}>
      {who && (
        <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => setWho?.(null)}>הצגת הכול</Button>}>
          מוצגות התורנויות של <b>{ctx.soldiers.get(who)?.full_name}</b> בכל המחזור.
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <TextField select size="small" label="שבוע" value={wk} onChange={(e) => setWeek(e.target.value)} disabled={!!only || !!who} sx={{ minWidth: 150 }}>
          {weeks.map((w) => (
            <MenuItem key={w} value={w}>
              {fmtDay(w)}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="תורנות" value={task} onChange={(e) => setTask(e.target.value)} sx={{ minWidth: 170 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
          <MenuItem value="">הכל</MenuItem>
          {taskIds.map((id) => (
            <MenuItem key={id} value={id}>
              {ctx.tasks.get(id)?.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="הצג" value={only} onChange={(e) => setOnly(e.target.value as Only)} sx={{ minWidth: 170 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
          <MenuItem value="">השבוע שנבחר</MenuItem>
          <MenuItem value="missing">כל המשבצות החסרות</MenuItem>
          <MenuItem value="manual">כל השינויים הידניים</MenuItem>
        </TextField>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        לחיצה על שם פותחת החלפה; לחיצה על "חסר" פותחת שיבוץ. מעבר עם העכבר מראה את ההסבר. סגול = שינוי ידני.
      </Typography>
      {shown.length === 0 && <Alert severity="info">אין משבצות להצגה.</Alert>}
      {[...byDay].map(([day, list]) => (
        <Box key={day}>
          <Typography variant="h3" sx={{ mb: 1, color: "primary.main" }}>
            {dayFmt.format(new Date(day + "T12:00:00Z"))}
          </Typography>
          <Stack spacing={1}>
            {list.map((s) => {
              const v = views.get(s.id)!;
              const t = ctx.tasks.get(s.task_type_id);
              return (
                <Paper key={s.id} variant="outlined" sx={{ p: 1.25, borderInlineStart: `4px solid ${t?.color ?? "#999"}` }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
                    <Box sx={{ minWidth: 210 }}>
                      <Typography sx={{ fontWeight: 600 }}>{t?.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {span(s.starts_at, s.ends_at)}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75, flex: 1 }}>
                      {v.performers.map((a) => (
                        <Name key={a.id} a={a} slot={s} />
                      ))}
                      <Missing slot={s} role="performer" n={v.missingPerformers} />
                      {v.reserves.map((a) => (
                        <Name key={a.id} a={a} slot={s} />
                      ))}
                      <Missing slot={s} role="reserve" n={v.missingReserves} />
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </Box>
      ))}
      {editing && <AssignDialog ctx={ctx} {...editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Load per soldier
// ---------------------------------------------------------------------------

function LoadTab({
  ctx,
  snapshot,
  cells,
  categories,
  tolerance,
  onShowSoldier,
}: {
  ctx: Ctx;
  snapshot: SnapshotSoldier[];
  cells: PotentialCell[] | null;
  categories: Map<string, string>;
  tolerance: number;
  onShowSoldier: (soldierId: string) => void;
}) {
  const ls = useMemo(() => loads(snapshot, ctx.assignments), [snapshot, ctx.assignments]);
  const groupName = useMemo(() => poolNames(snapshot), [snapshot]);
  const rank = new Map(snapshot.map((s) => [s.soldier_id, s.rank_name]));
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
  const keys = [...verdict.keys()].sort((a, b) => verdict.get(b)!.soldiers - verdict.get(a)!.soldiers);
  const [picked, setPool] = useState("");
  const pool = keys.includes(picked) ? picked : keys[0] ?? "";
  const v = verdict.get(pool);
  const credited = ls.some((l) => l.creditDays > 0);

  const [q, setQ] = useState("");
  const [gaf, setGaf] = useState("");
  const [onlyOut, setOnlyOut] = useState(false);
  const [sort, setSort] = useState<"diff" | "score" | "name">("score");
  const [open, setOpen] = useState<FairRow | null>(null);

  const inPool = rows.filter((r) => r.pool === pool);
  const gafim = [...new Set(inPool.map((r) => ctx.soldiers.get(r.soldier_id)?.gaf_name ?? ""))].filter(Boolean).sort();
  const name = (id: string) => ctx.soldiers.get(id)?.full_name ?? "?";
  const shown = inPool
    .filter((r) => (!q || name(r.soldier_id).includes(q.trim())) && (!gaf || ctx.soldiers.get(r.soldier_id)?.gaf_name === gaf) && (!onlyOut || r.outlier))
    .sort((a, b) =>
      sort === "name" ? name(a.soldier_id).localeCompare(name(b.soldier_id), "he") : sort === "diff" ? Math.abs(b.diff) - Math.abs(a.diff) : b.expected - a.expected,
    );
  const top = Math.max(1, ...inPool.map((r) => Math.max(r.expected, r.ref + r.limit)));
  const profiles = cells ? byProfile(inPool, (id) => [...(openNames.get(id) ?? [])]) : [];
  const notCompared = inPool.filter((r) => !r.compared).length;
  // a signed number keeps its sign on the left inside Hebrew text
  const sign = (n: number) => `\u2066${n > 0 ? "+" : ""}${n.toFixed(1)}\u2069`;

  return (
    <Stack spacing={2}>
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

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr 1fr", sm: "2fr 1fr 1fr auto" }, alignItems: "center", mb: 1.5 }}>
          <TextField
            size="small"
            placeholder="חיפוש לפי שם"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }}
          />
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
                onClick={() => setOpen(r)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(r))}
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
                    {s?.gaf_name} · {rank.get(r.soldier_id)} · {r.duties} תורנויות{r.weekends ? ` · ${r.weekends} סופ״ש` : ""}
                    {r.reserves ? ` · ${r.reserves} עתודות` : ""}
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
                    {r.compared ? sign(r.diff) : "לא נבדק"}
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

      {open && (
        <SoldierLoadDialog
          ctx={ctx}
          row={open}
          rankName={rank.get(open.soldier_id) ?? ""}
          tolerance={tolerance}
          onClose={() => setOpen(null)}
          onShowSlots={() => {
            onShowSoldier(open.soldier_id);
            setOpen(null);
          }}
        />
      )}
    </Stack>
  );
}

/** One soldier's load: how the score is built, and his duties in the draft. */
function SoldierLoadDialog(props: { ctx: Ctx; row: FairRow; rankName: string; tolerance: number; onClose: () => void; onShowSlots: () => void }) {
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
          {r.compared ? (
            <Alert severity={r.outlier ? "warning" : "success"} icon={false}>
              ממוצע מי שזכאים לאותן תורנויות: {r.ref.toFixed(1)} · הפער: {`\u2066${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}\u2069`} (מותר ±
              {r.limit.toFixed(1)}, {props.tolerance}%){r.outlier ? " – חורג" : " – בטווח"}
            </Alert>
          ) : (
            <Alert severity="info" icon={false}>
              לא נבדק: {r.profile ? "הוא היחיד בקבוצה עם הצירוף הזה של תורנויות" : "לא זכאי לאף קטגוריית תורנות"}.
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
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState<"slots" | "load">("slots");
  const [only, setOnly] = useState<Only>("");
  const [who, setWho] = useState<string | null>(null); // the slots list shows one soldier's duties
  const [tolerance, setTolerance] = useState(20);
  const navigate = useNavigate();
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
      ) : assignments.length === 0 ? (
        <Alert severity="info">
          אין עדיין טיוטה למחזור הזה. הרץ שיבוץ במסך{" "}
          <RouterLink to="/cycle/schedule?view=run" style={{ color: "inherit" }}>
            שיבוץ
          </RouterLink>
          .
        </Alert>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
              {(() => {
                // the counters are the filters of the slot list; after publishing, gaps are filled in operations
                const show = (o: Only) => {
                  setTab("slots");
                  setWho(null);
                  setOnly(o);
                };
                const active = (o: Only) => tab === "slots" && only === o && !who;
                const manualCount = assignments.filter((a) => a.source === "manual").length;
                const gaps = missing + missingR > 0;
                return (
                  <>
                    <Chip
                      label={`כל המשבצות · ${slots.length}`}
                      color={active("") ? "primary" : "default"}
                      variant={active("") ? "filled" : "outlined"}
                      onClick={() => show("")}
                    />
                    {gaps ? (
                      <Chip
                        color="error"
                        variant={active("missing") ? "filled" : "outlined"}
                        label={[missing ? `חסרים ${missing} מבצעים` : "", missingR ? `חסרות ${missingR} עתודות` : ""].filter(Boolean).join(" · ")}
                        onClick={() => (locked ? navigate("/cycle/operate") : show("missing"))}
                      />
                    ) : (
                      <Chip color="success" variant="outlined" label="כל המשבצות מאוישות" />
                    )}
                    {manualCount > 0 && (
                      <Chip
                        color="secondary"
                        variant={active("manual") ? "filled" : "outlined"}
                        label={`${manualCount} שינויים ידניים`}
                        onClick={() => show("manual")}
                      />
                    )}
                    {locked && gaps && (
                      <Typography variant="caption" color="text.secondary">
                        משלימים בתפעול
                      </Typography>
                    )}
                  </>
                );
              })()}
              <Box sx={{ flex: 1 }} />
              {!locked && (
                <Button variant="contained" startIcon={<PublishIcon />} onClick={() => setPublishing(true)}>
                  פרסום
                </Button>
              )}
            </Stack>
          </Paper>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab value="slots" label="לפי משבצת" />
            <Tab value="load" label="עומס לפי חייל" />
          </Tabs>
          {(() => {
            const ctx: Ctx = { cycle, slots, tasks, soldiers, assignments, reload: load, locked: locked || !canEdit };
            return tab === "slots" ? (
              <SlotsTab ctx={ctx} only={only} setOnly={setOnly} who={who} setWho={setWho} />
            ) : (
              <LoadTab
                ctx={ctx}
                snapshot={snapshot}
                cells={cells}
                categories={categories}
                tolerance={tolerance}
                onShowSoldier={(id) => {
                  setWho(id);
                  setOnly("");
                  setTab("slots");
                }}
              />
            );
          })()}
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

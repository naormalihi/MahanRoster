import PublishIcon from "@mui/icons-material/Publish";
import SearchIcon from "@mui/icons-material/Search";
import {
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
  TableContainer,
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
import { Link as RouterLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { UnpublishDialog, type UnpublishImpact } from "../components/UnpublishDialog";
import type { SlotRow } from "../lib/baseSchedule";
import type { TaskType } from "../lib/catalog";
import { stageLabel, type Cycle } from "../lib/cycles";
import { TZ, dayKey } from "../lib/dates";
import {
  ROLE_LABEL,
  byProfile,
  bySlot,
  loads,
  poolMeans,
  rankCandidates,
  weeksOf,
  type Candidate,
  type DraftAssignment,
  type Role,
} from "../lib/draft";
import { effective, reasonText, type PotentialCell, type SnapshotSoldier } from "../lib/potential";
import type { ExistingSoldier } from "../lib/roster";
import { POOL_LABEL } from "../lib/schedule";

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

interface Ctx {
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

function AssignDialog(props: { ctx: Ctx; slot: SlotRow; role: Role; current: DraftAssignment | null; onClose: () => void }) {
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
    if (!reason.trim()) return setError("חובה לכתוב נימוק");
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
                          {c.conflicts.length > 0 && <Chip size="small" color="warning" variant="outlined" label="חופף/מנוחה" />}
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
              {chosen!.conflicts.length > 0 && <div>חופף לתורנות אחרת או למנוחה שאחריה.</div>}
              אפשר לשבץ בכל זאת – הנימוק נשמר ביומן.
            </Alert>
          )}
          <TextField label="נימוק (חובה)" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth />
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
          onClick={() => run(() => api!.manualAssign(slot.id, props.role, chosen!.soldier_id, current?.id ?? null, reason))}
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

function SlotsTab({ ctx }: { ctx: Ctx }) {
  const weeks = useMemo(() => weeksOf(ctx.cycle.start_date, ctx.cycle.end_date), [ctx.cycle]);
  const firstWithWork = useMemo(() => {
    const first = ctx.slots[0]?.starts_at;
    if (!first) return weeks[0];
    const d = dayKey(first);
    return [...weeks].reverse().find((w) => w <= d) ?? weeks[0];
  }, [ctx.slots, weeks]);
  const [week, setWeek] = useState<string>("");
  const [task, setTask] = useState("");
  const [only, setOnly] = useState<"" | "missing" | "manual">("");
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
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <TextField select size="small" label="שבוע" value={wk} onChange={(e) => setWeek(e.target.value)} disabled={!!only} sx={{ minWidth: 150 }}>
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
        <TextField select size="small" label="הצג" value={only} onChange={(e) => setOnly(e.target.value as "" | "missing" | "manual")} sx={{ minWidth: 170 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
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

function LoadTab({ ctx, snapshot, cells, categories }: { ctx: Ctx; snapshot: SnapshotSoldier[]; cells: PotentialCell[] | null; categories: Map<string, string> }) {
  const ls = useMemo(() => loads(snapshot, ctx.assignments), [snapshot, ctx.assignments]);
  const means = poolMeans(ls);
  // a group's name: its population and the duty categories its soldiers share
  const groupName = new Map<string, string>();
  for (const s of snapshot) {
    const key = s.fairness_group || s.balance_population;
    if (!groupName.has(key)) groupName.set(key, [POOL_LABEL[s.balance_population] ?? s.balance_population, s.fairness_label].filter(Boolean).join(" · "));
  }
  const keys = [...means.keys()].sort((a, b) => ls.filter((l) => l.pool === b).length - ls.filter((l) => l.pool === a).length);
  const [picked, setPool] = useState("");
  const pool = keys.includes(picked) ? picked : keys[0] ?? "";
  const credited = ls.some((l) => l.creditDays > 0);
  const rank = new Map(snapshot.map((s) => [s.soldier_id, s.rank_name]));
  const open = new Map<string, number>();
  for (const c of cells ?? []) if (effective(c) > 0) open.set(c.soldier_id, (open.get(c.soldier_id) ?? 0) + 1);
  const shown = ls.filter((l) => l.pool === pool).sort((a, b) => b.expected - a.expected);
  const mean = means.get(pool) ?? 0;
  const zeroOpen = shown.filter((l) => cells && !open.get(l.soldier_id)).length;
  const openNames = new Map<string, string[]>();
  for (const c of cells ?? [])
    if (effective(c) > 0) openNames.set(c.soldier_id, [...(openNames.get(c.soldier_id) ?? []), categories.get(c.category_id) ?? "?"]);
  const profiles = cells ? byProfile(shown, (id) => [...(openNames.get(id) ?? [])]) : [];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {keys.map((p) => (
          <Chip
            key={p}
            label={`${groupName.get(p) ?? POOL_LABEL[p] ?? p} · ${ls.filter((l) => l.pool === p).length} · ממוצע ${(means.get(p) ?? 0).toFixed(1)}`}
            color={p === pool ? "primary" : "default"}
            onClick={() => setPool(p)}
          />
        ))}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        כל קבוצה כוללת חיילים מאותה אוכלוסייה שיכולים להתחלק בעומס (יש להם קטגוריות תורנות משותפות). ההוגנות והממוצע נמדדים בתוך הקבוצה.
        {credited && " זיכוי = ימים מחוץ ליחידה שלא מבחירה (לפני גיוס, אחרי שחרור, חודש חסד, פטור מלא, קורס או מחלה ארוכים) כפול העומס היומי הממוצע של הקבוצה."}
      </Typography>
      {cells && zeroOpen > 0 && (
        <Alert severity="info">
          {zeroOpen} חיילים בקבוצה הזו לא זכאים לאף קטגוריית תורנות לפי מטריצת הפוטנציאל, ולכן הניקוד שלהם 0. הם נכללים בממוצע ומושכים אותו למטה – זה
          לא חוסר הוגנות בשיבוץ.
        </Alert>
      )}
      {profiles.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            לפי מה שהחיילים יכולים לעשות – הוגנות נמדדת בין מי שזכאים לאותן תורנויות
          </Typography>
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
                  <TableCell sx={{ color: p.max - p.min > 8 ? "error.main" : undefined }}>{p.max.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "65vh" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {["חייל", "גף", "דרגה", "ניקוד קודם", ...(credited ? ["זיכוי"] : []), "במחזור", "צפוי", "מול הממוצע", "תורנויות", "עתודות", "סופ״ש", "קטגוריות פתוחות"].map((h) => (
                <TableCell key={h} sx={{ whiteSpace: "nowrap" }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((l) => {
              const s = ctx.soldiers.get(l.soldier_id);
              const diff = l.expected - mean;
              return (
                <TableRow key={l.soldier_id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {s?.full_name}
                    {l.manual > 0 && <Chip size="small" color="secondary" variant="outlined" label="ידני" sx={{ mr: 0.5 }} />}
                  </TableCell>
                  <TableCell>{s?.gaf_name}</TableCell>
                  <TableCell>{rank.get(l.soldier_id)}</TableCell>
                  <TableCell>{l.baseline.toFixed(1)}</TableCell>
                  {credited && <TableCell title={l.creditDays ? `${l.creditDays} ימים` : undefined}>{l.creditDays ? `${l.credit.toFixed(1)} (${l.creditDays} י׳)` : ""}</TableCell>}
                  <TableCell>{l.points.toFixed(1)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{l.expected.toFixed(1)}</TableCell>
                  <TableCell sx={{ color: Math.abs(diff) > 5 ? (diff > 0 ? "error.main" : "info.main") : undefined }}>
                    {diff > 0 ? "+" : ""}
                    {diff.toFixed(1)}
                  </TableCell>
                  <TableCell>{l.duties}</TableCell>
                  <TableCell>{l.reserves}</TableCell>
                  <TableCell>{l.weekends}</TableCell>
                  <TableCell>{cells ? open.get(l.soldier_id) ?? 0 : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

// ---------------------------------------------------------------------------

export function DraftPage() {
  const { api, me } = useAuth();
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
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState<UnpublishImpact | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
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
              <Chip label={`שלב: ${stageLabel(cycle.status)}`} />
              <Chip label={`${slots.length} משבצות`} />
              <Chip color={missing ? "error" : "success"} label={missing ? `חסרים ${missing} מבצעים` : "כל המבצעים שובצו"} />
              {missingR > 0 && <Chip color="warning" variant="outlined" label={`חסרות ${missingR} עתודות`} />}
              <Chip variant="outlined" label={`${assignments.filter((a) => a.source === "manual").length} שינויים ידניים`} />
              <Box sx={{ flex: 1 }} />
              {!locked && (
                <Button variant="contained" startIcon={<PublishIcon />} onClick={() => setPublishing(true)}>
                  פרסום
                </Button>
              )}
              {locked && <Chip color="success" label="פורסם – שינויים מעכשיו דרך החלפות והפלות" />}
            </Stack>
          </Paper>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab value="slots" label="לפי משבצת" />
            <Tab value="load" label="עומס לפי חייל" />
          </Tabs>
          {(() => {
            const ctx: Ctx = { cycle, slots, tasks, soldiers, assignments, reload: load, locked };
            return tab === "slots" ? <SlotsTab ctx={ctx} /> : <LoadTab ctx={ctx} snapshot={snapshot} cells={cells} categories={categories} />;
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

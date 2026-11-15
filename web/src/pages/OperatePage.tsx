/**
 * Day-to-day work on a published cycle: duties added after publishing (with the הקפצה flag),
 * filled by an engine run that keeps the published board as it is, then approved.
 */
import AddIcon from "@mui/icons-material/Add";
import BoltIcon from "@mui/icons-material/BoltOutlined";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OFFLINE_TEXT, pollFailures } from "../lib/network";
import type { ExistingSoldier } from "../lib/roster";
import { useAuth } from "../lib/auth";
import { slotName, type NewSlot, type RankRef, type SlotRow } from "../lib/baseSchedule";
import type { TaskType } from "../lib/catalog";
import { useCycle } from "../lib/cycleContext";
import { dayKey, dayLabel, timeLabel } from "../lib/dates";
import { announceBoardChange, SlotActionsDialog } from "../components/SlotActions";
import { AssignDialog } from "./DraftPage";
import SearchIcon from "@mui/icons-material/Search";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import MoreIcon from "@mui/icons-material/MoreHoriz";
import type { DraftAssignment } from "../lib/draft";
import { isActive, jobErrorText, topReasons, type ScheduleJob } from "../lib/schedule";
import { REASON_LABEL } from "../lib/potential";
import { pendingSlots } from "../lib/workspace";

/** "2026-11-10T08:00" in Israel time for a date + "HH:MM" (the browser runs in Israel time). */
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Default start/end from the duty's default hours, on the given day. */
export function defaultTimes(t: Pick<TaskType, "default_start_time" | "default_end_time"> | undefined, day: Date) {
  const [sh, sm] = (t?.default_start_time ?? "08:00").split(":").map(Number);
  const [eh, em] = (t?.default_end_time ?? "08:00").split(":").map(Number);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start: localInput(start), end: localInput(end) };
}

/** The value of the duty picker for a special call-up (הקפצה מיוחדת). */
const SPECIAL = "__special__";
const SPECIAL_CODE = { any: "special_any", mandatory: "special_mandatory", career: "special_career" } as const;

function AddSlotDialog(props: { tasks: TaskType[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const { cycleId } = useCycle();
  const active = props.tasks.filter((t) => t.is_active && !t.is_special);
  const specials = props.tasks.filter((t) => t.is_special);
  const [ranks, setRanks] = useState<RankRef[]>([]);
  useEffect(() => {
    api!.rankRefs().then((r) => setRanks([...r].sort((a, b) => a.sort_order - b.sort_order))).catch(() => setRanks([]));
  }, [api]);
  const [specialName, setSpecialName] = useState("");
  const [specialPoints, setSpecialPoints] = useState<number | "">("");
  const [specialWho, setSpecialWho] = useState<keyof typeof SPECIAL_CODE>("any");
  const [specialRanks, setSpecialRanks] = useState<string[]>([]);
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);
  const [taskId, setTaskId] = useState(active[0]?.id ?? "");
  const [times, setTimes] = useState(() => defaultTimes(active[0], tomorrow));
  const [performers, setPerformers] = useState(1);
  const [reserves, setReserves] = useState(1);
  const [surprise, setSurprise] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickTask(id: string) {
    setTaskId(id);
    if (id === SPECIAL) return;
    const day = times.start ? new Date(times.start) : tomorrow;
    setTimes(defaultTimes(props.tasks.find((t) => t.id === id), day));
  }

  async function save() {
    const start = new Date(times.start);
    const end = new Date(times.end);
    if (!taskId) return setError("בחר תורנות");
    const special = taskId === SPECIAL;
    const specialType = specials.find((t) => t.code === SPECIAL_CODE[specialWho]);
    if (special) {
      if (!specialName.trim()) return setError("תן שם למשימה");
      if (specialPoints === "" || specialPoints < 0.5 || specialPoints > 100) return setError("ניקוד למבצע – בין 0.5 ל-100");
      if (!specialType) return setError("סוג ההקפצה המיוחדת חסר במערכת – צריך לעדכן את בסיס הנתונים");
    }
    if (!(end > start)) return setError("הסיום חייב להיות אחרי ההתחלה");
    if (performers < 1 || reserves < 0) return setError("לפחות מבצע אחד");
    const slot: NewSlot = special
      ? {
          task_type_id: specialType!.id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          performers_needed: performers,
          reserves_needed: reserves,
          is_surprise: false,
          special_name: specialName.trim(),
          fixed_points: Number(specialPoints),
          allowed_rank_ids: specialRanks.length ? specialRanks : null,
        }
      : {
          task_type_id: taskId,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          performers_needed: performers,
          reserves_needed: reserves,
          is_surprise: surprise,
        };
    setBusy(true);
    try {
      await api!.addSlot(cycleId, slot);
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>תורנות חדשה במחזור</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField select label="תורנות" value={taskId} onChange={(e) => pickTask(e.target.value)} fullWidth>
            {specials.length > 0 && (
              <MenuItem value={SPECIAL} sx={{ fontWeight: 600 }}>
                הקפצה מיוחדת (לא מהקטלוג)
              </MenuItem>
            )}
            {active.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          {taskId === SPECIAL && (
            <Paper variant="outlined" sx={{ p: 1.5, borderColor: "primary.main" }}>
              <Stack spacing={1.5}>
                <TextField label="שם המשימה" value={specialName} onChange={(e) => setSpecialName(e.target.value)} required fullWidth />
                <Stack direction="row" spacing={1.5}>
                  <TextField
                    type="number"
                    label="ניקוד למבצע"
                    value={specialPoints}
                    onChange={(e) => setSpecialPoints(e.target.value === "" ? "" : Number(e.target.value))}
                    slotProps={{ htmlInput: { min: 0.5, max: 100, step: 0.5 } }}
                    required
                    fullWidth
                  />
                  <TextField select label="מי יכול לבצע" value={specialWho} onChange={(e) => setSpecialWho(e.target.value as keyof typeof SPECIAL_CODE)} fullWidth>
                    <MenuItem value="any">כולם</MenuItem>
                    <MenuItem value="mandatory">חובה</MenuItem>
                    <MenuItem value="career">קבע</MenuItem>
                  </TextField>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  הניקוד הוא לכל התורנות, בלי מקדמי שבת, חג או הקפצה. לדוגמה, אמ"ת שווה 13 ושמירה שווה 1.
                </Typography>
                <TextField
                  select
                  label="דרגות (לא חובה)"
                  value={specialRanks}
                  onChange={(e) => setSpecialRanks(typeof e.target.value === "string" ? e.target.value.split(",") : (e.target.value as string[]))}
                  slotProps={{
                    select: {
                      multiple: true,
                      renderValue: (v) => ((v as string[]).length ? (v as string[]).map((id) => ranks.find((r) => r.id === id)?.name).join(", ") : "כל הדרגות"),
                      displayEmpty: true,
                    },
                    inputLabel: { shrink: true },
                  }}
                  fullWidth
                >
                  {ranks.map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Paper>
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField type="datetime-local" label="התחלה" value={times.start} onChange={(e) => setTimes({ ...times, start: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            <TextField type="datetime-local" label="סיום" value={times.end} onChange={(e) => setTimes({ ...times, end: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField type="number" label="מבצעים" value={performers} onChange={(e) => setPerformers(Number(e.target.value))} slotProps={{ htmlInput: { min: 1 } }} fullWidth />
            <TextField type="number" label="עתודות" value={reserves} onChange={(e) => setReserves(Number(e.target.value))} slotProps={{ htmlInput: { min: 0 } }} fullWidth />
          </Stack>
          {taskId === SPECIAL ? (
            <Typography variant="body2" color="text.secondary">
              אין מקדם הקפצה – הניקוד שהוזן הוא הניקוד.
            </Typography>
          ) : (
            <FormControlLabel
              control={<Checkbox checked={surprise} onChange={(e) => setSurprise(e.target.checked)} />}
              label="הקפצה – תורנות שלא הוכרזה מראש (הניקוד מוכפל במקדם ההקפצה)"
            />
          )}
        </Stack>
      </DialogContent>
      {error && (
        <Alert severity="error" sx={{ mx: 2, mt: 1.5 }}>
          {error}
        </Alert>
      )}
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          הוספה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const live = (a: DraftAssignment) => a.status !== "draft";
const performs = (a: DraftAssignment) => a.role === "performer" || a.status === "reserve_activated";

export function OperatePage() {
  const { api } = useAuth();
  const { cycle, cycleId } = useCycle();
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [soldiers, setSoldiers] = useState<Map<string, ExistingSoldier>>(new Map());
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [assignments, setAssignments] = useState<DraftAssignment[]>([]);
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [adding, setAdding] = useState(false);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SlotRow | null>(null);
  const [assigning, setAssigning] = useState<{ slot: SlotRow; role: "performer" | "reserve" } | null>(null);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api!.taskTypes(), api!.soldiers()])
      .then(([t, s]) => {
        setTasks(t);
        setSoldiers(new Map(s.map((x) => [x.id, x])));
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [api]);

  const load = useCallback(async () => {
    if (!cycleId) return;
    // jobs first: a run that finished is already written, so the rows read next include it
    const jb = await api!.scheduleJobs(cycleId);
    const [sl, as] = await Promise.all([api!.cycleSlots(cycleId), api!.draftAssignments(cycleId)]);
    setSlots(sl);
    setAssignments(as);
    setJobs(jb);
    announceBoardChange(); // the cycle's step marks follow
  }, [api, cycleId]);
  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [load]);

  const running = jobs.find(isActive);
  useEffect(() => {
    if (!running) return;
    const polls = pollFailures();
    const t = setInterval(() => {
      load().then(
        () => {
          polls.ok();
          setMsg((m) => (m?.text === OFFLINE_TEXT ? null : m));
        },
        (e) => {
          const text = polls.fail(e);
          if (text) setMsg({ ok: false, text });
        },
      );
    }, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  const taskName = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks]);
  if (!cycle || !slots) return <CircularProgress />;
  if (cycle.status !== "published")
    return <Alert severity="info">התפעול השוטף נפתח אחרי שהמחזור מתפרסם. עד אז כל שינוי נעשה בטיוטה.</Alert>;

  const of = (id: string) => assignments.filter((a) => a.slot_id === id);
  const pending = pendingSlots(slots, assignments);
  // the roles a waiting duty still misses on the board (published people only)
  const missingRoles = (k: SlotRow): ("performer" | "reserve")[] => {
    const mine = of(k.id).filter((a) => live(a) && !["dropped", "swapped_out", "cancelled_approved"].includes(a.status));
    const out: ("performer" | "reserve")[] = [];
    if (mine.filter(performs).length < k.performers_needed) out.push("performer");
    if (mine.filter((a) => a.role === "reserve" && a.status === "reserve_idle").length < k.reserves_needed) out.push("reserve");
    return out;
  };
  // why the last run left a duty empty – who is not eligible and what held back the eligible
  const unfilledWhy = (slotId: string) => {
    if (!lastStability || lastStability.status !== "done") return "";
    const u = (lastStability.unfilled ?? []).filter((x) => x.slot_id === slotId);
    if (!u.length) return "";
    const merged: Record<string, number> = {};
    for (const x of u) for (const [r, n] of Object.entries(x.reasons)) merged[r] = Math.max(merged[r] ?? 0, n);
    return topReasons(merged, REASON_LABEL, 3) || (u[0].eligible_count === 0 ? "אין אף חייל זכאי" : "");
  };
  const drafts = (id: string) => of(id).filter((a) => a.status === "draft");
  const withDraft = pending.filter((k) => drafts(k.id).length > 0);
  const lastStability = jobs.find((j) => j.kind === "stability");
  const name = (id: string) => soldiers.get(id)?.full_name ?? "?";
  // search: soldier name, duty name or a date like 6.1 / 06/01
  const terms = search.trim().split(/\s+/).filter(Boolean);
  const dateOf = (iso: string) => {
    const [y, m, d] = dayKey(iso).split("-").map(Number);
    return [`${d}.${m}`, `${d}/${m}`, `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`, `${d}.${m}.${y}`, `${d}/${m}/${y}`];
  };
  const found = terms.length
    ? slots.filter((k) => {
        if (Date.parse(k.ends_at) <= Date.now() || !of(k.id).some(live)) return false;
        const hay = [slotName(k, (id) => taskName.get(id)), ...of(k.id).filter(live).map((a) => name(a.soldier_id)), ...dateOf(k.starts_at)].join(" ");
        return terms.every((t) => hay.includes(t));
      })
    : [];

  async function run(f: () => Promise<unknown>, ok: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      setMsg(ok ? { ok: true, text: ok } : null);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography variant="h3" sx={{ flex: 1 }}>
              תורנויות שממתינות לשיבוץ
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
              תורנות חדשה
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            תורנות שנוספה אחרי הפרסום, או שחסר בה מבצע או עתודה (למשל אחרי הפעלת עתודה). מריצים את המנוע רק עליהן – כל מה שכבר פורסם נשאר כמו שהוא – ומאשרים את ההצעה כדי שתיכנס ללוח.
          </Typography>
          {pending.length === 0 ? (
            <Typography color="text.secondary">אין תורנויות שממתינות לשיבוץ.</Typography>
          ) : (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>מועד</TableCell>
                    <TableCell>תורנות</TableCell>
                    <TableCell>הצעת המנוע</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pending.map((k) => {
                    const d = drafts(k.id);
                    return (
                      <TableRow key={k.id}>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {dayLabel(k.starts_at)} {timeLabel(k.starts_at)}
                        </TableCell>
                        <TableCell>
                          {slotName(k, (id) => taskName.get(id))}{" "}
                          {k.is_surprise && <Chip size="small" color="warning" icon={<BoltIcon />} label="הקפצה" />}
                          {k.fixed_points != null && (
                            <Chip size="small" color="warning" variant="outlined" icon={<BoltIcon />} label={`הקפצה מיוחדת · ${Number(k.fixed_points)} נק׳`} />
                          )}
                        </TableCell>
                        <TableCell>
                          {d.length === 0 ? (
                            <>
                              <Typography variant="body2" color="text.secondary">
                                עוד לא שובץ
                              </Typography>
                              {unfilledWhy(k.id) && (
                                <Typography variant="caption" color="warning.dark" sx={{ display: "block" }}>
                                  המנוע לא מצא: {unfilledWhy(k.id)}
                                </Typography>
                              )}
                            </>
                          ) : (
                            d.map((a) => (
                              <Typography key={a.id} variant="body2">
                                {a.role === "performer" ? "מבצע" : "עתודה"}: <b>{name(a.soldier_id)}</b>
                                {a.role === "performer" ? ` · ${a.points} נק׳` : ""}
                              </Typography>
                            ))
                          )}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {missingRoles(k).map((role) => (
                            <Button key={role} size="small" variant="outlined" onClick={() => setAssigning({ slot: k, role })} sx={{ ml: 0.5, mb: 0.5 }}>
                              שיבוץ {role === "performer" ? "מבצע" : "עתודה"}
                            </Button>
                          ))}
                          {of(k.id).some(live) ? (
                            <IconButton size="small" aria-label="פעולות על התורנות" onClick={() => setOpenSlot(k.id)}>
                              <MoreIcon fontSize="small" />
                            </IconButton>
                          ) : (
                            <IconButton size="small" aria-label="מחיקת התורנות" onClick={() => setDeleting(k)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
          {running && (
            <Box>
              <Typography variant="body2" gutterBottom>
                המנוע משבץ את התורנויות החדשות…
                {running.status === "running" && running.params.slots ? <b>{` \u2066${running.params.staffed ?? 0}/${running.params.slots}\u2069 שובצו`}</b> : null}
              </Typography>
              <LinearProgress variant={running.status === "running" ? "determinate" : "indeterminate"} value={running.progress} />
            </Box>
          )}
          {!running && lastStability?.status === "failed" && <Alert severity="error">ההרצה האחרונה נכשלה: {jobErrorText(lastStability.error, lastStability.diagnosis)}</Alert>}
          {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          {pending.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button
                variant={withDraft.length ? "outlined" : "contained"}
                disabled={busy || !!running}
                onClick={() => run(() => api!.requestSchedule(cycleId, "stability"), null)}
              >
                {withDraft.length ? "הרצה מחדש" : "שיבוץ התורנויות החדשות"}
              </Button>
              {withDraft.length > 0 && (
                <Button
                  variant="contained"
                  color="success"
                  disabled={busy || !!running}
                  onClick={() => run(() => api!.publishAdditions(cycleId), "השיבוץ נוסף ללוח המפורסם.")}
                >
                  אישור והוספה ללוח
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h3">הפעלת עתודה וביטול הפעלה</Typography>
          <Typography variant="body2" color="text.secondary">
            הדרך המהירה: בלוח המפורסם לוחצים על התורנות. כאן אפשר לחפש תורנות לפי שם חייל, שם תורנות או תאריך, בכל המחזור.
          </Typography>
          <TextField
            size="small"
            label="חיפוש"
            placeholder="למשל: כהן, קצין תורן, 6.1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{ input: { startAdornment: <SearchIcon fontSize="small" sx={{ ml: 1, color: "text.secondary" }} /> } }}
            sx={{ maxWidth: 420 }}
          />
          {search.trim() && (
            found.length === 0 ? (
              <Typography color="text.secondary">לא נמצאו תורנויות מפורסמות שעוד לא הסתיימו.</Typography>
            ) : (
              <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
                {found.slice(0, 30).map((k) => {
                  const mine = of(k.id).filter(live);
                  return (
                    <Box
                      key={k.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenSlot(k.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenSlot(k.id))}
                      sx={{ py: 1, px: 0.5, cursor: "pointer", borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}
                    >
                      <Typography sx={{ fontWeight: 600 }}>
                        {slotName(k, (id) => taskName.get(id))} · {dayLabel(k.starts_at)} {timeLabel(k.starts_at)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {mine.filter(performs).map((a) => name(a.soldier_id) + (a.status === "reserve_activated" ? " (עתודה שהופעלה)" : "")).join(", ") || "לא מאויש"}
                        {" · עתודה: "}
                        {mine.filter((a) => a.role === "reserve" && a.status === "reserve_idle").map((a) => name(a.soldier_id)).join(", ") || "—"}
                      </Typography>
                    </Box>
                  );
                })}
                {found.length > 30 && (
                  <Typography variant="caption" color="text.secondary" sx={{ pt: 1 }}>
                    ועוד {found.length - 30} – צמצם את החיפוש
                  </Typography>
                )}
              </Stack>
            )
          )}
        </Stack>
      </Paper>
      {assigning && cycle && (
        <AssignDialog
          ctx={{
            cycle,
            slots: slots ?? [],
            tasks: new Map(tasks.map((t) => [t.id, t])),
            soldiers,
            assignments,
            reload: () => void load(),
            locked: true,
          }}
          slot={assigning.slot}
          role={assigning.role}
          current={null}
          published
          onClose={() => setAssigning(null)}
        />
      )}
      {deleting && (
        <Dialog open onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
          <DialogTitle>מחיקת תורנות</DialogTitle>
          <DialogContent dividers>
            <Typography>
              למחוק את <b>{slotName(deleting, (id) => taskName.get(id))}</b> ב{dayLabel(deleting.starts_at)} {timeLabel(deleting.starts_at)}?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              אין עליה שיבוץ מפורסם. הצעות המנוע לתורנות, אם יש, יימחקו איתה.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(null)}>ביטול</Button>
            <Button
              color="error"
              variant="contained"
              disabled={busy}
              onClick={() => {
                const k = deleting;
                setDeleting(null);
                void run(() => api!.deletePendingSlot(k.id), "התורנות נמחקה.");
              }}
            >
              מחיקה
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {openSlot && <SlotActionsDialog slotId={openSlot} onClose={() => setOpenSlot(null)} onChanged={() => void load()} />}
      {adding && (
        <AddSlotDialog
          tasks={tasks}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

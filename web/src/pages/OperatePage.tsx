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
import type { ExistingSoldier } from "../lib/roster";
import { useAuth } from "../lib/auth";
import type { NewSlot, SlotRow } from "../lib/baseSchedule";
import type { TaskType } from "../lib/catalog";
import { useCycle } from "../lib/cycleContext";
import { dayLabel, timeLabel } from "../lib/dates";
import type { DraftAssignment } from "../lib/draft";
import { isActive, type ScheduleJob } from "../lib/schedule";

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

function AddSlotDialog(props: { tasks: TaskType[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const { cycleId } = useCycle();
  const active = props.tasks.filter((t) => t.is_active);
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
    const day = times.start ? new Date(times.start) : tomorrow;
    setTimes(defaultTimes(props.tasks.find((t) => t.id === id), day));
  }

  async function save() {
    const start = new Date(times.start);
    const end = new Date(times.end);
    if (!taskId) return setError("בחר תורנות");
    if (!(end > start)) return setError("הסיום חייב להיות אחרי ההתחלה");
    if (performers < 1 || reserves < 0) return setError("לפחות מבצע אחד");
    const slot: NewSlot = {
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
            {active.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField type="datetime-local" label="התחלה" value={times.start} onChange={(e) => setTimes({ ...times, start: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            <TextField type="datetime-local" label="סיום" value={times.end} onChange={(e) => setTimes({ ...times, end: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField type="number" label="מבצעים" value={performers} onChange={(e) => setPerformers(Number(e.target.value))} slotProps={{ htmlInput: { min: 1 } }} fullWidth />
            <TextField type="number" label="עתודות" value={reserves} onChange={(e) => setReserves(Number(e.target.value))} slotProps={{ htmlInput: { min: 0 } }} fullWidth />
          </Stack>
          <FormControlLabel
            control={<Checkbox checked={surprise} onChange={(e) => setSurprise(e.target.checked)} />}
            label="הקפצה – תורנות שלא הוכרזה מראש (הניקוד מוכפל במקדם ההקפצה)"
          />
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

export function OperatePage() {
  const { api } = useAuth();
  const { cycle, cycleId } = useCycle();
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [soldiers, setSoldiers] = useState<Map<string, ExistingSoldier>>(new Map());
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [assignments, setAssignments] = useState<DraftAssignment[]>([]);
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [adding, setAdding] = useState(false);
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
  }, [api, cycleId]);
  useEffect(() => {
    load().catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [load]);

  const running = jobs.find(isActive);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [running, load]);

  const taskName = useMemo(() => new Map(tasks.map((t) => [t.id, t.name])), [tasks]);
  if (!cycle || !slots) return <CircularProgress />;
  if (cycle.status !== "published")
    return <Alert severity="info">התפעול השוטף נפתח אחרי שהמחזור מתפרסם. עד אז כל שינוי נעשה בטיוטה.</Alert>;

  // duties with nothing published on them: added after publishing (or left unfilled)
  const pending = slots.filter((k) => k.assigned === 0 && Date.parse(k.ends_at) > Date.now());
  const drafts = (id: string) => assignments.filter((a) => a.slot_id === id && a.status === "draft");
  const withDraft = pending.filter((k) => drafts(k.id).length > 0);
  const lastStability = jobs.find((j) => j.kind === "stability");
  const name = (id: string) => soldiers.get(id)?.full_name ?? "?";

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
              תורנויות שנוספו אחרי הפרסום
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
              תורנות חדשה
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            מוסיפים את התורנות, מריצים את המנוע רק עליה – כל מה שכבר פורסם נשאר כמו שהוא – ומאשרים את ההצעה כדי שתיכנס ללוח.
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
                          {taskName.get(k.task_type_id) ?? "?"}{" "}
                          {k.is_surprise && <Chip size="small" color="warning" icon={<BoltIcon />} label="הקפצה" />}
                        </TableCell>
                        <TableCell>
                          {d.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                              עוד לא שובץ
                            </Typography>
                          ) : (
                            d.map((a) => (
                              <Typography key={a.id} variant="body2">
                                {a.role === "performer" ? "מבצע" : "עתודה"}: <b>{name(a.soldier_id)}</b>
                                {a.role === "performer" ? ` · ${a.points} נק׳` : ""}
                              </Typography>
                            ))
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
              </Typography>
              <LinearProgress variant={running.status === "running" ? "determinate" : "indeterminate"} value={running.progress} />
            </Box>
          )}
          {!running && lastStability?.status === "failed" && <Alert severity="error">ההרצה האחרונה נכשלה: {lastStability.error}</Alert>}
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

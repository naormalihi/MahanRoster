import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  IconButton,
  Menu,
  MenuItem,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import type { SlotRow } from "../lib/baseSchedule";
import type { TaskType } from "../lib/catalog";
import type { Cycle } from "../lib/cycles";
import { dayLabel, TZ } from "../lib/dates";
import { REASON_LABEL } from "../lib/potential";
import {
  JOB_STATUS_LABEL,
  poolName,
  poolNames,
  warningText,
  elapsed,
  isActive,
  looksStuck,
  mmss,
  topReasons,
  type ScheduleJob,
  jobErrorText,
} from "../lib/schedule";

const tsFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtTs = (iso: string | null) => (iso ? tsFmt.format(new Date(iso)) : "—");
const dowFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });

function Loading() {
  return (
    <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

function SetupHelp() {
  return (
    <Alert severity="warning">
      <AlertTitle>ההפעלה האוטומטית של מנוע השיבוץ עוד לא מוגדרת</AlertTitle>
      <Typography variant="body2" component="div">
        אפשר להריץ גם עכשיו: אחרי "הרצת שיבוץ", פתח ב-GitHub את <b>Actions › solve › Run workflow</b>. כדי שההרצה תתחיל לבד:
        <ol style={{ margin: "8px 0", paddingInlineStart: 20 }}>
          <li>
            ב-GitHub: Settings › Developer settings › Personal access tokens › <b>Fine-grained tokens</b> › Generate new token. Repository access: רק
            MahanRoster. Permissions › Repository › <b>Actions: Read and write</b>. תוקף: שנה.
          </li>
          <li>
            ב-Supabase: SQL Editor, להריץ (עם הטוקן במקום ה-X):
            <Box component="pre" dir="ltr" sx={{ bgcolor: "grey.100", p: 1, borderRadius: 1, fontSize: 12, overflowX: "auto", my: 0.5 }}>
              select vault.create_secret('XXXX', 'github_dispatch_token');
            </Box>
          </li>
        </ol>
        הטוקן נשמר מוצפן ב-Supabase Vault ולא עובר בדפדפן.
      </Typography>
    </Alert>
  );
}

function ActiveJob({ job, onChanged }: { job: ScheduleJob; onChanged: () => void }) {
  const { api } = useAuth();
  const [now, setNow] = useState(Date.now());
  const [resp, setResp] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stuck = looksStuck(job, now);
  useEffect(() => {
    if (!stuck) return;
    api!
      .dispatchResponse(job.id)
      .then((r) => setResp(r ? (r.status_code === 204 ? "GitHub קיבל את הבקשה" : `GitHub החזיר ${r.status_code ?? ""} ${r.error ?? r.body ?? ""}`) : null))
      .catch(() => setResp(null));
  }, [api, job.id, stuck]);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h3" sx={{ flex: 1 }}>
            {job.status === "queued" ? "ממתין שמנוע השיבוץ יתחיל" : "מנוע השיבוץ רץ"}
          </Typography>
          {job.status === "running" && job.params.slots ? (
            <Typography variant="body2" sx={{ fontWeight: 700 }} title="משבצות שאוישו עד עכשיו מתוך כל המשבצות">
              {`\u2066${job.params.staffed ?? 0}/${job.params.slots}\u2069`} שובצו
              {job.params.months && job.params.months > 1 ? ` · חודש ${Math.min((job.params.month ?? 0) + 1, job.params.months)} מתוך ${job.params.months}` : ""}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 400 }}>
                {job.params.phase === "improving" ? "נמצא שיבוץ – המנוע משפר את האיזון בין החיילים" : "המנוע מחפש שיבוץ"}
              </Typography>
            </Typography>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            {mmss(elapsed(job.started_at ?? job.created_at, now))}
          </Typography>
        </Stack>
        <LinearProgress variant={job.status === "running" ? "determinate" : "indeterminate"} value={job.progress} />
        <Typography variant="body2" color="text.secondary">
          {job.status === "queued"
            ? "ההרצה מתחילה ב-GitHub בדרך כלל תוך דקה."
            : "המנוע משבץ חודש אחרי חודש. הרצה של חצי שנה לוקחת עד כ-7 דקות. אפשר לסגור את הדף ולחזור."}
          {job.params.run_url && (
            <>
              {" "}
              <Link href={job.params.run_url} target="_blank" rel="noreferrer">
                צפייה בהרצה ב-GitHub
              </Link>
            </>
          )}
        </Typography>
        {stuck && (
          <Alert severity="warning">
            ההרצה עוד לא התחילה.{" "}
            {job.params.dispatch === "sent"
              ? resp ?? "בקשת ההפעלה נשלחה ל-GitHub."
              : job.params.dispatch === "no_token"
                ? "חסר טוקן GitHub ב-Vault, ולכן לא נשלחה בקשת הפעלה."
                : "ההפעלה האוטומטית לא זמינה."}{" "}
            אפשר להפעיל ידנית ב-GitHub: Actions › solve › Run workflow.
          </Alert>
        )}
        <Stack direction="row" spacing={1}>
          {job.status === "queued" && (
            <Button
              onClick={async () => {
                await api!.redispatchSchedule(job.id);
                onChanged();
              }}
            >
              שליחת בקשת הפעלה שוב
            </Button>
          )}
          <Button
            color="error"
            onClick={async () => {
              await api!.cancelScheduleJob(job.id);
              onChanged();
            }}
          >
            ביטול ההרצה
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function Result({ job, slots, tasks, pools, names }: { job: ScheduleJob; slots: Map<string, SlotRow>; tasks: Map<string, TaskType>; pools: Map<string, string>; names: Map<string, string> }) {
  const slotLabel = (id: string) => {
    const k = slots.get(id);
    return k ? `${tasks.get(k.task_type_id)?.name ?? "תורנות"} (${dayLabel(k.starts_at)})` : "משבצת שנמחקה";
  };
  const unfilled = job.unfilled ?? [];
  const missingP = unfilled.filter((u) => u.role === "performer").reduce((n, u) => n + u.missing, 0);
  const missingR = unfilled.filter((u) => u.role === "reserve").reduce((n, u) => n + u.missing, 0);
  const ok = job.status === "done";
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h3" sx={{ flex: 1 }}>
            תוצאת ההרצה האחרונה
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {fmtTs(job.finished_at)}
            {job.wall_time ? ` · ${Math.round(job.wall_time)} שניות` : ""}
          </Typography>
        </Stack>
        {!ok ? (
          <Alert severity="error">
            ההרצה נכשלה. {jobErrorText(job.error?.split("\n").slice(-2).join(" ") || job.result_status, job.diagnosis)}
          </Alert>
        ) : (
          <Alert severity={missingP ? "warning" : "success"}>
            {missingP === 0 && missingR === 0
              ? "כל המשבצות אוישו, מבצעים ועתודות."
              : `חסרים ${missingP} מבצעים ו-${missingR} עתודות. הפירוט למטה.`}{" "}
            הטיוטה נשמרה; שיבוצים ידניים ומשבצות שפורסמו לא השתנו.{" "}
            <Link component={RouterLink} to="/draft">
              לטיוטה
            </Link>
          </Alert>
        )}
        {(job.warnings?.length ?? 0) > 0 && (
          <Alert severity="info">
            {job.warnings!.slice(0, 10).map((w, i) => (
              <div key={i}>{warningText(w, slotLabel, (id) => names.get(id) ?? "חייל לא מוכר", REASON_LABEL)}</div>
            ))}
            {job.warnings!.length > 10 && <div>ועוד {job.warnings!.length - 10} אזהרות.</div>}
          </Alert>
        )}
        {job.pools && job.pools.length > 0 && (
          <>
            <Typography variant="subtitle2">הוגנות לפי אוכלוסייה (ניקוד צפוי: חצי השנה האחרונה + הטיוטה)</Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {["אוכלוסייה", "חיילים", "ממוצע לפני", "ממוצע אחרי", "מינימום", "מקסימום", "סטיית תקן", "מקס׳ סופ״ש", "מקס׳ עתודות"].map((h) => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {job.pools.map((p) => (
                    <TableRow key={p.population}>
                      <TableCell sx={{ minWidth: 140 }}>{poolName(pools, p.population)}</TableCell>
                      <TableCell>{p.soldiers}</TableCell>
                      <TableCell>{p.mean_before.toFixed(1)}</TableCell>
                      <TableCell>{p.mean_after.toFixed(1)}</TableCell>
                      <TableCell>{p.min_after.toFixed(1)}</TableCell>
                      <TableCell>{p.max_after.toFixed(1)}</TableCell>
                      <TableCell>{p.stdev_after.toFixed(2)}</TableCell>
                      <TableCell>{p.max_weekends}</TableCell>
                      <TableCell>{p.max_reserves}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
        {unfilled.length > 0 && (
          <>
            <Typography variant="subtitle2">משבצות לא מאוישות והסיבה</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>מועד</TableCell>
                    <TableCell>תורנות</TableCell>
                    <TableCell>חסר</TableCell>
                    <TableCell>זכאים</TableCell>
                    <TableCell>למה אחרים לא מתאימים (מספר חיילים)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {unfilled.map((u, i) => {
                    const s = slots.get(u.slot_id);
                    return (
                      <TableRow key={i}>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{s ? dowFmt.format(new Date(s.starts_at)) : "—"}</TableCell>
                        <TableCell>{s ? tasks.get(s.task_type_id)?.name : "משבצת שנמחקה"}</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {u.missing} {u.role === "performer" ? "מבצע" : "עתודה"}
                        </TableCell>
                        <TableCell>{u.eligible_count}</TableCell>
                        <TableCell>{topReasons(u.reasons, REASON_LABEL)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Stack>
    </Paper>
  );
}

/**
 * The engine's status card at the top of the scheduling screen: a run in progress, the draft that is
 * ready (re-run and run details in the ⋮ menu), or – before any run, or after a failed one – the run
 * button with what it does. onDone fires when a run finishes, so the draft below reloads.
 */
export function SchedulePage({ onDone }: { onDone?: () => void } = {}) {
  const { api } = useAuth();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const { cycleId, reload: reloadCycle } = useCycle();
  const [tasks, setTasks] = useState<Map<string, TaskType>>(new Map());
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [jobs, setJobs] = useState<ScheduleJob[] | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pools, setPools] = useState<Map<string, string>>(new Map());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    api!.soldiers().then((s) => setNames(new Map(s.map((x) => [x.id, x.full_name])))).catch(() => setNames(new Map()));
  }, [api]);

  useEffect(() => {
    if (!cycleId) return;
    api!.snapshotSoldiers(cycleId).then((sn) => setPools(poolNames(sn))).catch(() => setPools(new Map()));
  }, [api, cycleId, jobs?.length]);

  useEffect(() => {
    Promise.all([api!.cycles(), api!.taskTypes(), api!.dispatchConfigured()])
      .then(([c, t, conf]) => {
        setCycles(c);
        setTasks(new Map(t.map((x) => [x.id, x])));
        setConfigured(conf);
      })
      .catch((e) => setError((e as Error).message));
  }, [api]);

  const loadJobs = useCallback(async () => {
    if (!cycleId) return;
    try {
      setJobs(await api!.scheduleJobs(cycleId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, cycleId]);

  useEffect(() => {
    if (!cycleId) return;
    setJobs(null);
    setSlots(null);
    void loadJobs();
    api!.cycleSlots(cycleId).then(setSlots).catch((e) => setError((e as Error).message));
  }, [api, cycleId, loadJobs]);

  const active = jobs?.find(isActive);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void loadJobs(), 4000);
    return () => clearInterval(t);
  }, [active, loadJobs]);
  // a run that just finished: the draft below reloads
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && jobs && !active) onDone?.();
    wasActive.current = !!active;
  }, [active, jobs, onDone]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [details, setDetails] = useState(false);

  async function run() {
    setConfirm(false);
    setError(null);
    try {
      await api!.requestSchedule(cycleId);
      await loadJobs();
      setCycles(await api!.cycles());
      void reloadCycle();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!cycles) return error ? <Alert severity="error">{error}</Alert> : <Loading />;
  const cycle = cycles.find((c) => c.id === cycleId);
  const last = jobs?.find((j) => !isActive(j));
  const slotMap = new Map((slots ?? []).map((s) => [s.id, s]));

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {!cycle ? (
        <Alert severity="info">צריך קודם ליצור מחזור בניהול המחזורים.</Alert>
      ) : (
        <>
          {configured === false && <SetupHelp />}
          {!jobs ? (
            <Loading />
          ) : active ? (
            <ActiveJob job={active} onChanged={loadJobs} />
          ) : last?.status === "done" ? (
            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <CheckCircleIcon color="success" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    {cycle.status === "published" || cycle.status === "closed" ? "הלוח פורסם" : "טיוטה מוכנה"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    הרצה אחרונה {fmtTs(last.finished_at ?? last.created_at)}
                    {last.wall_time ? ` · ${Math.round(last.wall_time)} ש׳` : ""}
                    {last.unfilled?.length ? ` · ${last.unfilled.reduce((n, u) => n + u.missing, 0)} לא אוישו` : ""}
                  </Typography>
                </Box>
                <IconButton aria-label="פעולות על ההרצה" onClick={(e) => setMenu(e.currentTarget)}>
                  <MoreVertIcon />
                </IconButton>
                <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                  <MenuItem
                    disabled={!slots?.length || cycle.status === "published" || cycle.status === "closed"}
                    onClick={() => {
                      setMenu(null);
                      setConfirm(true);
                    }}
                  >
                    הרצה מחדש
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenu(null);
                      setDetails(true);
                    }}
                  >
                    פרטי ההרצה וההיסטוריה
                  </MenuItem>
                </Menu>
              </Stack>
            </Paper>
          ) : (
            <>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                  <Chip label={slots ? `${slots.length} משבצות` : "…"} color={slots && !slots.length ? "warning" : "default"} />
                  <Chip
                    label={cycle.potential_computed_at ? "דרגות ואוכלוסיות נעולות" : "פוטנציאל לא חושב – יינעל בהרצה"}
                    color={cycle.potential_computed_at ? "default" : "warning"}
                    variant="outlined"
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  המנוע משבץ מבצע ועתודה לכל משבצת, לפי כללי הזכאות, החפיפות והאילוצים, ומאזן ניקוד, סופי שבוע ועתודות בתוך כל אוכלוסייה. הרצה חדשה
                  מחליפה את הטיוטה הקודמת של המנוע; שיבוצים ידניים נשמרים.
                </Typography>
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<PlayArrowIcon />}
                    disabled={!!active || !slots?.length || !jobs || cycle.status === "published" || cycle.status === "closed"}
                    onClick={() => setConfirm(true)}
                  >
                    הרצת שיבוץ
                  </Button>
                  {(cycle.status === "published" || cycle.status === "closed") && (
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ mr: 1.5 }}>
                      המחזור פורסם – שינויים מעכשיו דרך הניהול השוטף.
                    </Typography>
                  )}
                  {slots && !slots.length && (
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ mr: 1.5 }}>
                      קודם צריך לקלוט את לוח הבסיס.
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Paper>
              {last?.status === "failed" && <Result job={last} slots={slotMap} tasks={tasks} pools={pools} names={names} />}
            </>
          )}
          <Dialog open={details} onClose={() => setDetails(false)} maxWidth="md" fullWidth>
            <DialogTitle>פרטי ההרצה</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                {last && <Result job={last} slots={slotMap} tasks={tasks} pools={pools} names={names} />}
                {jobs && jobs.length > 1 && (
            <Paper variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>הרצה</TableCell>
                          <TableCell>סטטוס</TableCell>
                          <TableCell>משך</TableCell>
                          <TableCell>חוסרים</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {jobs.map((j) => (
                          <TableRow key={j.id}>
                            <TableCell>{fmtTs(j.created_at)}</TableCell>
                            <TableCell>{JOB_STATUS_LABEL[j.status]}</TableCell>
                            <TableCell>{j.wall_time ? `${Math.round(j.wall_time)} ש׳` : "—"}</TableCell>
                            <TableCell>{j.unfilled ? j.unfilled.reduce((n, u) => n + u.missing, 0) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Paper>
                      )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetails(false)}>סגירה</Button>
            </DialogActions>
          </Dialog>
        </>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>הרצת שיבוץ</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            המנוע ישבץ את {slots?.length ?? 0} המשבצות של {cycle?.name}. הטיוטה הקודמת של המנוע תוחלף; שיבוצים ידניים ומשבצות שכבר פורסמו לא ישתנו.
            {!cycle?.potential_computed_at && " הדרגות והאוכלוסיות יינעלו עכשיו למחזור."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>ביטול</Button>
          <Button variant="contained" onClick={run}>
            הרצה
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

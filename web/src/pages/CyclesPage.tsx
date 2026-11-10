import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import EditIcon from "@mui/icons-material/EditOutlined";
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
  IconButton,
  Paper,
  Stack,
  Step,
  StepButton,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import {
  STAGES,
  addDaysIso,
  planningCycle,
  cycleProblems,
  deadlineDay,
  endOfDay,
  stageIndex,
  stageLabel,
  suggestCycle,
  type Cycle,
  type CycleInput,
  type CycleStatus,
  type StageState,
  type StageTone,
} from "../lib/cycles";
import { dayKey } from "../lib/dates";
import { DeadlineEditor } from "../components/DeadlineEditor";

const fmt = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const today = () => dayKey(new Date());

/** The screen each stage is worked on – every step of the stepper opens it. */
const STAGE_SCREEN: Record<CycleStatus, { staff: string; reader: string }> = {
  draft: { staff: "/cycles", reader: "/cycle" },
  loading: { staff: "/soldiers/import", reader: "/soldiers" },
  collecting: { staff: "/cycle/constraints", reader: "/cycle/constraints" },
  approving: { staff: "/cycle/constraints?tab=exemptions&status=pending", reader: "/cycle/constraints?tab=exemptions" },
  potential: { staff: "/cycle/potential", reader: "/cycle/potential" },
  slots: { staff: "/cycle/slots", reader: "/cycle/slots" },
  scheduling: { staff: "/cycle/schedule", reader: "/cycle/schedule" },
  review: { staff: "/cycle/schedule", reader: "/cycle/schedule" },
  published: { staff: "/cycle/operate", reader: "/board" },
  closed: { staff: "/board", reader: "/board" },
};

const TONE_ICON: Record<StageTone, ReactNode> = {
  done: <CheckCircleIcon color="success" />,
  warn: <ErrorIcon color="warning" />,
  busy: <CircularProgress size={22} />,
  todo: <RadioButtonUncheckedIcon color="disabled" />,
};

function CycleDialog(props: { cycle: Cycle | null; all: Cycle[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [c, setC] = useState<CycleInput>(() =>
    props.cycle
      ? { name: props.cycle.name, start_date: props.cycle.start_date, end_date: props.cycle.end_date, exemption_deadline: props.cycle.exemption_deadline }
      : suggestCycle(props.all, today()),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(40);
  const problems = cycleProblems(c, props.all, props.cycle?.id);
  const isNew = !props.cycle;
  // the default distance comes from the settings; a new cycle takes it as soon as it is known
  useEffect(() => {
    api!.scoringSettings().then((s) => {
      setDays(s.exemption_deadline_days);
      if (isNew) setC((cur) => (cur.start_date ? { ...cur, exemption_deadline: endOfDay(addDaysIso(cur.start_date, -s.exemption_deadline_days)) } : cur));
    }, () => undefined);
  }, [api, isNew]);

  async function save() {
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    try {
      await api!.saveCycle(props.cycle?.id ?? null, { ...c, name: c.name.trim() });
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const date = (label: string, value: string, onChange: (v: string) => void, helper?: string) => (
    <TextField
      type="date"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{ inputLabel: { shrink: true } }}
      helperText={helper}
      fullWidth
    />
  );

  return (
    <Dialog open onClose={props.onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>{props.cycle ? "עריכת מחזור" : "מחזור חדש"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField label="שם" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} fullWidth />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {date("תחילת המחזור", c.start_date, (v) => setC({ ...c, start_date: v }))}
            {date("סוף המחזור", c.end_date, (v) => setC({ ...c, end_date: v }))}
          </Stack>
          {date(
            "סגירת אילוצים ופטורים – היום האחרון",
            c.exemption_deadline ? deadlineDay(c.exemption_deadline) : "",
            (v) => setC({ ...c, exemption_deadline: v ? endOfDay(v) : null }),
            c.start_date
              ? `עד 23:59 ביום הזה. ברירת המחדל: ${days} יום לפני תחילת המחזור (${fmt(addDaysIso(c.start_date, -days))}). אפשר לשנות גם אחר כך, במסך האילוצים.`
              : undefined,
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function StagePanel({ cycle, inWorkspace }: { cycle: Cycle; inWorkspace?: boolean }) {
  const { api, me } = useAuth();
  const staff = isStaff(me);
  const navigate = useNavigate();
  const vertical = useMediaQuery(useTheme().breakpoints.down("md"));
  const [states, setStates] = useState<StageState[] | null>(null);
  const i = stageIndex(cycle.status);
  const stage = STAGES[i];

  useEffect(() => {
    let live = true;
    api!.cycleStages(cycle.id).then((s) => live && setStates(s), () => live && setStates(null));
    return () => {
      live = false;
    };
  }, [api, cycle.id, cycle.status, cycle.exemption_deadline, cycle.potential_computed_at, cycle.published_at]);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h2" sx={{ ml: 1 }}>
            {inWorkspace ? "שלב המחזור" : cycle.name}
          </Typography>
          {!inWorkspace && (
            <Typography variant="body2" color="text.secondary">
              {fmt(cycle.start_date)} – {fmt(cycle.end_date)}
            </Typography>
          )}
          <DeadlineEditor cycle={cycle} />
        </Stack>
        <Stepper nonLinear activeStep={i} orientation={vertical ? "vertical" : "horizontal"} alternativeLabel={!vertical}>
          {STAGES.map((s) => {
            const st = states?.find((x) => x.stage === s.status);
            return (
              <Step key={s.status} completed={st ? st.tone === "done" : stageIndex(s.status) < i}>
                <StepButton
                  data-read
                  icon={st ? TONE_ICON[st.tone] : undefined}
                  optional={
                    st?.note ? (
                      <Typography variant="caption" color={st.tone === "warn" ? "warning.main" : "text.secondary"}>
                        {st.note}
                      </Typography>
                    ) : undefined
                  }
                  onClick={() => navigate(STAGE_SCREEN[s.status][staff ? "staff" : "reader"])}
                  sx={{
                    textAlign: "start",
                    borderRadius: 1,
                    "& .MuiStepLabel-label.Mui-active": { fontWeight: 700 },
                    "&:hover .MuiStepLabel-label": { color: "primary.main", textDecoration: "underline" },
                  }}
                >
                  {s.label}
                </StepButton>
              </Step>
            );
          })}
        </Stepper>
        <Alert severity="info" icon={false}>
          <b>{stage.label}:</b> {stage.hint}
        </Alert>
        <Typography variant="caption" color="text.secondary">
          השלב מתקדם לבד לפי מה שבוצע בפועל. לחיצה על שלב פותחת את המסך שלו.
        </Typography>
      </Stack>
    </Paper>
  );
}

export function CyclesPage() {
  const { api } = useAuth();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [editing, setEditing] = useState<Cycle | "new" | null>(null);
  const { cycleId: selected, setCycleId: setSelected, reload: reloadContext } = useCycle();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCycles(await api!.cycles());
      void reloadContext();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, reloadContext]);
  useEffect(() => void load(), [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!cycles)
    return (
      <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  const shown = cycles.find((c) => c.id === selected) ?? planningCycle(cycles, today());

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Typography variant="h1" sx={{ flex: 1 }}>
          ניהול מחזורים
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
          מחזור חדש
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        הגדרת המחזורים: שם, תאריכים ומועד סגירת האילוצים. לחיצה על שורה בוחרת את המחזור שבעבודה; ההתקדמות והשלבים מופיעים במסך המחזור.
      </Typography>
      {cycles.length === 0 && (
        <Alert severity="info">עוד אין מחזורים. צור את המחזור הראשון: חצי שנה, עם מועד סגירה לאילוצים ולפטורים.</Alert>
      )}
      {cycles.length > 0 && (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>מחזור</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>תאריכים</TableCell>
                <TableCell>סגירת אילוצים</TableCell>
                <TableCell>שלב</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {cycles.map((c) => (
                <TableRow key={c.id} hover selected={c.id === shown?.id} onClick={() => setSelected(c.id)} sx={{ cursor: "pointer" }}>
                  <TableCell sx={{ minWidth: 150 }}>
                    {c.name}
                    {c.id === shown?.id && <Chip size="small" variant="outlined" color="primary" label="בעבודה" sx={{ mr: 1 }} />}
                    <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "block", sm: "none" }, whiteSpace: "nowrap" }}>
                      {fmt(c.start_date)} – {fmt(c.end_date)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap", display: { xs: "none", sm: "table-cell" } }}>
                    {fmt(c.start_date)} – {fmt(c.end_date)}
                  </TableCell>
                  <TableCell>{c.exemption_deadline ? fmt(deadlineDay(c.exemption_deadline)) : "—"}</TableCell>
                  <TableCell>
                    <Chip size="small" label={stageLabel(c.status)} color={c.status === "published" ? "success" : "default"} />
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      aria-label="עריכה"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(c);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {editing && (
        <CycleDialog
          cycle={editing === "new" ? null : editing}
          all={cycles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

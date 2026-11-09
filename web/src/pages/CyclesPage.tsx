import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
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
import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import {
  STAGES,
  addDaysIso,
  planningCycle,
  cycleProblems,
  localMidnight,
  stageIndex,
  stageLabel,
  suggestCycle,
  type Cycle,
  type CycleInput,
  type CycleStatus,
} from "../lib/cycles";
import { dayKey } from "../lib/dates";

const fmt = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const today = () => dayKey(new Date());

/** Stages the app already has a screen for, and where it is. */
const STAGE_LINK: Partial<Record<CycleStatus, { to: string; label: string }>> = {
  loading: { to: "/soldiers/import", label: "לטעינת כוח אדם" },
  collecting: { to: "/cycle/constraints", label: "לאילוצים" },
  approving: { to: "/cycle/constraints?tab=exemptions&status=pending", label: "לפטורים הממתינים" },
  potential: { to: "/cycle/potential", label: "לפוטנציאל" },
  slots: { to: "/cycle/slots", label: "ללוח הבסיס" },
  scheduling: { to: "/cycle/schedule?view=run", label: "להרצה" },
  review: { to: "/cycle/schedule?view=draft", label: "לטיוטה" },
  published: { to: "/cycle/operate", label: "לתפעול" },
};

/** The screen each stage is worked on – every step of the stepper opens it. */
const STAGE_SCREEN: Record<CycleStatus, { staff: string; reader: string }> = {
  draft: { staff: "/cycles", reader: "/cycle" },
  loading: { staff: "/soldiers/import", reader: "/soldiers" },
  collecting: { staff: "/cycle/constraints", reader: "/cycle/constraints" },
  approving: { staff: "/cycle/constraints?tab=exemptions&status=pending", reader: "/cycle/constraints?tab=exemptions" },
  potential: { staff: "/cycle/potential", reader: "/cycle/potential" },
  slots: { staff: "/cycle/slots", reader: "/cycle/slots" },
  scheduling: { staff: "/cycle/schedule?view=run", reader: "/cycle/schedule?view=run" },
  review: { staff: "/cycle/schedule?view=draft", reader: "/cycle/schedule?view=draft" },
  published: { staff: "/cycle/operate", reader: "/board" },
  closed: { staff: "/board", reader: "/board" },
};

/** Stages after this one need screens that do not exist yet; the stepper stops here. */
const LAST_MANUAL_STAGE: CycleStatus = "slots";

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
  const problems = cycleProblems(c, props.all, props.cycle?.id);

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
            "מועד סגירת אילוצים ופטורים",
            c.exemption_deadline?.slice(0, 10) ?? "",
            (v) => setC({ ...c, exemption_deadline: v ? localMidnight(v) : null }),
            c.start_date ? `לפי הנוהל: 40 יום לפני תחילת המחזור (${fmt(addDaysIso(c.start_date, -40))})` : undefined,
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

export function StagePanel({ cycle, onChanged, inWorkspace }: { cycle: Cycle; onChanged: () => void; inWorkspace?: boolean }) {
  const { api, me } = useAuth();
  const staff = isStaff(me);
  const navigate = useNavigate();
  const vertical = useMediaQuery(useTheme().breakpoints.down("md"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const i = stageIndex(cycle.status);
  const stage = STAGES[i];
  const next = STAGES[i + 1];
  const prev = STAGES[i - 1];
  const canAdvance = !!next && i < stageIndex(LAST_MANUAL_STAGE);
  const link = STAGE_LINK[cycle.status];
  const deadlinePassed = cycle.exemption_deadline && Date.parse(cycle.exemption_deadline) < Date.now();

  async function move(to: CycleStatus) {
    setBusy(true);
    setError(null);
    try {
      await api!.setCycleStatus(cycle.id, to);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

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
          {cycle.exemption_deadline && (
            <Chip
              size="small"
              color={deadlinePassed ? "default" : "warning"}
              variant="outlined"
              label={`סגירת אילוצים: ${fmt(cycle.exemption_deadline)}${deadlinePassed ? " (עבר)" : ""}`}
            />
          )}
        </Stack>
        <Stepper nonLinear activeStep={i} orientation={vertical ? "vertical" : "horizontal"} alternativeLabel={!vertical}>
          {STAGES.map((s) => (
            <Step key={s.status} completed={stageIndex(s.status) < i}>
              <StepButton
                data-read
                onClick={() => navigate(STAGE_SCREEN[s.status][staff ? "staff" : "reader"])}
                sx={{ textAlign: "start", borderRadius: 1, "&:hover .MuiStepLabel-label": { color: "primary.main", textDecoration: "underline" } }}
              >
                {s.label}
              </StepButton>
            </Step>
          ))}
        </Stepper>
        <Alert severity="info" icon={false}>
          <b>{stage.label}:</b> {stage.hint}
        </Alert>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {link && (
            <Button variant="contained" component={RouterLink} to={link.to}>
              {link.label}
            </Button>
          )}
          {next && (
            <Button
              variant="outlined"
              endIcon={<ArrowBackIcon />}
              disabled={busy || !canAdvance}
              onClick={() => move(next.status)}
            >
              מעבר לשלב: {next.label}
            </Button>
          )}
          {prev && (
            <Button startIcon={<ArrowForwardIcon />} disabled={busy || i > stageIndex(LAST_MANUAL_STAGE)} onClick={() => move(prev.status)}>
              חזרה לשלב הקודם
            </Button>
          )}
        </Stack>
        {next && !canAdvance && (
          <Typography variant="caption" color="text.secondary">
            מכאן השלב מתקדם לבד: הרצת שיבוץ מעבירה ל"שיבוץ: הרצה" ול"שיבוץ: טיוטה", ופרסום מעביר ל"תפעול".
          </Typography>
        )}
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
      {shown ? (
        <StagePanel cycle={shown} onChanged={load} />
      ) : (
        <Alert severity="info">עוד אין מחזורים. צור את המחזור הראשון: חצי שנה, עם מועד סגירה לאילוצים ולפטורים.</Alert>
      )}
      {cycles.length > 0 && (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>מחזור</TableCell>
                <TableCell>תאריכים</TableCell>
                <TableCell>סגירת אילוצים</TableCell>
                <TableCell>שלב</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {cycles.map((c) => (
                <TableRow key={c.id} hover selected={c.id === shown?.id} onClick={() => setSelected(c.id)} sx={{ cursor: "pointer" }}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {fmt(c.start_date)} – {fmt(c.end_date)}
                  </TableCell>
                  <TableCell>{fmt(c.exemption_deadline)}</TableCell>
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

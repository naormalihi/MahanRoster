import CheckIcon from "@mui/icons-material/CheckCircle";
import WarnIcon from "@mui/icons-material/ErrorOutlineOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import TodoIcon from "@mui/icons-material/RadioButtonUnchecked";
import SyncIcon from "@mui/icons-material/Autorenew";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { stageLabel, type Cycle } from "../lib/cycles";
import { nextAction, STEPS, stepStates, type CycleFacts, type StepKey, type StepState, type Tone } from "../lib/workspace";
import { StagePanel } from "./CyclesPage";

const ConstraintsPage = lazy(() => import("./ConstraintsPage").then((m) => ({ default: m.ConstraintsPage })));
const PotentialPage = lazy(() => import("./PotentialPage").then((m) => ({ default: m.PotentialPage })));
const SlotsPage = lazy(() => import("./SlotsPage").then((m) => ({ default: m.SlotsPage })));
const SchedulePage = lazy(() => import("./SchedulePage").then((m) => ({ default: m.SchedulePage })));
const DraftPage = lazy(() => import("./DraftPage").then((m) => ({ default: m.DraftPage })));

const fmt = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export const TONE_ICON: Record<Tone, ReactNode> = {
  done: <CheckIcon fontSize="inherit" color="success" />,
  todo: <TodoIcon fontSize="inherit" sx={{ color: "text.disabled" }} />,
  warn: <WarnIcon fontSize="inherit" color="warning" />,
  busy: <SyncIcon fontSize="inherit" color="info" />,
};

/** Pending exemptions, slots and the last run – what the steps show. */
export function useCycleFacts(cycle: Cycle | undefined) {
  const { api } = useAuth();
  const [facts, setFacts] = useState<CycleFacts | null>(null);
  const load = useCallback(async () => {
    if (!cycle) return setFacts(null);
    const [ex, slots, jobs] = await Promise.all([
      api!.exemptions(cycle.start_date, cycle.end_date),
      api!.cycleSlots(cycle.id),
      api!.scheduleJobs(cycle.id),
    ]);
    const job = jobs.find((j) => j.kind === "full" || j.kind === "stability") ?? null;
    setFacts({
      pendingExemptions: ex.filter((e) => e.status === "pending").length,
      slots: slots.length,
      job: job && { status: job.status, unfilled: (job.unfilled ?? []).filter((u) => u.role === "performer").reduce((s, u) => s + u.missing, 0) },
    });
  }, [api, cycle]);
  useEffect(() => {
    load().catch(() => setFacts({ pendingExemptions: 0, slots: 0, job: null }));
  }, [load]);
  return { facts, reload: load };
}

function StepTabs({ step, states }: { step: StepKey; states: ReturnType<typeof stepStates> | null }) {
  return (
    <Tabs value={step} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: "divider", "& .MuiTab-root": { alignItems: "flex-start", textAlign: "start", minHeight: 58, py: 1 } }}>
      {STEPS.map((s, i) => {
        const st: StepState | undefined = s.key === "overview" ? undefined : states?.[s.key];
        return (
          <Tab
            key={s.key}
            value={s.key}
            component={RouterLink}
            to={s.path}
            label={
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14 }}>
                  {i > 0 ? `${i}. ` : ""}
                  {s.label}
                </Typography>
                {st ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: 12, color: "text.secondary" }}>
                    {TONE_ICON[st.tone]}
                    {st.text}
                  </Box>
                ) : (
                  <Box sx={{ fontSize: 12, color: "text.secondary" }}>שלב ומה הלאה</Box>
                )}
              </Box>
            }
          />
        );
      })}
    </Tabs>
  );
}

function Overview({ cycle, facts, onChanged }: { cycle: Cycle; facts: CycleFacts | null; onChanged: () => void }) {
  const navigate = useNavigate();
  const next = facts ? nextAction(cycle, facts) : null;
  return (
    <Stack spacing={2}>
      {next && (
        <Alert
          severity="info"
          action={
            next.step !== "overview" && (
              <Button data-read color="inherit" size="small" onClick={() => navigate(STEPS.find((s) => s.key === next.step)!.path)}>
                מעבר
              </Button>
            )
          }
        >
          <b>הצעד הבא:</b> {next.text}
        </Alert>
      )}
      <StagePanel cycle={cycle} onChanged={onChanged} inWorkspace />
    </Stack>
  );
}

/** Run and draft are one job: run the engine, then review, fix and publish – on one screen. */
function ScheduleStep({ facts }: { facts: CycleFacts | null }) {
  const [params, setParams] = useSearchParams();
  const hasDraft = facts?.job?.status === "done";
  const view = params.get("view") ?? (hasDraft ? "draft" : "run");
  return (
    <Stack spacing={2}>
      <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, v) => v && setParams({ view: v }, { replace: true })}>
        <ToggleButton value="run">הרצת המנוע</ToggleButton>
        <ToggleButton value="draft">טיוטה, תיקונים ופרסום</ToggleButton>
      </ToggleButtonGroup>
      {view === "run" ? <SchedulePage /> : <DraftPage />}
    </Stack>
  );
}

export function CycleWorkspace({ step }: { step: StepKey }) {
  const { cycles, cycle, locked, reload } = useCycle();
  const { facts, reload: reloadFacts } = useCycleFacts(cycle);

  if (!cycles)
    return (
      <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  if (!cycle)
    return (
      <Alert severity="info" action={<Button color="inherit" component={RouterLink} to="/cycles">ניהול מחזורים</Button>}>
        עוד אין מחזור. יוצרים מחזור חדש (חצי שנה, עם מועד סגירה לאילוצים) בניהול המחזורים.
      </Alert>
    );

  const states = facts ? stepStates(cycle, facts) : null;
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h1">{cycle.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {fmt(cycle.start_date)} – {fmt(cycle.end_date)}
          </Typography>
        </Box>
        <Chip label={`שלב: ${stageLabel(cycle.status)}`} color={locked ? "success" : "primary"} variant={locked ? "filled" : "outlined"} />
      </Stack>
      <StepTabs step={step} states={states} />
      {locked && step !== "overview" && (
        <Alert severity="success" icon={<LockIcon />}>
          המחזור פורסם{cycle.published_at ? ` ב-${fmt(cycle.published_at)}` : ""}. הפוטנציאל, לוח הבסיס והשיבוץ נעולים לעריכה. פטורים והיעדרויות
          אפשר עדיין להזין.
        </Alert>
      )}
      <Suspense
        fallback={
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
            <CircularProgress />
          </Box>
        }
      >
        <Box key={`${cycle.id}-${step}`}>
          {step === "overview" && (
            <Overview
              cycle={cycle}
              facts={facts}
              onChanged={() => {
                void reload();
                void reloadFacts();
              }}
            />
          )}
          {step === "constraints" && <ConstraintsPage />}
          {step === "potential" && <PotentialPage />}
          {step === "slots" && <SlotsPage />}
          {step === "schedule" && <ScheduleStep facts={facts} />}
        </Box>
      </Suspense>
    </Stack>
  );
}

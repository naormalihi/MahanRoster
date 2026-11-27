import CheckIcon from "@mui/icons-material/CheckCircle";
import WarnIcon from "@mui/icons-material/ErrorOutlineOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import TodoIcon from "@mui/icons-material/RadioButtonUnchecked";
import SyncIcon from "@mui/icons-material/Autorenew";
import NextIcon from "@mui/icons-material/ArrowBack";
import PrevIcon from "@mui/icons-material/ArrowForward";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { stageLabel, type Cycle } from "../lib/cycles";
import { draftFacts, pendingSlots, nextAction, STEPS, stepNav, stepStates, type CycleFacts, type StepKey, type StepState, type Tone } from "../lib/workspace";
import { StagePanel } from "./CyclesPage";
import { announceBoardChange } from "../components/SlotActions";
import { PagerBar, type PagerItem } from "../components/PagerBar";
import { useLiveTick } from "../lib/live";
import { IconBadge } from "../components/IconBadge";
import { STEP_LOOK } from "../components/StageIcons";

const ConstraintsPage = lazy(() => import("./ConstraintsPage").then((m) => ({ default: m.ConstraintsPage })));
const PotentialPage = lazy(() => import("./PotentialPage").then((m) => ({ default: m.PotentialPage })));
const SlotsPage = lazy(() => import("./SlotsPage").then((m) => ({ default: m.SlotsPage })));
const SchedulePage = lazy(() => import("./SchedulePage").then((m) => ({ default: m.SchedulePage })));
const DraftPage = lazy(() => import("./DraftPage").then((m) => ({ default: m.DraftPage })));
const OperatePage = lazy(() => import("./OperatePage").then((m) => ({ default: m.OperatePage })));

const fmt = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export const TONE_ICON: Record<Tone, ReactNode> = {
  done: <CheckIcon fontSize="inherit" color="success" />,
  todo: <TodoIcon fontSize="inherit" sx={{ color: "text.disabled" }} />,
  warn: <WarnIcon fontSize="inherit" color="warning" />,
  busy: <SyncIcon fontSize="inherit" color="info" />,
};

/** Pending exemptions, slots and the last run – what the steps show. */
export function useCycleFacts(cycle: Cycle | undefined) {
  const live = useLiveTick();
  const { api } = useAuth();
  const [facts, setFacts] = useState<CycleFacts | null>(null);
  const load = useCallback(async () => {
    if (!cycle) return setFacts(null);
    const published = cycle.status === "published";
    const [ex, slots, jobs, assignments] = await Promise.all([
      api!.exemptions(cycle.start_date, cycle.end_date),
      api!.cycleSlots(cycle.id),
      api!.scheduleJobs(cycle.id),
      api!.draftAssignments(cycle.id),
    ]);
    const job = jobs.find((j) => j.kind === "full" || j.kind === "stability" || j.kind === "update") ?? null;
    setFacts({
      pendingExemptions: ex.filter((e) => e.status === "pending").length,
      slots: slots.length,
      job: job && { status: job.status, unfilled: (job.unfilled ?? []).filter((u) => u.role === "performer").reduce((s, u) => s + u.missing, 0) },
      pendingAdditions: published ? pendingSlots(slots, assignments).length : 0,
      draft: published ? undefined : draftFacts(slots, assignments),
    });
  }, [api, cycle]);
  useEffect(() => {
    load().catch(() => setFacts({ pendingExemptions: 0, slots: 0, job: null }));
  }, [load, live]);
  // a change on the published board (activation, staffing) updates the step marks
  useEffect(() => {
    const on = () => void load().catch(() => undefined);
    window.addEventListener("mahanroster:board-changed", on);
    return () => window.removeEventListener("mahanroster:board-changed", on);
  }, [load]);
  return { facts, reload: load };
}

function StepTabs({ step, states }: { step: StepKey; states: ReturnType<typeof stepStates> | null }) {
  const narrow = useMediaQuery(useTheme().breakpoints.down("sm"));
  if (narrow) return <StepBar step={step} states={states} />;
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
              <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
              {s.key !== "overview" && <IconBadge icon={STEP_LOOK[s.key].icon} tone={STEP_LOOK[s.key].tone} size={26} />}
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
              </Stack>
            }
          />
        );
      })}
    </Tabs>
  );
}

/**
 * The steps on a phone: one line – "step 2 of 5 · potential" and its state – with arrows to the
 * steps around it and a dot per step; the line opens the full list.
 */
function StepBar({ step, states }: { step: StepKey; states: ReturnType<typeof stepStates> | null }) {
  const navigate = useNavigate();
  const DOT: Record<Tone, string> = { done: "success.main", warn: "warning.main", busy: "info.main", todo: "grey.300" };
  const items: PagerItem[] = STEPS.map((s) => {
    const st: StepState | undefined = s.key === "overview" ? undefined : states?.[s.key];
    return {
      key: s.key,
      label: s.label,
      dot: st ? DOT[st.tone] : undefined,
      status: st ? (
        <>
          {TONE_ICON[st.tone]}
          {st.text}
        </>
      ) : (
        "שלב ומה הלאה"
      ),
    };
  });
  const n = STEPS.length - 1;
  return (
    <PagerBar
      items={items}
      current={step}
      onGo={(k) => navigate(STEPS.find((s) => s.key === k)!.path)}
      title={(x, i) => (i > 0 ? `שלב ${i} מתוך ${n} · ${x.label}` : x.label)}
      menuLabel={(x, i) => (i > 0 ? `${i}. ${x.label}` : x.label)}
      floating
    />
  );
}

function Overview({ cycle, facts }: { cycle: Cycle; facts: CycleFacts | null }) {
  const navigate = useNavigate();
  const next = facts ? nextAction(cycle, facts) : null;
  return (
    <Stack spacing={2}>
      {next && (
        <Alert
          severity="info"
          action={
            next.path !== "/cycle" && (
              <Button data-read color="inherit" size="small" onClick={() => navigate(next.path)}>
                מעבר
              </Button>
            )
          }
        >
          <b>הצעד הבא:</b> {next.text}
        </Alert>
      )}
      <StagePanel cycle={cycle} inWorkspace />
    </Stack>
  );
}

/**
 * The way on from a step – the same at the end of every step: back, and on to the next one.
 * Never locked: the work of a step (constraints, potential) has no "done" to declare, so
 * whoever finished it moves on from here; what is still open is said beside the button.
 */
function StepFooter({ step, cycle, facts }: { step: StepKey; cycle: Cycle; facts: CycleFacts | null }) {
  const nav = stepNav(step, cycle, facts);
  if (step === "overview") return null; // the overview has its own "הצעד הבא"
  if (!nav.next && !nav.prev && !nav.note) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ flex: 1 }}>
          {nav.note && (
            <Typography variant="body2" color="text.secondary">
              {nav.note}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
          {nav.prev && (
            <Button data-read startIcon={<PrevIcon />} component={RouterLink} to={nav.prev.path}>
              {nav.prev.label}
            </Button>
          )}
          {nav.next && (
            <Button data-read variant="contained" endIcon={<NextIcon />} component={RouterLink} to={nav.next.path}>
              לשלב הבא: {nav.next.label}
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

/**
 * Run and draft are one job, on one screen: the engine's status card on top (run / running /
 * draft ready), and the draft under it – health tiles, the board and the soldiers.
 */
function ScheduleStep() {
  const [draftVersion, setDraftVersion] = useState(0);
  const onDone = useCallback(() => {
    setDraftVersion((v) => v + 1);
    announceBoardChange(); // the step marks (e.g. "המנוע רץ") follow
  }, []);
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <SchedulePage onDone={onDone} />
      <DraftPage key={draftVersion} />
    </Stack>
  );
}

export function CycleWorkspace({ step }: { step: StepKey }) {
  const { cycles, cycle, locked } = useCycle();
  const { facts } = useCycleFacts(cycle);
  const navigate = useNavigate();

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
          <Typography variant="h1">תכנון ושיבוץ</Typography>
          <Typography variant="body2" color="text.secondary">
            {cycle.name} · {fmt(cycle.start_date)} – {fmt(cycle.end_date)}
          </Typography>
        </Box>
        <Chip label={`שלב: ${stageLabel(cycle.status)}`} color={locked ? "success" : "primary"} variant={locked ? "filled" : "outlined"} />
      </Stack>
      <StepTabs step={step} states={states} />
      {/* the schedule step says it on its own status card */}
      {locked && step !== "overview" && step !== "operate" && step !== "schedule" && (
        <Alert
          severity="success"
          icon={<LockIcon />}
          action={
            cycle.status === "published" && (
              <Button data-read color="inherit" size="small" onClick={() => navigate("/cycle/operate")}>
                לתפעול
              </Button>
            )
          }
        >
          המחזור פורסם{cycle.published_at ? ` ב-${fmt(cycle.published_at)}` : ""}. הפוטנציאל, לוח המשימות והשיבוץ נעולים; שינויים נעשים בתפעול.
          פטורים והיעדרויות אפשר עדיין להזין.
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
            <Overview cycle={cycle} facts={facts} />
          )}
          {step === "constraints" && <ConstraintsPage />}
          {step === "potential" && <PotentialPage />}
          {step === "slots" && <SlotsPage />}
          {step === "schedule" && <ScheduleStep />}
          {step === "operate" && <OperatePage />}
        </Box>
        <StepFooter step={step} cycle={cycle} facts={facts} />
      </Suspense>
    </Stack>
  );
}

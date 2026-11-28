import BoardIcon from "@mui/icons-material/CalendarMonthOutlined";
import CyclesIcon from "@mui/icons-material/AutorenewOutlined";
import PeopleIcon from "@mui/icons-material/GroupsOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import { alpha, type Theme } from "@mui/material/styles";
import { FixRequestsDialog } from "../components/FixRequests";
import type { StaffFixRequest } from "../lib/profile";
import { MyNextDuty } from "../components/MyNextDuty";
import { UnackedCard } from "../components/UnackedCard";
import { SwapLogCard } from "../components/SwapDialog";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { EmptyState, greeting } from "../components/EmptyState";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { isStaff, type BoardRow } from "../lib/api";
import { mfaResetters } from "../lib/users";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { stageLabel } from "../lib/cycles";
import { addDays } from "../lib/dates";
import { currentStep, nextAction, STEPS, stepStates, type StepKey } from "../lib/workspace";
import { weekDays, type WeekDay } from "../lib/weekDays";
import { TONE_ICON, useCycleFacts } from "./CycleWorkspace";
import { IconBadge } from "../components/IconBadge";
import { STEP_LOOK } from "../components/StageIcons";
import { ORPHAN_KIND, orphanRequests, type Orphan } from "../lib/orphans";
import { FeedbackInbox } from "../components/FeedbackInbox";
import { dayKey } from "../lib/dates";
import { useLiveTick } from "../lib/live";

const fmtDay = (iso: string) => iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") + "/" + iso.slice(2, 4);

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25, borderRadius: 3 }}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="h3" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

/** "הצעד הבא" – the top of the page, wide: the step's icon, what to do, and a button to its screen (2.75). */
function NextStepBanner({ text, path, step }: { text: string; path: string; step: StepKey }) {
  const look = step === "overview" ? null : STEP_LOOK[step];
  const label = STEPS.find((s) => s.key === step)?.label;
  return (
    <Paper
      variant="outlined"
      sx={(t) => ({
        p: { xs: 1.5, sm: 2 },
        borderRadius: 3,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: { xs: "wrap", sm: "nowrap" },
        borderColor: alpha(t.palette.primary.main, 0.5),
        background: `linear-gradient(270deg, ${t.palette.background.paper}, ${alpha(t.palette.primary.main, 0.1)})`,
      })}
    >
      {look && <IconBadge icon={look.icon} tone={look.tone} size={42} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 700 }}>
          הצעד הבא
        </Typography>
        <Typography sx={{ fontWeight: 700, fontSize: { xs: 16, sm: 18 }, lineHeight: 1.3 }}>{text}</Typography>
      </Box>
      <Button variant="contained" endIcon={<ArrowBackIcon />} component={RouterLink} to={path} sx={{ whiteSpace: "nowrap", width: { xs: "100%", sm: "auto" } }}>
        {look && label ? `מעבר ל${label}` : "מעבר"}
      </Button>
    </Paper>
  );
}

/** The cycle's five steps: side by side on a wide screen, a list on a phone (2.75). */
function StepsView({ step, states, wide }: { step: number; states: ReturnType<typeof stepStates> | null; wide: boolean }) {
  return (
    <Box sx={wide ? { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 1 } : { display: "flex", flexDirection: "column", gap: 0.5 }}>
      {STEPS.slice(1).map((s, i) => {
        const key = s.key as Exclude<StepKey, "overview">;
        const st = states?.[key];
        const at = i + 1;
        const now = at === step;
        // a step behind shows its state; one ahead only if something waits there (a pending exemption)
        const mark = st && (at < step || st.tone === "warn" || st.tone === "busy") ? TONE_ICON[st.tone] : null;
        const seg = at < step ? "success.main" : now ? "primary.main" : "action.selected";
        const end = now ? (
          <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 700 }}>
            עכשיו
          </Typography>
        ) : mark ? (
          <Box sx={{ fontSize: 20, display: "flex" }}>{mark}</Box>
        ) : wide && at > step ? (
          <Typography variant="caption" color="text.secondary">
            בהמשך
          </Typography>
        ) : null;
        const box = (t: Theme) => ({
          textDecoration: "none",
          color: "inherit",
          borderRadius: 2.5,
          opacity: at > step ? 0.6 : 1,
          bgcolor: now ? alpha(t.palette.primary.main, 0.1) : undefined,
          outline: now && wide ? `1px solid ${alpha(t.palette.primary.main, 0.45)}` : undefined,
          "&:hover": { bgcolor: alpha(t.palette.primary.main, now ? 0.16 : 0.06), opacity: 1 },
        });
        return wide ? (
          <Stack key={s.key} component={RouterLink} to={s.path} sx={(t) => ({ ...box(t), p: 1.25, gap: 0.75 })}>
            <Box sx={{ height: 5, borderRadius: 3, bgcolor: seg }} />
            <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
              <IconBadge icon={STEP_LOOK[key].icon} tone={STEP_LOOK[key].tone} size={30} />
              <Typography variant="caption" color="text.secondary">
                שלב {at}
              </Typography>
            </Stack>
            <Typography sx={{ fontWeight: 700, lineHeight: 1.3 }}>{s.label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {st?.text}
            </Typography>
            <Box sx={{ minHeight: 22, display: "flex", alignItems: "center" }}>{end}</Box>
          </Stack>
        ) : (
          <Stack key={s.key} direction="row" component={RouterLink} to={s.path} sx={(t) => ({ ...box(t), alignItems: "center", gap: 1.25, py: 0.75, px: 1, mx: -1 })}>
            <IconBadge icon={STEP_LOOK[key].icon} tone={STEP_LOOK[key].tone} size={30} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, lineHeight: 1.3 }}>{s.label}</Typography>
              <Typography variant="body2" color="text.secondary">
                {st?.text}
              </Typography>
            </Box>
            {end}
          </Stack>
        );
      })}
    </Box>
  );
}

const weekdayFmt = new Intl.DateTimeFormat("he-IL", { weekday: "narrow", timeZone: "Asia/Jerusalem" });

/** "השבוע הקרוב": a row per day – how busy, and the days with an unstaffed duty in red (2.75). */
function WeekRows({ days }: { days: WeekDay[] }) {
  const total = days.reduce((n, d) => n + d.duties, 0);
  const missing = days.reduce((n, d) => n + d.unstaffed, 0);
  const top = Math.max(1, ...days.map((d) => d.duties));
  return (
    <Stack spacing={0.25}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {total} משימות
        </Typography>
        {missing > 0 ? <Chip size="small" color="error" label={`${missing} לא מאוישות`} /> : <Chip size="small" color="success" variant="outlined" label="כולן מאוישות" />}
      </Stack>
      {days.map((d) => (
        <Box
          key={d.key}
          component={RouterLink}
          to={`/board?day=${d.key}`}
          sx={(t) => ({
            display: "grid",
            gridTemplateColumns: "64px minmax(0, 1fr) 72px",
            alignItems: "center",
            gap: 1,
            px: 0.75,
            py: 0.4,
            borderRadius: 1.5,
            textDecoration: "none",
            color: "inherit",
            bgcolor: d.unstaffed ? alpha(t.palette.error.main, 0.12) : undefined,
            "&:hover": { bgcolor: d.unstaffed ? alpha(t.palette.error.main, 0.2) : "action.hover" },
          })}
        >
          <Typography variant="body2" noWrap>
            <b>{weekdayFmt.format(new Date(`${d.key}T12:00:00Z`))}</b>{" "}
            <Box component="span" sx={{ color: "text.secondary" }}>
              {Number(d.key.slice(8))}.{Number(d.key.slice(5, 7))}
            </Box>
          </Typography>
          <Box sx={{ height: 6, borderRadius: 3, bgcolor: "action.selected", overflow: "hidden" }}>
            <Box sx={{ height: 1, width: `${(d.duties / top) * 100}%`, bgcolor: d.unstaffed ? "error.main" : "success.main", borderRadius: 3 }} />
          </Box>
          <Typography variant="caption" sx={{ textAlign: "end", color: d.unstaffed ? "error.main" : "text.secondary", fontWeight: d.unstaffed ? 700 : undefined }}>
            {d.unstaffed ? `${d.unstaffed} חסרים` : d.duties ? `${d.duties} משימות` : "—"}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

/** אחראי השיבוצים's home: where the cycle stands, what waits, and the coming days. */
export function HomePage() {
  const live = useLiveTick();
  const { api, me } = useAuth();
  const staff = isStaff(me);
  const { cycle, cycles } = useCycle();
  const { facts } = useCycleFacts(cycle);
  const [week, setWeek] = useState<BoardRow[] | null>(null);

  // requests for days no cycle covers – invisible in the constraints screens until one does
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  // employees' "לא נכון?" requests
  const [fixes, setFixes] = useState<StaffFixRequest[]>([]);
  const [fixesOpen, setFixesOpen] = useState(false);
  const loadFixes = useCallback(() => {
    if (!staff) return;
    api!
      .profileFixes()
      .then(setFixes)
      .catch(() => setFixes([]));
  }, [api, staff]);
  useEffect(loadFixes, [loadFixes]);
  const [dropping, setDropping] = useState<Orphan | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  async function drop(o: Orphan) {
    setDropError(null);
    try {
      if (o.kind === "exemption") await api!.deleteExemption(o.id);
      else if (o.kind === "absence") await api!.deleteAbsence(o.id);
      else await api!.deleteDateBlock(o.id);
      setOrphans((list) => list.filter((x) => x.id !== o.id));
      setDropping(null);
    } catch (e) {
      setDropError((e as Error).message);
    }
  }
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!staff || !cycles) return;
    const today = dayKey(new Date());
    const until = dayKey(addDays(new Date(), 450));
    Promise.all([api!.exemptions(today, until), api!.absences(today, until), api!.dateBlocks(today, until), api!.soldiers()])
      .then(([e, a, b, s]) => {
        setOrphans(orphanRequests(e, a, b, cycles, today));
        setNames(new Map(s.map((x) => [x.id, x.full_name])));
      })
      .catch(() => setOrphans([]));
  }, [api, staff, cycles, live]);

  // a single אחראי השיבוצים who loses his phone has no one to reset his two-step login
  const [resetters, setResetters] = useState<number | null>(null);
  useEffect(() => {
    if (!staff) return;
    api!.listUsers().then((u) => setResetters(mfaResetters(u).length), () => setResetters(null));
  }, [api, staff, live]);

  // soldiers see "למי לפנות" only once אחראי השיבוצים chose someone
  const [contacts, setContacts] = useState<number | null>(null);
  useEffect(() => {
    if (!staff) return;
    api!.soldierContactsList().then((c) => setContacts(c.length), () => setContacts(null));
  }, [api, staff, live]);

  useEffect(() => {
    const now = new Date();
    api!.board(now.toISOString(), addDays(now, 7).toISOString()).then(setWeek).catch(() => setWeek([]));
  }, [api, live]);

  const states = cycle && facts ? stepStates(cycle, facts) : null;
  const next = cycle && facts ? nextAction(cycle, facts) : null;
  const step = cycle ? currentStep(cycle.status) : 0;
  const days = weekDays(week ?? [], new Date());
  const wide = useMediaQuery(useTheme().breakpoints.up("md"));

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h1">תמונת מצב</Typography>
        <Typography variant="body2" color="text.secondary">
          {greeting()}
          {me?.username ? `, ${me.username}` : ""} · מה ממתין לך היום
        </Typography>
      </Box>

      {fixes.length > 0 && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => setFixesOpen(true)}>
              טיפול
            </Button>
          }
        >
          <b>בקשות תיקון פרטים ({fixes.length})</b>
          <Box component="ul" sx={{ m: 0, mt: 0.5, pr: 2.5, pl: 0 }}>
            {fixes.slice(0, 5).map((f) => (
              <li key={f.id}>
                {names.get(f.soldier_id) ?? "עובד"} · {f.field}: {f.requested}
              </li>
            ))}
            {fixes.length > 5 && <li>ועוד {fixes.length - 5}</li>}
          </Box>
        </Alert>
      )}
      {fixesOpen && <FixRequestsDialog names={names} onClose={() => setFixesOpen(false)} onChanged={loadFixes} />}
      {orphans.length > 0 && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" component={RouterLink} to="/cycles">
              ניהול מחזורים
            </Button>
          }
        >
          <b>
            {orphans.length === 1 ? "בקשה אחת" : `${orphans.length} בקשות`} לתאריכים שאין להם מחזור
          </b>{" "}
          – הן לא מופיעות באילוצים עד שייפתח מחזור לתאריכים האלה (או שמחזור קיים יוארך).
          <Box component="ul" sx={{ m: 0, mt: 0.5, pr: 2.5, pl: 0 }}>
            {orphans.slice(0, 6).map((o) => (
              <li key={o.id}>
                {names.get(o.soldier_id) ?? "עובד"} · {ORPHAN_KIND[o.kind]}
                {o.pending ? " (ממתין)" : ""} · {fmtDay(o.from)}
                {o.to !== o.from ? `–${fmtDay(o.to)}` : ""}{" "}
                <Button size="small" color="inherit" sx={{ minWidth: 0, py: 0, textDecoration: "underline" }} onClick={() => setDropping(o)}>
                  מחיקה
                </Button>
              </li>
            ))}
            {orphans.length > 6 && <li>ועוד {orphans.length - 6}</li>}
          </Box>
          <Box sx={{ mt: 0.5, fontSize: "0.85em" }}>
            מעכשיו עובדים לא יכולים להגיש לתאריכים בלי מחזור. בקשה שכבר נכנסה – מוחקים אותה כאן, או פותחים מחזור (או מאריכים קיים) לתאריכים שלה.
          </Box>
        </Alert>
      )}
      {dropping && (
        <Dialog open onClose={() => setDropping(null)} fullWidth maxWidth="xs">
          <DialogTitle>מחיקת בקשה</DialogTitle>
          <DialogContent dividers>
            <Typography>
              {names.get(dropping.soldier_id) ?? "עובד"} · {ORPHAN_KIND[dropping.kind]} · {fmtDay(dropping.from)}
              {dropping.to !== dropping.from ? `–${fmtDay(dropping.to)}` : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              הבקשה תימחק לגמרי (נרשם ביומן הביקורת). כדאי לעדכן את העובד שיגיש שוב כשייפתח מחזור.
            </Typography>
            {dropError && <Alert severity="error" sx={{ mt: 1 }}>{dropError}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDropping(null)}>ביטול</Button>
            <Button variant="contained" color="error" onClick={() => void drop(dropping)}>
              מחיקה
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {resetters !== null && resetters <= 1 && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" component={RouterLink} to="/admin?tab=users">
              משתמשים
            </Button>
          }
        >
          כדאי למנות אחראי שיבוצים או מ״מ נוסף: אם תחליף טלפון, הוא יוכל לאפס לך את האימות הדו-שלבי.
        </Alert>
      )}
      {cycle && next && <NextStepBanner text={next.text} path={next.path} step={next.step} />}
      <MyNextDuty />
      <UnackedCard />
      <FeedbackInbox home />

      {contacts === 0 && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" component={RouterLink} to="/admin?tab=contacts">
              אנשי קשר
            </Button>
          }
        >
          עוד לא נבחרו אנשי קשר לעובדים – בלי זה העובדים לא רואים למי לפנות ואיך.
        </Alert>
      )}

      {cycles && !cycle && (
        <Alert severity="info" action={<Button color="inherit" component={RouterLink} to="/cycles">ניהול מחזורים</Button>}>
          עוד אין מחזור. מתחילים ביצירת מחזור.
        </Alert>
      )}

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: cycle ? "minmax(0, 1fr) 300px" : "minmax(0, 1fr)" }, alignItems: "stretch" }}>
        {cycle && (
          <Card
            title={cycle.name}
            action={
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
                  {fmtDay(cycle.start_date)} – {fmtDay(cycle.end_date)}
                </Typography>
                <Chip size="small" label={step >= 1 && step <= 5 ? `שלב ${step} מתוך 5` : stageLabel(cycle.status)} color="primary" variant="outlined" />
              </Stack>
            }
          >
            {!next && <CircularProgress size={20} />}
            <StepsView step={step} states={states} wide={wide} />
          </Card>
        )}

        <Card title="השבוע הקרוב" action={<Button size="small" component={RouterLink} to="/board">ללוח</Button>}>
          {!week ? (
            <CircularProgress size={20} />
          ) : week.length === 0 ? (
            <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
              <EmptyState size="sm" pose="sleep" title="שקט השבוע" text="אין משימות מפורסמות בשבעת הימים הקרובים." />
            </Box>
          ) : (
            <WeekRows days={days} />
          )}
        </Card>
      </Box>

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, minmax(0, 1fr))" } }}>
        {(
          [
            { to: "/soldiers", label: "כוח אדם", hint: staff ? "חיפוש, עריכה וטעינה" : "חיפוש ופרטי עובדים", icon: <PeopleIcon />, tone: "info" },
            { to: "/board", label: "לוח השיבוצים", hint: "מה שכל היחידה רואה", icon: <BoardIcon />, tone: "success" },
            { to: "/cycles", label: "ניהול מחזורים", hint: "תאריכים וסגירת אילוצים", icon: <CyclesIcon />, tone: "warning" },
            { to: "/admin", label: "הגדרות", hint: "קטלוג, משקלים, חגים", icon: <SettingsIcon />, tone: "primary" },
          ] as const
        )
          .filter((l) => staff || (l.to !== "/cycles" && l.to !== "/admin"))
          .map((l) => (
            <Paper
              key={l.to}
              variant="outlined"
              component={RouterLink}
              to={l.to}
              sx={{
                p: { xs: 1.75, md: 1.5 },
                borderRadius: 3,
                textDecoration: "none",
                color: "inherit",
                display: "flex",
                flexDirection: { xs: "column", md: "row" },
                alignItems: { xs: "flex-start", md: "center" },
                gap: { xs: 1, md: 1.5 },
                "&:hover": { borderColor: `${l.tone}.main` },
              }}
            >
              <IconBadge icon={l.icon} tone={l.tone} size={wide ? 40 : 44} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, fontSize: { xs: 17, md: 15 } }}>{l.label}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap={wide}>
                  {l.hint}
                </Typography>
              </Box>
            </Paper>
          ))}
      </Box>
      <SwapLogCard />
    </Stack>
  );
}

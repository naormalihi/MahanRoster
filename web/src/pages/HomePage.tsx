import { MyNextDuty } from "../components/MyNextDuty";
import { UnackedCard } from "../components/UnackedCard";
import { SwapLogCard } from "../components/SwapDialog";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from "@mui/material";
import { EmptyState, greeting } from "../components/EmptyState";
import { useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { isStaff, type BoardRow } from "../lib/api";
import { mfaResetters } from "../lib/users";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { stageLabel } from "../lib/cycles";
import { addDays, dayLabel, timeLabel } from "../lib/dates";
import { nextAction, STEPS, stepStates } from "../lib/workspace";
import { TONE_ICON, useCycleFacts } from "./CycleWorkspace";
import { ORPHAN_KIND, orphanRequests, type Orphan } from "../lib/orphans";
import { FeedbackInbox } from "../components/FeedbackInbox";
import { dayKey } from "../lib/dates";
import { useLiveTick } from "../lib/live";

const fmtDay = (iso: string) => iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") + "/" + iso.slice(2, 4);

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
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
  const unstaffed = (week ?? []).filter((r) => !r.performers.length);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h1">תמונת מצב</Typography>
        <Typography variant="body2" color="text.secondary">
          {greeting()}
          {me?.username ? `, ${me.username}` : ""} · מה ממתין לך היום
        </Typography>
      </Box>

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

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "3fr 2fr" }, alignItems: "start" }}>
        {cycle && (
          <Card
            title={cycle.name}
            action={<Chip size="small" label={stageLabel(cycle.status)} color="primary" variant="outlined" />}
          >
            {next ? (
              <Alert
                severity="info"
                icon={false}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    endIcon={<ArrowBackIcon />}
                    component={RouterLink}
                    to={next.path}
                  >
                    מעבר
                  </Button>
                }
              >
                <b>הצעד הבא:</b> {next.text}
              </Alert>
            ) : (
              <CircularProgress size={20} />
            )}
            <Stack spacing={0.75}>
              {STEPS.slice(1).map((s) => {
                const st = states?.[s.key as Exclude<typeof s.key, "overview">];
                return (
                  <Stack
                    key={s.key}
                    direction="row"
                    component={RouterLink}
                    to={s.path}
                    sx={{ alignItems: "center", gap: 1, textDecoration: "none", color: "inherit", py: 0.5, "&:hover": { color: "primary.main" } }}
                  >
                    <Box sx={{ fontSize: 18, display: "flex" }}>{st ? TONE_ICON[st.tone] : null}</Box>
                    <Typography sx={{ fontWeight: 600, minWidth: 110 }}>{s.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {st?.text}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          </Card>
        )}

        <Card title="השבוע הקרוב" action={<Button size="small" component={RouterLink} to="/board">ללוח</Button>}>
          {!week ? (
            <CircularProgress size={20} />
          ) : week.length === 0 ? (
            <EmptyState size="sm" pose="sleep" title="שקט השבוע" text="אין משימות מפורסמות בשבעת הימים הקרובים." />
          ) : (
            <>
              <Typography>
                <b>{week.length}</b> משימות מפורסמות בשבעת הימים הקרובים
                {unstaffed.length > 0 ? (
                  <Box component="span" sx={{ color: "error.main", fontWeight: 700 }}>
                    {` · ${unstaffed.length} לא מאוישות`}
                  </Box>
                ) : (
                  " · כולן מאוישות"
                )}
              </Typography>
              {unstaffed.slice(0, 5).map((r) => (
                <Typography key={r.slot_id} variant="body2" color="error.main">
                  {r.task_name} – {dayLabel(r.starts_at)} {timeLabel(r.starts_at)}
                </Typography>
              ))}
            </>
          )}
        </Card>
      </Box>

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        {[
          { to: "/soldiers", label: "כוח אדם", hint: staff ? "חיפוש, עריכה וטעינת כוח אדם" : "חיפוש ופרטי עובדים" },
          { to: "/board", label: "לוח השיבוצים", hint: "מה שכל היחידה רואה" },
          { to: "/cycles", label: "ניהול מחזורים", hint: "יצירה, תאריכים ומועד סגירת אילוצים" },
          { to: "/admin", label: "הגדרות", hint: "קטלוג, משקלים, חגים" },
        ]
          .filter((l) => staff || (l.to !== "/cycles" && l.to !== "/admin"))
          .map((l) => (
          <Paper
            key={l.to}
            variant="outlined"
            component={RouterLink}
            to={l.to}
            sx={{ p: 1.75, textDecoration: "none", color: "inherit", "&:hover": { borderColor: "primary.main" } }}
          >
            <Typography sx={{ fontWeight: 700 }}>{l.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {l.hint}
            </Typography>
          </Paper>
        ))}
      </Box>
      <SwapLogCard />
    </Stack>
  );
}

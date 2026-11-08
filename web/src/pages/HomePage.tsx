import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { isStaff, type BoardRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { stageLabel } from "../lib/cycles";
import { addDays, dayLabel, timeLabel } from "../lib/dates";
import { nextAction, STEPS, stepStates } from "../lib/workspace";
import { TONE_ICON, useCycleFacts } from "./CycleWorkspace";

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

/** נע"ת's home: where the cycle stands, what waits, and the coming days. */
export function HomePage() {
  const { api, me } = useAuth();
  const staff = isStaff(me);
  const { cycle, cycles } = useCycle();
  const { facts } = useCycleFacts(cycle);
  const [week, setWeek] = useState<BoardRow[] | null>(null);

  useEffect(() => {
    const now = new Date();
    api!.board(now.toISOString(), addDays(now, 7).toISOString()).then(setWeek).catch(() => setWeek([]));
  }, [api]);

  const states = cycle && facts ? stepStates(cycle, facts) : null;
  const next = cycle && facts ? nextAction(cycle, facts) : null;
  const unstaffed = (week ?? []).filter((r) => !r.performers.length);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h1">שלום{me?.username ? `, ${me.username}` : ""}</Typography>
        <Typography variant="body2" color="text.secondary">
          מה ממתין לך היום
        </Typography>
      </Box>

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
                    to={STEPS.find((s) => s.key === next.step)!.path}
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
            <Typography color="text.secondary">אין תורנויות מפורסמות בשבעת הימים הקרובים.</Typography>
          ) : (
            <>
              <Typography>
                <b>{week.length}</b> תורנויות מפורסמות בשבעת הימים הקרובים
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
          { to: "/soldiers", label: "חיילים", hint: staff ? "חיפוש, עריכה וטעינת כוח אדם" : "חיפוש ופרטי חיילים" },
          { to: "/board", label: "לוח מפורסם", hint: "מה שכל היחידה רואה" },
          { to: "/cycles", label: "ניהול מחזורים", hint: "יצירה, תאריכים ושלבים" },
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
    </Stack>
  );
}

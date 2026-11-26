import { MyNextDuty } from "../components/MyNextDuty";
import BoltIcon from "@mui/icons-material/BoltOutlined";
import CareerIcon from "@mui/icons-material/EastOutlined";
import ApprovedIcon from "@mui/icons-material/TaskAltOutlined";
import NewIcon from "@mui/icons-material/PersonAddAltOutlined";
import PendingIcon from "@mui/icons-material/ScheduleOutlined";
import RangeIcon from "@mui/icons-material/GpsFixedOutlined";
import { alpha, useTheme } from "@mui/material/styles";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { BoardRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { stageLabel, type CycleStatus } from "../lib/cycles";
import { ACTION_LABEL, collapseRepeats, ENTITY_LABEL, perSoldier, type UnitDashboard, type UnitKpis } from "../lib/dashboard";
import { FeedbackInbox } from "../components/FeedbackInbox";
import { dayLabel, spanLabel, upcomingWeekend } from "../lib/dates";
import { useLiveTick } from "../lib/live";

const fmt = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const POP: Record<string, string> = { mandatory: "חובה", career: "קבע" };

type Tone = "info" | "secondary" | "success" | "error" | "warning";

/** A managers' tile: icon, a big number, a line – and, with `to`, the filtered list behind it. */
function Kpi(props: { title: string; value: ReactNode; note?: ReactNode; noteTone?: Tone; icon: ReactNode; tone: Tone; to?: string; alert?: boolean }) {
  const t = useTheme();
  const c = t.palette[props.tone].main;
  return (
    <Paper
      variant="outlined"
      {...(props.to ? { component: RouterLink, to: props.to } : {})}
      sx={{
        p: 1.75,
        borderRadius: 3,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        minHeight: 128,
        textDecoration: "none",
        color: "inherit",
        borderColor: props.alert ? alpha(t.palette.error.main, 0.5) : undefined,
        "&:hover": props.to ? { borderColor: c } : undefined,
      }}
    >
      <Box sx={{ width: 32, height: 32, borderRadius: 2, bgcolor: alpha(c, 0.16), color: c, display: "grid", placeItems: "center", "& svg": { fontSize: 19 } }}>
        {props.icon}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {props.title}
      </Typography>
      <Typography sx={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, color: props.alert ? "error.main" : undefined }}>{props.value}</Typography>
      {props.note && (
        <Typography variant="caption" sx={{ color: props.noteTone ? `${props.noteTone}.main` : "text.secondary" }}>
          {props.note}
        </Typography>
      )}
    </Paper>
  );
}

/** The workforce: active, the חובה / קבע split, and how many have their own account. */
function Workforce({ k, d }: { k: UnitKpis; d: UnitDashboard }) {
  const t = useTheme();
  const pct = d.accounts.soldiers ? Math.round((d.accounts.with_account / d.accounts.soldiers) * 100) : 0;
  return (
    <Paper variant="outlined" component={RouterLink} to="/soldiers" sx={{ p: 2, borderRadius: 3, textDecoration: "none", color: "inherit", display: "block" }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            עובדים פעילים
          </Typography>
          <Typography sx={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>{k.active}</Typography>
        </Box>
        <Box sx={{ textAlign: "left" }}>
          <Typography variant="body2" color="text.secondary">
            עם חשבון אישי
          </Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }}>
            {d.accounts.with_account}{" "}
            <Typography component="span" variant="body2" color="text.secondary">
              · {pct}%
            </Typography>
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" sx={{ mt: 1.5, gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 120, bgcolor: "action.hover", borderRadius: 2, px: 1.5, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            משתמשים פעילים · 7 ימים
          </Typography>
          <Typography sx={{ fontSize: 22, fontWeight: 800 }}>
            {k.users_7d}
            <Typography component="span" variant="body2" color="text.secondary">
              {" "}
              / {k.users}
            </Typography>
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 120, bgcolor: "action.hover", borderRadius: 2, px: 1.5, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            משתמשים פעילים · 30 יום
          </Typography>
          <Typography sx={{ fontSize: 22, fontWeight: 800 }}>
            {k.users_30d}
            <Typography component="span" variant="body2" color="text.secondary">
              {" "}
              / {k.users}
            </Typography>
          </Typography>
        </Box>
      </Stack>
      <Box role="img" aria-label={`חובה ${k.mandatory}, קבע ${k.career}`} sx={{ display: "flex", gap: "2px", height: 12, borderRadius: 99, overflow: "hidden", mt: 1.5 }}>
        <Box sx={{ flex: k.mandatory || 0.0001, bgcolor: t.palette.info.main }} />
        <Box sx={{ flex: k.career || 0.0001, bgcolor: t.palette.secondary.main }} />
      </Box>
      <Stack direction="row" spacing={2.5} sx={{ mt: 1 }}>
        {[
          ["חובה", k.mandatory, t.palette.info.main],
          ["קבע", k.career, t.palette.secondary.main],
        ].map(([l, n, col]) => (
          <Stack key={l as string} direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 0.75, bgcolor: col as string }} />
            <Typography variant="body2">
              {l} <b>{n}</b>
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0, height: "100%", boxSizing: "border-box" }}>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/**
 * The unit commander's dashboard (version 2.0, stage 2.6), read only: the cycle at a glance,
 * the coming weekend, the load by population and by gaf, open requests, and every change
 * אחראי השיבוצים made to the rules in the last month.
 */
/** Points with one decimal, without a "-0.0". */
const pts = (x: number | string) => (Math.abs(Number(x)) < 0.05 ? 0 : Number(x)).toFixed(1);

export function DashboardPage() {
  const live = useLiveTick();
  const { api } = useAuth();
  const [d, setD] = useState<UnitDashboard | null>(null);
  const [k, setK] = useState<UnitKpis | null>(null);
  const [weekend, setWeekend] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allChanges, setAllChanges] = useState(false);

  useEffect(() => {
    api!.unitDashboard().then(setD).catch((e) => setError((e as Error).message));
    api!.unitKpis().then(setK).catch(() => setK(null));
    const [from, to] = upcomingWeekend();
    api!.board(from.toISOString(), to.toISOString()).then(setWeekend).catch(() => setWeekend([]));
  }, [api, live]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!d)
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  const maxLoad = Math.max(0.01, ...d.by_gaf.map(perSoldier));
  const changes = collapseRepeats(d.settings_changes);

  return (
    <Stack spacing={2}>
      <Box sx={{ position: "relative" }}>
        <Button component={RouterLink} to="/scoring" size="small" sx={{ float: "inline-end" }}>
          איך מחושב הניקוד?
        </Button>
        <Typography variant="h1">נתוני היחידה</Typography>
        <Typography variant="body2" color="text.secondary">
          {d.cycle ? `המחזור בתוקף: ${d.cycle.name} (${fmt(d.cycle.start_date)}–${fmt(d.cycle.end_date)})` : "עוד אין מחזור שפורסם"}
          {d.planning ? ` · בתכנון: ${d.planning.name} – ${stageLabel(d.planning.status as CycleStatus)}` : ""}
        </Typography>
      </Box>
      <MyNextDuty />

      {k && <Workforce k={k} d={d} />}
      {k?.cycle && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: -1 }}>
          במחזור {k.cycle.name}
          {k.cycle.published ? "" : " (בתכנון)"}
        </Typography>
      )}
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(3, 1fr)" } }}>
        {k && (
          <>
            <Kpi title="חדשים במחזור" value={k.new_in_cycle ?? "—"} note={k.in_training ? `${k.in_training} עדיין בהכשרה` : "אף אחד לא בהכשרה"} icon={<NewIcon />} tone="info"
              to={k.cycle ? `/soldiers?join_from=${k.cycle.start_date}&join_to=${k.cycle.end_date}` : "/soldiers?new=1"} />
            <Kpi title="נכנסים לקבע במחזור" value={k.to_career ?? "—"} note="ניקוד מעבר אוטומטי" icon={<CareerIcon />} tone="secondary"
              to={k.cycle ? `/soldiers?career_from=${k.cycle.start_date}&career_to=${k.cycle.end_date}` : "/soldiers"} />
            <Kpi
              title="פטורים מאושרים"
              value={k.exemptions_approved ?? "—"}
              note={k.exemptions_pending ? `ועוד ${k.exemptions_pending} ממתינים להחלטה` : "אין ממתינים"}
              noteTone={k.exemptions_pending ? "warning" : undefined}
              icon={<ApprovedIcon />}
              tone="success"
              to="/cycle/constraints"
            />
            <Kpi
              title="מטווח פג תוקף"
              value={k.range_expired}
              note={k.range_soon ? `ועוד ${k.range_soon} יפוגו ב-30 יום` : "אף אחד לא יפוג ב-30 יום"}
              icon={<RangeIcon />}
              tone="error"
              alert={k.range_expired > 0}
              to="/soldiers?range=expired"
            />
            <Kpi
              title="הקפצות במחזור"
              value={(k.callups_reserve ?? 0) + (k.callups_special ?? 0)}
              note={k.cycle?.published ? `${k.callups_reserve ?? 0} מהעתודה · ${k.callups_special ?? 0} מיוחדות` : "נספרות אחרי הפרסום"}
              icon={<BoltIcon />}
              tone="warning"
            />
          </>
        )}
        <Kpi
          title="בקשות פטור ממתינות"
          value={d.requests.pending}
          note={`${d.requests.by_soldiers} הגישו בעצמם · ${d.requests.urgent ? `${d.requests.urgent} דחופות` : "אין דחופות"}`}
          noteTone={d.requests.urgent ? "error" : undefined}
          icon={<PendingIcon />}
          tone="warning"
          to="/cycle/constraints"
        />
      </Box>

      {/* two by two, each pair the same height */}
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, alignItems: "stretch" }}>
        <Card title="העומס לפי מסגרת">
          <Stack spacing={1}>
            {d.by_gaf.map((g) => (
              <Box key={g.gaf}>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {g.gaf}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {g.soldiers} עובדים · {g.duties} משימות · {perSoldier(g).toFixed(1)} נק׳ לעובד
                  </Typography>
                </Stack>
                <Box sx={{ height: 8, bgcolor: "action.hover", borderRadius: 1, mt: 0.5 }}>
                  <Box sx={{ height: 8, width: `${(perSoldier(g) / maxLoad) * 100}%`, bgcolor: "primary.main", borderRadius: 1 }} />
                </Box>
              </Box>
            ))}
          </Stack>
        </Card>

        <Card title="העומס לפי אוכלוסייה">
          {d.by_population.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              אין נתונים.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {["", "עובדים", "ממוצע", "טווח", "בלי משימה"].map((h) => (
                    <TableCell key={h}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {d.by_population.map((p) => (
                  <TableRow key={p.population}>
                    <TableCell sx={{ fontWeight: 600 }}>{POP[p.population] ?? p.population}</TableCell>
                    <TableCell>{p.soldiers}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{pts(p.mean)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <span dir="ltr">
                        {pts(p.min)}–{pts(p.max)}
                      </span>
                    </TableCell>
                    <TableCell>{p.without}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Typography variant="caption" color="text.secondary">
            ניקוד במשימות המחזור. פירוט ההוגנות בין מי שזכאים לאותן משימות – במסך השיבוץ.
          </Typography>
        </Card>

        <Card title='הסופ"ש הקרוב'>
          {!weekend ? (
            <CircularProgress size={20} />
          ) : weekend.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              אין משימות מפורסמות בסופ"ש הקרוב.
            </Typography>
          ) : (
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
              {weekend.map((r) => (
                <Box key={r.slot_id} sx={{ py: 0.75 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {r.task_name} · {r.performers.length ? r.performers.join(", ") : <Chip size="small" color="error" label="לא מאויש" />}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {dayLabel(r.starts_at)} · {spanLabel(r.starts_at, r.ends_at)}
                    {r.reserves.length ? ` · עתודה: ${r.reserves.join(", ")}` : ""}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Card>

        <Card title="פעילות הסגל">
          {k?.cycle && (
            <Stack direction="row" sx={{ gap: 2, flexWrap: "wrap", mb: 1 }}>
              <Typography variant="body2">
                שינויים ידניים בשיבוץ: <b>{k.manual_changes ?? 0}</b>
              </Typography>
              <Typography variant="body2">
                החלפות בין עובדים: <b>{k.swaps ?? 0}</b>
              </Typography>
              <Typography variant="body2">
                שינויי הגדרות בחודש: <b>{d.settings_changes.length}</b>
              </Typography>
            </Stack>
          )}
          {d.settings_changes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              לא שונו הגדרות.
            </Typography>
          ) : (
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
              {(allChanges ? changes : changes.slice(0, 10)).map((c, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ py: 0.75, alignItems: "baseline" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44 }}>
                    {fmt(c.at).slice(0, 5)}
                  </Typography>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {ENTITY_LABEL[c.entity] ?? c.entity}
                    {c.name ? `: ${c.name}` : ""} – {ACTION_LABEL[c.action] ?? c.action}
                    {c.times > 1 ? ` (×${c.times})` : ""}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {c.by}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
          {changes.length > 10 && (
            <Button size="small" onClick={() => setAllChanges(!allChanges)} sx={{ mt: 0.5 }}>
              {allChanges ? "רק 10 האחרונים" : `הצג את כל ${changes.length}`}
            </Button>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            מיומן הביקורת, שאי אפשר למחוק ממנו. שינויים זהים ברצף מוצגים פעם אחת.
          </Typography>
        </Card>
      </Box>

      <FeedbackInbox home />
    </Stack>
  );
}

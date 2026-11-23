import { MyNextDuty } from "../components/MyNextDuty";
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
import { ACTION_LABEL, collapseRepeats, ENTITY_LABEL, perSoldier, type UnitDashboard } from "../lib/dashboard";
import { FeedbackInbox } from "../components/FeedbackInbox";
import { dayLabel, spanLabel, upcomingWeekend } from "../lib/dates";

const fmt = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const POP: Record<string, string> = { mandatory: "חובה", career: "קבע" };

function Tile({ title, value, note }: { title: string; value: ReactNode; note?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        {title}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.3 }}>{value}</Typography>
      {note && (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
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
  const { api } = useAuth();
  const [d, setD] = useState<UnitDashboard | null>(null);
  const [weekend, setWeekend] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allChanges, setAllChanges] = useState(false);

  useEffect(() => {
    api!.unitDashboard().then(setD).catch((e) => setError((e as Error).message));
    const [from, to] = upcomingWeekend();
    api!.board(from.toISOString(), to.toISOString()).then(setWeekend).catch(() => setWeekend([]));
  }, [api]);

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

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        <Tile title="בקשות פטור ממתינות" value={d.requests.pending} note={d.requests.urgent ? `${d.requests.urgent} דחופות` : "אין דחופות"} />
        <Tile title="הגישו בעצמם" value={d.requests.by_soldiers} note="מתוך הממתינות" />
        <Tile
          title="עובדים עם חשבון אישי"
          value={`${d.accounts.with_account}/${d.accounts.soldiers}`}
          note={d.accounts.soldiers ? `${Math.round((d.accounts.with_account / d.accounts.soldiers) * 100)}%` : ""}
        />
        <Tile title="שינויי הגדרות בחודש" value={d.settings_changes.length} note="ע״י אחראי השיבוצים" />
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

        <Card title="שינויי הגדרות בחודש האחרון">
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

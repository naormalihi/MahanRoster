import {
  Alert,
  Box,
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
import type { BoardRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { stageLabel, type CycleStatus } from "../lib/cycles";
import { ACTION_LABEL, ENTITY_LABEL, perSoldier, type UnitDashboard } from "../lib/dashboard";
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
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
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
 * נע"ת made to the rules in the last month.
 */
export function DashboardPage() {
  const { api } = useAuth();
  const [d, setD] = useState<UnitDashboard | null>(null);
  const [weekend, setWeekend] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h1">לוח מחוונים</Typography>
        <Typography variant="body2" color="text.secondary">
          {d.cycle ? `המחזור בתוקף: ${d.cycle.name} (${fmt(d.cycle.start_date)}–${fmt(d.cycle.end_date)})` : "עוד אין מחזור שפורסם"}
          {d.planning ? ` · בתכנון: ${d.planning.name} – ${stageLabel(d.planning.status as CycleStatus)}` : ""}
        </Typography>
      </Box>

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        <Tile title="בקשות פטור ממתינות" value={d.requests.pending} note={d.requests.urgent ? `${d.requests.urgent} דחופות` : "אין דחופות"} />
        <Tile title="הגישו בעצמם" value={d.requests.by_soldiers} note="מתוך הממתינות" />
        <Tile
          title="חיילים עם חשבון אישי"
          value={`${d.accounts.with_account}/${d.accounts.soldiers}`}
          note={d.accounts.soldiers ? `${Math.round((d.accounts.with_account / d.accounts.soldiers) * 100)}%` : ""}
        />
        <Tile title="שינויי הגדרות בחודש" value={d.settings_changes.length} note="ע״י נע״ת" />
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, alignItems: "start" }}>
        <Card title='הסופ"ש הקרוב'>
          {!weekend ? (
            <CircularProgress size={20} />
          ) : weekend.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              אין תורנויות מפורסמות בסופ"ש הקרוב.
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

        <Card title="העומס לפי אוכלוסייה">
          {d.by_population.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              אין נתונים.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {["", "חיילים", "ממוצע", "טווח", "בלי תורנות"].map((h) => (
                    <TableCell key={h}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {d.by_population.map((p) => (
                  <TableRow key={p.population}>
                    <TableCell sx={{ fontWeight: 600 }}>{POP[p.population] ?? p.population}</TableCell>
                    <TableCell>{p.soldiers}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{Number(p.mean).toFixed(1)}</TableCell>
                    <TableCell>
                      {Number(p.min).toFixed(1)}–{Number(p.max).toFixed(1)}
                    </TableCell>
                    <TableCell>{p.without}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Typography variant="caption" color="text.secondary">
            ניקוד בתורנויות המחזור. פירוט ההוגנות בין מי שזכאים לאותן תורנויות – במסך השיבוץ.
          </Typography>
        </Card>

        <Card title="העומס לפי גף">
          <Stack spacing={1}>
            {d.by_gaf.map((g) => (
              <Box key={g.gaf}>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {g.gaf}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {g.soldiers} חיילים · {g.duties} תורנויות · {perSoldier(g).toFixed(1)} נק׳ לחייל
                  </Typography>
                </Stack>
                <Box sx={{ height: 8, bgcolor: "action.hover", borderRadius: 1, mt: 0.5 }}>
                  <Box sx={{ height: 8, width: `${(perSoldier(g) / maxLoad) * 100}%`, bgcolor: "primary.main", borderRadius: 1 }} />
                </Box>
              </Box>
            ))}
          </Stack>
        </Card>

        <Card title="שינויי הגדרות בחודש האחרון">
          {d.settings_changes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              לא שונו הגדרות.
            </Typography>
          ) : (
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
              {d.settings_changes.map((c, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ py: 0.75, alignItems: "baseline" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44 }}>
                    {fmt(c.at).slice(0, 5)}
                  </Typography>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {ENTITY_LABEL[c.entity] ?? c.entity}
                    {c.name ? `: ${c.name}` : ""} – {ACTION_LABEL[c.action] ?? c.action}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {c.by}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            מיומן הביקורת, שאי אפשר למחוק ממנו.
          </Typography>
        </Card>
      </Box>
    </Stack>
  );
}

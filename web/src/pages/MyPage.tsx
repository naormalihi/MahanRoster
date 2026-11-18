import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SwapIcon from "@mui/icons-material/SwapHoriz";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Link,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { EmptyState, ErrorState, greeting } from "../components/EmptyState";
import { PushControl } from "../components/NotificationBell";
import { dayLabel, spanLabel, timeLabel } from "../lib/dates";
import { splitDuties, type MyDuty, type MyScore } from "../lib/me";
import { canAskSwap, type MySwap } from "../lib/swaps";
import { SwapDialog, SwapsCard } from "../components/SwapDialog";

const ROLE: Record<MyDuty["role"], string> = { performer: "מבצע", reserve: "עתודה" };

/** One duty: when, what, as what; tap to see where to report and why he got it. */
function DutyRow({ d, open, onToggle, onSwap }: { d: MyDuty; open: boolean; onToggle: () => void; onSwap?: (d: MyDuty) => void }) {
  const details = [
    d.report_at && `התייצבות: ${dayLabel(d.report_at)} ${timeLabel(d.report_at)}${d.report_place ? `, ${d.report_place}` : ""}`,
    !d.report_at && d.report_place && `התייצבות: ${d.report_place}`,
    d.briefing_at && `תדריך: ${dayLabel(d.briefing_at)} ${timeLabel(d.briefing_at)}${d.briefing_place ? `, ${d.briefing_place}` : ""}`,
    !d.briefing_at && d.briefing_by_call && `תדריך: לפי הזימון${d.briefing_place ? `, ${d.briefing_place}` : ""}`,
    d.equipment && `ציוד: ${d.equipment}`,
  ].filter(Boolean) as string[];
  const tel = d.contact_phone?.replace(/[^\d+]/g, "");
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
      sx={{ py: 1.25, px: 0.5, cursor: "pointer", borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }}>{d.task_name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {dayLabel(d.starts_at)} · {spanLabel(d.starts_at, d.ends_at)}
          </Typography>
        </Box>
        <Chip size="small" label={d.status === "reserve_activated" ? "עתודה שהופעלה" : ROLE[d.role]} color={d.role === "performer" ? "primary" : "default"} variant="outlined" />
        {d.role === "performer" && (
          <Typography variant="body2" sx={{ minWidth: 52, textAlign: "end" }}>
            {d.points.toFixed(1)} נק׳
          </Typography>
        )}
      </Stack>
      <Collapse in={open}>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {details.map((t) => (
            <Typography key={t} variant="body2">
              {t}
            </Typography>
          ))}
          {(d.contact_name || d.contact_phone) && (
            <Typography variant="body2">
              איש קשר: {d.contact_name}{" "}
              {d.contact_phone &&
                (tel ? (
                  <Link href={`tel:${tel}`} onClick={(e) => e.stopPropagation()} dir="ltr">
                    {d.contact_phone}
                  </Link>
                ) : (
                  d.contact_phone
                ))}
            </Typography>
          )}
          {d.briefing_note && (
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {d.briefing_note}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            <b>למה שובצתי:</b> {d.explanation ?? "שובץ ידנית על ידי נע\"ת התורנויות."}
          </Typography>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="caption" color="text.secondary">
              {d.cycle_name}
            </Typography>
            {onSwap && canAskSwap(d, Date.now()) && (
              <Button
                size="small"
                startIcon={<SwapIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  onSwap(d);
                }}
              >
                בקשת החלפה
              </Button>
            )}
          </Stack>
        </Stack>
      </Collapse>
    </Box>
  );
}

/** His points in a cycle next to the mean of those he is measured against. */
function ScoreCard({ s }: { s: MyScore }) {
  const mean = s.group_mean ?? 0;
  const top = Math.max(s.points, mean, 1) * 1.15;
  const pct = (n: number) => `${(n / top) * 100}%`;
  const diff = s.points - mean;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle2" color="text.secondary">
          הניקוד שלי · {s.cycle_name}
        </Typography>
        <Link component={RouterLink} to="/scoring" variant="body2">
          איך מחושב?
        </Link>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mt: 0.5 }}>
        <Typography variant="h2">{s.points.toFixed(1)}</Typography>
        <Typography variant="body2" color="text.secondary">
          נק׳ ב-{s.duties} תורנויות
        </Typography>
      </Stack>
      {s.group_mean !== null && (
        <>
          <Box sx={{ position: "relative", height: 14, mt: 1.5, mb: 1, bgcolor: "action.hover", borderRadius: 1 }}>
            <Box sx={{ position: "absolute", insetInlineStart: 0, top: 3, bottom: 3, width: pct(s.points), bgcolor: "primary.main", borderRadius: 1 }} />
            <Box sx={{ position: "absolute", insetInlineStart: pct(mean), top: -3, bottom: -3, width: 2, bgcolor: "text.primary" }} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            הממוצע של מי שזכאים לאותן תורנויות{s.group_label ? ` (${s.group_label})` : ""}: <b>{mean.toFixed(1)}</b> · {s.group_size} חיילים.{" "}
            {Math.abs(diff) < 0.05 ? "אתה בדיוק בממוצע." : diff > 0 ? `אתה ${diff.toFixed(1)} מעל.` : `אתה ${(-diff).toFixed(1)} מתחת.`}
          </Typography>
        </>
      )}
    </Paper>
  );
}

/** The soldier's own screen (version 2.1): his next duty, his score, and all his duties. */
export function MyPage() {
  const { api, me } = useAuth();
  const [duties, setDuties] = useState<MyDuty[] | null>(null);
  const [scores, setScores] = useState<MyScore[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<MySwap[]>([]);
  const [swapping, setSwapping] = useState<MyDuty | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    Promise.all([api!.myDuties(), api!.myScores()])
      .then(([d, s]) => {
        setDuties(d);
        setScores(s);
      })
      .catch((e) => setError((e as Error).message));
    api!.mySwaps().then(setSwaps, () => setSwaps([]));
  }, [api, tick]);

  if (error) return <ErrorState text={error} onRetry={() => window.location.reload()} />;
  if (!duties)
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  const { upcoming, past } = splitDuties(duties, Date.now());
  const next = upcoming[0];
  const toggle = (id: string) => setOpen(open === id ? null : id);

  return (
    <Stack spacing={2} sx={{ maxWidth: 1040, mx: "auto", width: "100%" }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Box component="img" src="/brand/owl/head-96.png" alt="" sx={{ width: 48, height: 48, flexShrink: 0 }} />
        <Box>
          <Typography variant="h1">התורנויות שלי</Typography>
          <Typography variant="body2" color="text.secondary">
            {greeting()}
            {me?.username ? `, ${me.username}` : ""}
            {next ? ` · התורנות הבאה ${dayLabel(next.starts_at)}` : ""}
          </Typography>
        </Box>
      </Stack>

      {/* on a wide screen: the duties on the main side, the score and the settings beside them */}
      <Box sx={{ display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 3fr) minmax(0, 2fr)" } }}>
      <Stack spacing={2} sx={{ minWidth: 0 }}>
      <SwapsCard swaps={swaps} onChange={reload} />
      {next ? (
        <Paper sx={{ p: 2, borderInlineStart: 4, borderColor: "primary.main" }}>
          <Typography variant="subtitle2" color="text.secondary">
            התורנות הבאה · {dayLabel(next.starts_at)}
          </Typography>
          <DutyRow d={next} open onToggle={() => undefined} onSwap={setSwapping} />
        </Paper>
      ) : (
        <EmptyState pose="sleep" title="אין לך תורנויות קרובות" text="כשיתפרסם לוח חדש, התורנויות שלך יופיעו כאן ותקבל התראה." />
      )}

      {upcoming.length > 1 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            הבאות ({upcoming.length - 1})
          </Typography>
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
            {upcoming.slice(1).map((d) => (
              <DutyRow key={d.assignment_id} d={d} open={open === d.assignment_id} onToggle={() => toggle(d.assignment_id)} onSwap={setSwapping} />
            ))}
          </Stack>
        </Paper>
      )}

      {past.length > 0 && (
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">תורנויות שעברו ({past.length})</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
              {past.map((d) => (
                <DutyRow key={d.assignment_id} d={d} open={open === d.assignment_id} onToggle={() => toggle(d.assignment_id)} />
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      </Stack>
      <Stack spacing={2} sx={{ minWidth: 0 }}>
      {scores[0] && <ScoreCard s={scores[0]} />}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <PushControl />
      </Paper>

      {scores.length > 1 && (
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">מחזורים קודמים</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.5}>
              {scores.slice(1).map((s) => (
                <ScoreCard key={s.cycle_id} s={s} />
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      </Stack>
      </Box>

      <Typography variant="caption" color="text.secondary">
        פטור, חסימת תאריך או היעדרות – ב"הבקשות שלי". החלפה – בלחיצה על התורנות, עד 24 שעות לפניה; אחר כך פונים לנע"ת התורנויות.
      </Typography>
      {swapping && (
        <SwapDialog
          duty={swapping}
          onClose={() => setSwapping(null)}
          onSent={() => {
            setSwapping(null);
            reload();
          }}
        />
      )}
    </Stack>
  );
}

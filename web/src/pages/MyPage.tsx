import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SwapIcon from "@mui/icons-material/SwapHoriz";
import PlaceIcon from "@mui/icons-material/PlaceOutlined";
import BriefingIcon from "@mui/icons-material/RecordVoiceOverOutlined";
import EquipmentIcon from "@mui/icons-material/BackpackOutlined";
import PhoneIcon from "@mui/icons-material/PhoneOutlined";
import NoteIcon from "@mui/icons-material/PriorityHighOutlined";
import WhyIcon from "@mui/icons-material/InfoOutlined";
import {
  Accordion,
  Alert,
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
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { EmptyState, ErrorState, greeting } from "../components/EmptyState";
import { PushOffLine } from "../components/PushOffLine";
import { dateParts, dayLabel, spanLabel, timeLabel } from "../lib/dates";
import { needsAck, splitDuties, type MyDuty } from "../lib/me";
import { canAskSwap, type MySwap } from "../lib/swaps";
import { ContactCard } from "../components/ContactCard";
import { DutyNote } from "../components/DutyNote";
import { SwapDialog, SwapsCard } from "../components/SwapDialog";
import CloudOffIcon from "@mui/icons-material/CloudOffOutlined";
import { isOfflineError, OfflineError, readOffline, saveOffline, savedLabel } from "../lib/offline";
import { useLiveTick } from "../lib/live";
import { FrameRotaDuty, FrameRotaLine, useMyFrameRotas } from "../components/FrameRotaCard";
import { NextCycleCard, type NextCycleInfo } from "../components/NextCycleCard";
import { nextCycleInfo } from "../lib/me";
import { todayIso } from "../lib/soldiers";

const ROLE: Record<MyDuty["role"], string> = { performer: "מבצע", reserve: "עתודה" };

/** One line of a duty's details, with its icon. */
function Detail({ icon, children, strong }: { icon: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
      <Box sx={{ color: "text.secondary", display: "flex", pt: 0.25, "& svg": { fontSize: 18 } }}>{icon}</Box>
      <Typography variant="body2" sx={{ fontWeight: strong ? 600 : undefined, minWidth: 0 }}>
        {children}
      </Typography>
    </Stack>
  );
}

/** Where to report, the briefing, whom to call and why he got it – each with its icon. */
function DutyDetails({ d }: { d: MyDuty }) {
  const tel = d.contact_phone?.replace(/[^\d+]/g, "");
  const report = d.report_at
    ? `${dayLabel(d.report_at)} ${timeLabel(d.report_at)}${d.report_place ? `, ${d.report_place}` : ""}`
    : d.report_place;
  const briefing = d.briefing_at
    ? `${dayLabel(d.briefing_at)} ${timeLabel(d.briefing_at)}${d.briefing_place ? `, ${d.briefing_place}` : ""}`
    : d.briefing_by_call
      ? `לפי הזימון${d.briefing_place ? `, ${d.briefing_place}` : ""}`
      : null;
  return (
    <Stack spacing={0.75}>
      {report && <Detail icon={<PlaceIcon />}>התייצבות: {report}</Detail>}
      {briefing && <Detail icon={<BriefingIcon />}>תדריך: {briefing}</Detail>}
      {d.equipment && <Detail icon={<EquipmentIcon />}>ציוד: {d.equipment}</Detail>}
      {(d.contact_name || d.contact_phone) && (
        <Detail icon={<PhoneIcon />}>
          איש קשר: {d.contact_name}{" "}
          {d.contact_phone &&
            (tel ? (
              <Link href={`tel:${tel}`} onClick={(e) => e.stopPropagation()} dir="ltr">
                {d.contact_phone}
              </Link>
            ) : (
              d.contact_phone
            ))}
        </Detail>
      )}
      {d.briefing_note && (
        <Detail icon={<NoteIcon />} strong>
          {d.briefing_note}
        </Detail>
      )}
      <Detail icon={<WhyIcon />}>
        <Box component="span" sx={{ color: "text.secondary" }}>
          <b>למה שובצתי:</b> {d.explanation ?? "שובץ ידנית על ידי אחראי השיבוצים."}
        </Box>
      </Detail>
    </Stack>
  );
}

/** The day as a block – "ש׳ / 19 / דצמ׳"; `small` without the month. */
function DateBlock({ iso, small }: { iso: string; small?: boolean }) {
  const p = dateParts(iso);
  return (
    <Box sx={{ width: small ? 36 : 52, flexShrink: 0, textAlign: "center", lineHeight: 1.1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {p.weekday}
      </Typography>
      <Typography sx={{ fontSize: small ? 18 : 26, fontWeight: 800, lineHeight: 1.1 }}>{p.day}</Typography>
      {!small && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {p.month}
        </Typography>
      )}
    </Box>
  );
}

/** The duty type's color as a thin stripe; the primary color when none was chosen. */
const Stripe = ({ d }: { d: MyDuty }) => (
  <Box sx={{ width: 4, alignSelf: "stretch", borderRadius: 2, flexShrink: 0, bgcolor: d.task_color || (d.role === "performer" ? "primary.main" : "action.disabled") }} />
);

const RoleChip = ({ d }: { d: MyDuty }) => (
  <Chip
    size="small"
    label={d.status === "reserve_activated" ? "עתודה שהופעלה" : ROLE[d.role]}
    color={d.role === "performer" ? "primary" : "default"}
    variant="outlined"
  />
);

/** The next duty, open: the date block, the stripe, the details, and "ראיתי" / "בקשת החלפה" side by side. */
function NextDuty({ d, onSwap, onAck }: { d: MyDuty; onSwap?: (d: MyDuty) => void; onAck?: (ids: string[]) => void }) {
  const waiting = !!onAck && needsAck(d, Date.now());
  const swap = !!onSwap && canAskSwap(d, Date.now());
  return (
    <Paper sx={{ p: 2, borderRadius: 3 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        המשימה הבאה
      </Typography>
      <Stack direction="row" sx={{ gap: 1.5 }}>
        <DateBlock iso={d.starts_at} />
        <Stripe d={d} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 700, fontSize: 18, flex: 1, minWidth: 0 }}>{d.task_name}</Typography>
            <RoleChip d={d} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {spanLabel(d.starts_at, d.ends_at)}
            {d.role === "performer" ? ` · ${d.points.toFixed(1)} נק׳` : ""}
          </Typography>
          <DutyNote note={d.note} size={14} />
          <DutyDetails d={d} />
        </Box>
      </Stack>
      {(waiting || swap) && (
        <Box sx={{ display: "grid", gridTemplateColumns: waiting && swap ? "1fr 1fr" : "1fr", gap: 1, mt: 2 }}>
          {waiting && (
            <Button variant="contained" color="warning" onClick={() => onAck!([d.assignment_id])}>
              ראיתי ✓
            </Button>
          )}
          {swap && (
            <Button variant="outlined" startIcon={<SwapIcon />} onClick={() => onSwap!(d)}>
              בקשת החלפה
            </Button>
          )}
        </Box>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {d.cycle_name}
      </Typography>
    </Paper>
  );
}

/** One duty in a list: the day, the stripe, what and as what; tap to see the details. */
function DutyRow({ d, open, onToggle, onSwap, onAck }: { d: MyDuty; open: boolean; onToggle: () => void; onSwap?: (d: MyDuty) => void; onAck?: (ids: string[]) => void }) {
  const waiting = !!onAck && needsAck(d, Date.now());
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
      sx={{ py: 1.25, px: 0.5, cursor: "pointer", borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.25 }}>
        <DateBlock iso={d.starts_at} small />
        <Stripe d={d} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }}>{d.task_name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {spanLabel(d.starts_at, d.ends_at)}
          </Typography>
          <DutyNote note={d.note} size={14} />
        </Box>
        {waiting && (
          <Button
            size="small"
            variant="contained"
            color="warning"
            onClick={(e) => {
              e.stopPropagation();
              onAck!([d.assignment_id]);
            }}
            sx={{ whiteSpace: "nowrap", minWidth: 0 }}
          >
            ראיתי ✓
          </Button>
        )}
        <RoleChip d={d} />
      </Stack>
      <Collapse in={open}>
        <Box sx={{ mt: 1, ps: 6.5 }}>
          <DutyDetails d={d} />
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {d.cycle_name}
              {d.role === "performer" ? ` · ${d.points.toFixed(1)} נק׳` : ""}
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
        </Box>
      </Collapse>
    </Box>
  );
}

/** The employee's own screen: his next duty and all his duties (the score is in "כרטיס אישי", 2.73). */
export function MyPage() {
  const live = useLiveTick();
  const rotas = useMyFrameRotas();
  const { api, me, offline } = useAuth();
  // no reception: the copy kept on the device, from this time; actions are off until it is back
  const [stale, setStale] = useState<string | null>(null);
  const [duties, setDuties] = useState<MyDuty[] | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  // "ראיתי": marked here at once, then on the server
  const ack = (ids: string[]) => {
    const at = new Date().toISOString();
    setDuties((ds) => ds && ds.map((d) => (ids.includes(d.assignment_id) ? { ...d, acked_at: at } : d)));
    api!.ackDuties(ids).catch((e) => setAckError((e as Error).message));
  };
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<MySwap[]>([]);
  const [swapping, setSwapping] = useState<MyDuty | null>(null);
  const [tick, setTick] = useState(0);
  const [nextCycle, setNextCycle] = useState<NextCycleInfo | null>(null);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    const fromCopy = (e: unknown) => {
      const copy = isOfflineError(e) && me ? readOffline(me.userId) : null;
      if (!copy) return setError(isOfflineError(e) ? "אין חיבור לאינטרנט, ואין במכשיר עותק של המשימות שלך." : (e as Error).message);
      setDuties(copy.duties);
      setStale(copy.savedAt);
    };
    if (offline) return fromCopy(new OfflineError());
    api!
      .myDuties()
      .then((d) => {
        setDuties(d);
        setStale(null);
        setError(null);
        if (me && !me.viewAs) saveOffline(me, d); // not while viewing as an employee
      })
      .catch(fromCopy);
    api!.mySwaps().then(setSwaps, () => setSwaps([]));
    // "המחזור הבא": the cycle after today's, and his requests for it
    if (!offline)
      Promise.all([api!.myInputOptions(), api!.myRequests()])
        .then(([o, r]) => setNextCycle(nextCycleInfo(o?.cycles ?? [], r, todayIso())))
        .catch(() => setNextCycle(null));
  }, [api, me, offline, tick, live]);

  // reception back while a copy is shown: load again
  useEffect(() => {
    if (!stale) return;
    const back = () => setTick((t) => t + 1);
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [stale]);

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
          <Typography variant="h1">משימות</Typography>
          <Typography variant="body2" color="text.secondary">
            {greeting()}
            {me?.viewAs ? `, ${me.viewAs.name.split(" ")[0]}` : me?.username ? `, ${me.username}` : ""}
            {next ? ` · המשימה הבאה ${dayLabel(next.starts_at)}` : ""}
          </Typography>
        </Box>
      </Stack>
      {!me?.viewAs && <PushOffLine />}

      {/* on a wide screen: the duties on the main side, the next cycle beside them (the score: in "כרטיס אישי") */}
      <Box sx={{ display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: nextCycle ? "minmax(0, 3fr) minmax(0, 2fr)" : "minmax(0, 1fr)" } }}>
      <Stack spacing={2} sx={{ minWidth: 0 }}>
      {stale && (
        <Alert severity="warning" icon={<CloudOffIcon />}>
          <b>אין חיבור</b> – מוצג מצב מ-{savedLabel(stale)}. אישור, בקשה או החלפה – כשהחיבור יחזור.
        </Alert>
      )}
      {!stale && <SwapsCard swaps={swaps} onChange={reload} />}
      {!stale && (() => {
        const waiting = (duties ?? []).filter((d) => needsAck(d, Date.now()));
        if (waiting.length < 2) return null;
        return (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => ack(waiting.map((d) => d.assignment_id))}>
                ראיתי את כולן
              </Button>
            }
          >
            {waiting.length} משימות חדשות או שהשתנו – אשר שראית.
          </Alert>
        );
      })()}
      {ackError && (
        <Alert severity="error" onClose={() => setAckError(null)}>
          {ackError}
        </Alert>
      )}
      <FrameRotaDuty rotas={rotas} />
      {next ? (
        <NextDuty d={next} onSwap={stale ? undefined : setSwapping} onAck={stale ? undefined : ack} />
      ) : (
        <EmptyState pose="sleep" title="אין לך משימות קרובות" text="כשיתפרסם לוח חדש, המשימות שלך יופיעו כאן ותקבל התראה." />
      )}

      {upcoming.length > 1 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            הבאות ({upcoming.length - 1})
          </Typography>
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
            {upcoming.slice(1).map((d) => (
              <DutyRow key={d.assignment_id} d={d} open={open === d.assignment_id} onToggle={() => toggle(d.assignment_id)} onSwap={stale ? undefined : setSwapping} onAck={stale ? undefined : ack} />
            ))}
          </Stack>
        </Paper>
      )}

      {past.length > 0 && (
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">משימות שעברו ({past.length})</Typography>
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
      {nextCycle && (
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <NextCycleCard info={nextCycle} />
        </Stack>
      )}
      </Box>

      <Typography variant="caption" color="text.secondary">
        פטור, חסימת תאריך או היעדרות – ב"בקשות ואילוצים". החלפה – בלחיצה על המשימה, עד 24 שעות לפניה; אחר כך פונים לאחראי השיבוצים.
      </Typography>
      <FrameRotaLine rotas={rotas} />
      <ContactCard />
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

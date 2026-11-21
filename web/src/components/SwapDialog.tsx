import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { dayLabel, spanLabel } from "../lib/dates";
import type { MyDuty } from "../lib/me";
import { swapStatusLabel, type MySwap, type SwapLogRow, type SwapOptions } from "../lib/swaps";

/**
 * Ask to swap one of my duties: give it to someone (handover) or trade it for one of his (mutual).
 * Only soldiers who can really take it are offered; once he accepts, the swap is done.
 */
export function SwapDialog({ duty, onClose, onSent }: { duty: MyDuty; onClose: () => void; onSent: () => void }) {
  const { api } = useAuth();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [opts, setOpts] = useState<SwapOptions | null>(null);
  const [tab, setTab] = useState<"handover" | "mutual">("handover");
  const [person, setPerson] = useState<SwapOptions["handover"][number] | null>(null);
  const [trade, setTrade] = useState<SwapOptions["mutual"][number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api!.swapOptions(duty.assignment_id).then(setOpts, (e) => setError((e as Error).message));
  }, [api, duty.assignment_id]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      if (tab === "handover" && person) await api!.requestSwap(duty.assignment_id, person.soldier_id);
      if (tab === "mutual" && trade) await api!.requestSwap(duty.assignment_id, trade.soldier_id, trade.assignment_id);
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = tab === "handover" ? !!person : !!trade;
  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>
        בקשת החלפה
        <Typography variant="body2" color="text.secondary">
          {duty.task_name} · {dayLabel(duty.starts_at)} · {spanLabel(duty.starts_at, duty.ends_at)}
          {duty.role === "reserve" ? " · עתודה" : ""}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ mb: 2 }}>
          <Tab value="handover" label="מישהו לוקח ממני" />
          <Tab value="mutual" label="מתחלפים" />
        </Tabs>
        {!opts && !error && (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {opts && tab === "handover" && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              מוצגים רק מי שיכולים לקחת את התורנות (זכאות, מנוחה, פטורים ותורנויות אחרות) ויש להם חשבון במערכת.
            </Typography>
            {opts.handover.length === 0 ? (
              <Alert severity="info">אין כרגע מי שיכול לקחת את התורנות הזו.</Alert>
            ) : (
              <Autocomplete
                options={opts.handover}
                value={person}
                onChange={(_, v) => setPerson(v)}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(a, b) => a.soldier_id === b.soldier_id}
                renderInput={(p) => <TextField {...p} label="למי להעביר" />}
                noOptionsText="אין התאמה"
              />
            )}
          </Stack>
        )}
        {opts && tab === "mutual" && (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              אתה לוקח את התורנות שלו, והוא את שלך. מוצגות רק החלפות שמתאימות לשניכם.
            </Typography>
            {opts.mutual.length === 0 ? (
              <Alert severity="info">אין כרגע החלפה מתאימה.</Alert>
            ) : (
              <Paper variant="outlined" sx={{ maxHeight: 320, overflow: "auto" }}>
                <List dense disablePadding>
                  {opts.mutual.map((m) => (
                    <ListItemButton key={m.assignment_id} selected={trade?.assignment_id === m.assignment_id} onClick={() => setTrade(m)}>
                      <ListItemText primary={`${m.task} · ${dayLabel(m.starts_at)}`} secondary={`${m.name} · ${spanLabel(m.starts_at, m.ends_at)}`} />
                    </ListItemButton>
                  ))}
                </List>
              </Paper>
            )}
          </Stack>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          העובד השני יקבל התראה. ברגע שהוא מאשר – ההחלפה מתבצעת והנקודות עוברות למי שעושה את התורנות. נע״ת התורנויות מקבל עדכון.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" onClick={send} disabled={!ready || busy}>
          שליחת בקשה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One request, from my side: what moves, with whom, and what I can do with it. */
function SwapRow({ w, onDone }: { w: MySwap; onDone: () => void }) {
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = swapStatusLabel(w);
  const give = `${w.give_task} · ${dayLabel(w.give_starts_at)}`;
  const take = w.take_task && w.take_starts_at ? `${w.take_task} · ${dayLabel(w.take_starts_at)}` : null;
  const text = w.mine
    ? take
      ? `אתה נותן ל${w.other_name} את ${give} ולוקח את ${take}`
      : `${w.other_name} לוקח ממך את ${give}`
    : take
      ? `${w.other_name} מציע: אתה לוקח את ${give}, הוא לוקח את ${take}`
      : `${w.other_name} מבקש שתיקח ממנו את ${give}`;
  const act = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    setError(null);
    try {
      const r = (await f()) as { status?: string; reason?: string } | undefined;
      if (r?.status === "cancelled" && r.reason) setError(r.reason);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = w.status === "pending_peer" && !w.expired;
  return (
    <Box sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {text}
          {w.reason && w.status !== "pending_peer" && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {w.reason}
            </Typography>
          )}
        </Typography>
        <Chip size="small" color={label.tone} variant={label.tone === "default" ? "outlined" : "filled"} label={label.text} />
      </Stack>
      {open && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: "flex-end" }}>
          {w.mine ? (
            <Button size="small" color="inherit" disabled={busy} onClick={act(() => api!.cancelSwap(w.id))}>
              ביטול הבקשה
            </Button>
          ) : (
            <>
              <Button size="small" color="inherit" disabled={busy} onClick={act(() => api!.answerSwap(w.id, false))}>
                לא יכול
              </Button>
              <Button size="small" variant="contained" disabled={busy} onClick={act(() => api!.answerSwap(w.id, true))}>
                מאשר
              </Button>
            </>
          )}
        </Stack>
      )}
      {error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}

/** My swap requests: waiting for me first, then mine, then the last ones decided. */
export function SwapsCard({ swaps, onChange }: { swaps: MySwap[]; onChange: () => void }) {
  if (!swaps.length) return null;
  const order = (w: MySwap) => (w.status === "pending_peer" && !w.expired ? (w.mine ? 1 : 0) : 2);
  const list = swaps.slice().sort((a, b) => order(a) - order(b) || b.created_at.localeCompare(a.created_at)).slice(0, 6);
  const waiting = swaps.filter((w) => !w.mine && w.status === "pending_peer" && !w.expired).length;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: waiting ? "warning.main" : undefined }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        החלפות{waiting ? ` · ${waiting} מחכות לתשובה שלך` : ""}
      </Typography>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
        {list.map((w) => (
          <SwapRow key={w.id} w={w} onDone={onChange} />
        ))}
      </Stack>
    </Paper>
  );
}

/** For נע"ת: the swaps soldiers made between themselves lately (no approval needed – this is the update). */
export function SwapLogCard() {
  const { api } = useAuth();
  const [rows, setRows] = useState<SwapLogRow[] | null>(null);
  useEffect(() => {
    api!.swapLog().then(setRows, () => setRows([]));
  }, [api]);
  if (!rows?.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        החלפות בין עובדים
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        עובדים מתחלפים בעצמם עד 24 שעות לפני תורנות, בלי אישור. כאן רואים מה השתנה; אפשר לתקן בתפעול השוטף כרגיל.
      </Typography>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
        {rows.slice(0, 12).map((r) => {
          const label = swapStatusLabel({ status: r.status, expired: false, mine: true });
          return (
            <Stack key={r.id} direction="row" spacing={1} sx={{ py: 0.75, alignItems: "center" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.requester} {r.kind === "mutual" ? "⇄" : "→"} {r.target}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {r.give_task} · {dayLabel(r.give_starts_at)}
                  {r.take_task && r.take_starts_at ? ` ⇄ ${r.take_task} · ${dayLabel(r.take_starts_at)}` : ""}
                </Typography>
              </Box>
              <Chip size="small" color={label.tone} variant={label.tone === "default" ? "outlined" : "filled"} label={r.status === "pending_peer" ? "ממתין" : label.text} />
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

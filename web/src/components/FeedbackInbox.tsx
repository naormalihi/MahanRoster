import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { dayLabel } from "../lib/dates";
import {
  countByStatus,
  KIND_LABEL,
  MAX_REPLY,
  screenLabel,
  STATUS_COLOR,
  STATUS_LABEL,
  type FeedbackItem,
  type FeedbackStatus,
} from "../lib/feedback";

const ORDER: FeedbackStatus[] = ["new", "in_progress", "done", "wont"];

/** One message: read as a row; "טיפול" opens status and a reply to the sender. */
function Item({ f, onSaved }: { f: FeedbackItem; onSaved: () => void }) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FeedbackStatus>(f.status);
  const [reply, setReply] = useState(f.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closing = (status === "done" || status === "wont") && status !== f.status;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api!.updateFeedback(f.id, status, null, reply.trim() || null);
      setOpen(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Box sx={{ py: 1.25 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 0.5 }}>
        <Chip size="small" color={STATUS_COLOR[f.status]} label={STATUS_LABEL[f.status]} />
        <Chip size="small" variant="outlined" label={KIND_LABEL[f.kind]} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {f.anonymous ? "בלי שם" : f.sender_name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {dayLabel(f.created_at)}
          {f.screen ? ` · ${screenLabel(f.screen)}` : ""}
          {f.device ? ` · ${f.device === "phone" ? "טלפון" : "מחשב"}` : ""}
          {f.app_version ? ` · ${f.app_version}` : ""}
        </Typography>
      </Stack>
      <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{f.body}</Typography>
      {!open && f.reply && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {`תשובה: ${f.reply}`}
          {f.handled_by_name ? ` (${f.handled_by_name})` : ""}
        </Typography>
      )}
      {!open ? (
        <Button size="small" onClick={() => setOpen(true)} sx={{ mt: 0.5 }}>
          טיפול
        </Button>
      ) : (
        <Stack spacing={1.5} sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
          <TextField select size="small" label="סטטוס" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)} sx={{ maxWidth: 220 }}>
            {ORDER.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
          {!f.anonymous && (
            <TextField
              size="small"
              label="תשובה לשולח"
              value={reply}
              onChange={(e) => setReply(e.target.value.slice(0, MAX_REPLY))}
              multiline
              helperText={closing ? `נשלח אליו בפעמון עם "${STATUS_LABEL[status]}"` : 'נשלחת כשמסמנים "בוצע" או "לא ייעשה"'}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={1}>
            <Button variant="contained" size="small" disabled={busy} onClick={() => void save()}>
              שמירה
            </Button>
            <Button size="small" onClick={() => setOpen(false)}>
              ביטול
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

/** "הצעות ומשוב": what users sent – the new ones first, filtered by status. */
export function FeedbackInbox() {
  const { api } = useAuth();
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedbackStatus | "open" | "all">("open");
  /** ten at a time – the newest first */
  const [limit, setLimit] = useState(10);
  const load = useCallback(() => {
    api!.feedbackList().then(setItems, (e) => setError((e as Error).message));
  }, [api]);
  useEffect(load, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!items)
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  const counts = countByStatus(items);
  const shown = items.filter((f) =>
    filter === "all" ? true : filter === "open" ? f.status === "new" || f.status === "in_progress" : f.status === filter,
  );
  const chip = (value: typeof filter, label: string, n: number) => (
    <Chip key={value} label={`${label} (${n})`} color={filter === value ? "primary" : "default"} variant={filter === value ? "filled" : "outlined"} onClick={() => {
        setFilter(value);
        setLimit(10);
      }} />
  );

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h3">הצעות ומשוב</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        מה שמשתמשים שלחו דרך &quot;הצעה לשיפור&quot;. מי ששלח בשמו מקבל עדכון בפעמון כשמסמנים &quot;בוצע&quot; או &quot;לא ייעשה&quot;.
      </Typography>
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", mb: 1 }}>
        {chip("open", "פתוחות", counts.new + counts.in_progress)}
        {chip("new", STATUS_LABEL.new, counts.new)}
        {chip("done", STATUS_LABEL.done, counts.done)}
        {chip("wont", STATUS_LABEL.wont, counts.wont)}
        {chip("all", "הכל", items.length)}
      </Stack>
      {shown.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          {items.length ? "אין הודעות בסינון הזה." : "עוד לא נשלחו הצעות."}
        </Typography>
      ) : (
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
          {shown.slice(0, limit).map((f) => (
            <Item key={`${f.id}-${f.status}-${f.handled_at ?? ""}`} f={f} onSaved={load} />
          ))}
        </Stack>
      )}
      {shown.length > limit && (
        <Button size="small" onClick={() => setLimit(limit + 10)} sx={{ mt: 1 }}>
          עוד {Math.min(10, shown.length - limit)} (מתוך {shown.length - limit} נוספות)
        </Button>
      )}
    </Paper>
  );
}

/** On the home screen: "N new messages in הצעות ומשוב" – a count only, no notice. */
export function FeedbackCount({ to }: { to: string }) {
  const { api } = useAuth();
  const [n, setN] = useState(0);
  useEffect(() => {
    api!.feedbackNewCount().then(setN, () => setN(0));
  }, [api]);
  if (!n) return null;
  return (
    <Alert
      severity="info"
      icon={false}
      action={
        <Button color="inherit" size="small" component={RouterLink} to={to}>
          לצפייה
        </Button>
      }
    >
      {n === 1 ? "הצעה חדשה אחת" : `${n} הצעות חדשות`} ב&quot;הצעות ומשוב&quot;
    </Alert>
  );
}

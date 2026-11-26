import AddIcon from "@mui/icons-material/Add";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { scoringProblems, type ScoringSettings } from "../lib/catalog";
import { plannedRangeProblems, rangeWhen, type PlannedRange, type PlannedRangeInput } from "../lib/range";
import { DateTextField } from "./DateTextField";
import { useLiveTick } from "../lib/live";

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const EMPTY: PlannedRangeInput = { day: "", starts: "08:00", ends: null, place: null, note: null };

/** Settings › מטווחים: the planned ranges, and how the validity and the reminders are counted. */
export function RangesTab() {
  const live = useLiveTick();
  const { api } = useAuth();
  const [list, setList] = useState<PlannedRange[] | null>(null);
  const [s, setS] = useState<ScoringSettings | null>(null);
  const [editing, setEditing] = useState<PlannedRangeInput | null>(null);
  const [deleting, setDeleting] = useState<PlannedRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, sc] = await Promise.all([api!.plannedRanges(), api!.scoringSettings()]);
      setList(l);
      setS(sc);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load, live]);

  async function saveRange() {
    if (!editing) return;
    const p = plannedRangeProblems(editing, todayIso());
    if (p.length) return setError(p.join(" · "));
    setBusy(true);
    try {
      await api!.savePlannedRange(editing);
      setEditing(null);
      setError(null);
      setMsg(editing.id ? "המטווח עודכן – מי שצריך אותו יקבל הודעה מעודכנת" : "המטווח נשמר – מי שצריך אותו יקבל הודעה בדקות הקרובות");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function saveSettings() {
    if (!s) return;
    const p = scoringProblems(s);
    if (p.length) return setError(p.join(" · "));
    setBusy(true);
    try {
      await api!.saveScoringSettings(s);
      setError(null);
      setMsg("ההגדרות נשמרו");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (!list || !s) return error ? <Alert severity="error">{error}</Alert> : null;
  const num = (k: "range_validity_months" | "range_warning_days" | "range_notice_days") => ({
    value: s[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Math.round(Number(e.target.value)) }),
  });

  return (
    <Stack spacing={3} sx={{ mt: 2, maxWidth: 760 }}>
      {msg && (
        <Alert severity="success" onClose={() => setMsg(null)}>
          {msg}
        </Alert>
      )}
      {error && !editing && <Alert severity="error">{error}</Alert>}
      <Box>
        <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            מטווחים מתוכננים
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => (setError(null), setEditing({ ...EMPTY }))}>
            מטווח חדש
          </Button>
        </Stack>
        <Paper variant="outlined">
          {list.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              אין מטווחים מתוכננים.
            </Typography>
          ) : (
            <List dense>
              {list.map((r) => (
                <ListItem
                  key={r.id}
                  divider
                  secondaryAction={
                    <>
                      <Tooltip title="עריכה">
                        <IconButton aria-label="עריכה" onClick={() => (setError(null), setEditing({ ...r }))}>
                          <EditOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="מחיקה">
                        <IconButton aria-label="מחיקה" color="error" onClick={() => setDeleting(r)}>
                          <DeleteOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  }
                >
                  <ListItemText primary={rangeWhen(r)} secondary={r.note} />
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
        <Typography variant="caption" color="text.secondary">
          עובדים שהתוקף שלהם פג או יפוג עד {s.range_notice_days} יום אחרי המטווח מקבלים הודעה כשהוא נשמר ותזכורת יום לפני; מפקד המסגרת מקבל את הרשימה של
          המסגרת שלו. עובד בלי תאריך מטווח נחשב בתוקף ולא מקבל הודעות.
        </Typography>
      </Box>

      <Box>
        <Typography variant="h6" gutterBottom>
          תוקף ותזכורות
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField fullWidth type="number" label="תוקף (חודשים)" {...num("range_validity_months")} helperText="מתאריך המטווח האחרון שהעובד מזין" slotProps={{ htmlInput: { min: 1, max: 36 } }} />
          <TextField fullWidth type="number" label="תזכורת (ימים)" {...num("range_warning_days")} helperText="כמה ימים לפני שהתוקף פג – פעם אחת" slotProps={{ htmlInput: { min: 1, max: 90 } }} />
          <TextField fullWidth type="number" label="מוזמנים (ימים)" {...num("range_notice_days")} helperText="מי שהתוקף שלו פג עד כמה ימים אחרי המטווח" slotProps={{ htmlInput: { min: 0, max: 180 } }} />
        </Stack>
        <Button variant="outlined" sx={{ mt: 1 }} onClick={saveSettings} disabled={busy}>
          שמירת ההגדרות
        </Button>
      </Box>

      {editing && (
        <Dialog open onClose={() => setEditing(null)} fullWidth maxWidth="xs">
          <DialogTitle>{editing.id ? "עריכת מטווח" : "מטווח חדש"}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <DateTextField label="תאריך" required value={editing.day} onChange={(e) => setEditing({ ...editing, day: e.target.value })} slotProps={{ htmlInput: { min: todayIso() } }} autoFocus />
              <Stack direction="row" spacing={2}>
                <TextField type="time" label="משעה" value={editing.starts ?? ""} onChange={(e) => setEditing({ ...editing, starts: e.target.value || null })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: "ltr" } }} fullWidth />
                <TextField type="time" label="עד שעה" value={editing.ends ?? ""} onChange={(e) => setEditing({ ...editing, ends: e.target.value || null })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: "ltr" } }} fullWidth />
              </Stack>
              <TextField label="מקום" value={editing.place ?? ""} onChange={(e) => setEditing({ ...editing, place: e.target.value.slice(0, 80) })} fullWidth />
              <TextField label="הערה לעובדים" value={editing.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value.slice(0, 200) })} multiline minRows={2} fullWidth helperText="מופיעה בהודעה. למשל: להביא נשק ותעודה" />
              {editing.id && <Alert severity="info">שינוי בתאריך, בשעות או במקום שולח שוב הודעה למי שצריך.</Alert>}
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(null)}>ביטול</Button>
            <Button variant="contained" onClick={saveRange} disabled={busy}>
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {deleting && (
        <Dialog open onClose={() => setDeleting(null)} fullWidth maxWidth="xs">
          <DialogTitle>מחיקת מטווח</DialogTitle>
          <DialogContent dividers>
            <Typography>{rangeWhen(deleting)}</Typography>
            <Typography variant="body2" color="text.secondary">
              לא נשלחת הודעת ביטול – אם כבר הודעתם, עדכנו את העובדים.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(null)}>ביטול</Button>
            <Button
              variant="contained"
              color="error"
              onClick={async () => {
                await api!.deletePlannedRange(deleting.id);
                setDeleting(null);
                await load();
              }}
            >
              מחיקה
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

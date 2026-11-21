import EditIcon from "@mui/icons-material/EditOutlined";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from "@mui/material";
import { useState } from "react";
import { isStaff } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { deadlineDay, endOfDay, type Cycle } from "../lib/cycles";

const fmt = (day: string) => day.split("-").reverse().join("/");

/**
 * The constraints deadline of a cycle: shown where constraints are worked on, and edited there
 * by staff until the cycle is published. Moving a passed deadline forward reopens collection –
 * the stage follows by itself.
 */
export function DeadlineEditor({ cycle, onSaved }: { cycle: Cycle; onSaved?: () => void }) {
  const { api, me } = useAuth();
  const { reload } = useCycle();
  const canEdit = isStaff(me) && cycle.status !== "published" && cycle.status !== "closed";
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = cycle.exemption_deadline;
  const passed = !!d && Date.parse(d) < Date.now();
  const left = d ? Math.ceil((Date.parse(d) - Date.now()) / 86_400_000) : null;
  const label = !d
    ? "סגירת אילוצים: לא נקבע"
    : `סגירת אילוצים: ${fmt(deadlineDay(d))} · ${passed ? "נסגר" : left! <= 1 ? "היום האחרון" : `עוד ${left} ימים`}`;

  const next = day ? Date.parse(endOfDay(day)) : null;
  const problem = !day ? "בחר תאריך" : day >= cycle.start_date ? "המועד חייב להיות לפני תחילת המחזור" : null;

  async function save() {
    if (!day || problem) return;
    setBusy(true);
    setError(null);
    try {
      await api!.saveCycle(cycle.id, { name: cycle.name, start_date: cycle.start_date, end_date: cycle.end_date, exemption_deadline: endOfDay(day) });
      await reload();
      onSaved?.();
      setDay(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <>
      <Chip
        size="small"
        color={!d ? "warning" : passed ? "default" : "warning"}
        variant="outlined"
        label={label}
        icon={canEdit ? <EditIcon /> : undefined}
        onClick={canEdit ? () => setDay(d ? deadlineDay(d) : "") : undefined}
        aria-label={canEdit ? `${label} – עריכה` : undefined}
      />
      {day !== null && (
        <Dialog open onClose={() => setDay(null)} maxWidth="xs" fullWidth>
          <DialogTitle>מועד סגירת אילוצים ופטורים</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <TextField
                type="date"
                label="היום האחרון להגשה"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: cycle.start_date } }}
                helperText="עובדים ומסגרות מגישים אילוצים, חסימות ופטורים עד 23:59 ביום הזה."
                error={!!day && !!problem}
                fullWidth
              />
              {day && problem && <Alert severity="error">{problem}</Alert>}
              {!problem && next !== null && passed && next > Date.now() && (
                <Alert severity="info">האיסוף ייפתח מחדש: השלב יחזור ל"אילוצים: איסוף", ואפשר יהיה שוב להזין חסימות.</Alert>
              )}
              {!problem && next !== null && !passed && next < Date.now() && (
                <Alert severity="warning">התאריך כבר עבר – האיסוף ייסגר מיד.</Alert>
              )}
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDay(null)}>ביטול</Button>
            <Button variant="contained" onClick={save} disabled={busy || !!problem}>
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

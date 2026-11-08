import WarningIcon from "@mui/icons-material/WarningAmberOutlined";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import type { Cycle } from "../lib/cycles";

export interface UnpublishImpact {
  assignments: number;
  nextWeek: number;
}

/**
 * Unpublish in two deliberate steps: read what happens, then confirm by choosing the cycle
 * from the list and writing a reason. The server checks the same.
 */
export function UnpublishDialog(props: { cycle: Cycle; impact: UnpublishImpact; onClose: () => void; onDone: (n: number) => void }) {
  const { api } = useAuth();
  const { cycle, impact } = props;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { cycles } = useCycle();
  const nameOk = name === cycle.name;
  const reasonOk = reason.trim().length >= 5;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const n = await api!.unpublishCycle(cycle.id, reason.trim(), name.trim());
      props.onDone(n);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, color: "error.main" }}>
        <WarningIcon /> ביטול פרסום – {cycle.name}
      </DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 2.5 }}>
          {["מה יקרה", "אישור"].map((l) => (
            <Step key={l}>
              <StepLabel>{l}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Alert severity="error" icon={false}>
              <Typography sx={{ fontWeight: 700, mb: 0.5 }}>הלוח ייעלם מיד לכל היחידה.</Typography>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                <li>{impact.assignments} שיבוצים יחזרו לטיוטה, כמו שהם, כולל התיקונים הידניים.</li>
                <li>המחזור יחזור לשלב "טיוטה להתייחסות", והפוטנציאל, לוח הבסיס והשיבוץ ייפתחו לעריכה.</li>
                {impact.nextWeek > 0 && <li>{impact.nextWeek} תורנויות נופלות בשבעת הימים הקרובים.</li>}
                <li>מי שכבר ראה או הדפיס את הלוח לא יקבל עדכון מהמערכת – צריך להודיע לגפים בערוצים הרגילים.</li>
              </ul>
            </Alert>
            <Typography variant="body2" color="text.secondary">
              הפעולה נרשמת ביומן הביקורת עם הנימוק. אחרי התיקון מפרסמים שוב מהטיוטה.
            </Typography>
          </Box>
        )}

        {step === 1 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              select
              label="איזה מחזור מבטלים?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={!!name && !nameOk}
              helperText={name && !nameOk ? `זה לא המחזור הזה – בחר את "${cycle.name}"` : "בחירה מכוונת מהרשימה, כדי לא לבטל מחזור אחר בטעות"}
              fullWidth
            >
              {(cycles ?? []).map((c) => (
                <MenuItem key={c.id} value={c.name}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="נימוק (נרשם ביומן)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              multiline
              minRows={2}
              helperText="למשל: פורסם לפני שנקלט עדכון מהבסיס. בלי מידע רפואי."
              fullWidth
            />
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy}>
          ביטול
        </Button>
        {step > 0 && (
          <Button onClick={() => setStep(step - 1)} disabled={busy}>
            חזרה
          </Button>
        )}
        {step === 0 && (
          <Button color="error" variant="outlined" onClick={() => setStep(1)}>
            הבנתי, המשך
          </Button>
        )}
        {step === 1 && (
          <Button
            color="error"
            variant="contained"
            onClick={run}
            disabled={busy || !nameOk || !reasonOk}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            ביטול הפרסום
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

import WarningIcon from "@mui/icons-material/WarningAmberOutlined";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import type { Cycle } from "../lib/cycles";

export interface UnpublishImpact {
  assignments: number;
  nextWeek: number;
}

/** Unpublish from inside the cycle: one clear warning, then the action. */
export function UnpublishDialog(props: { cycle: Cycle; impact: UnpublishImpact; onClose: () => void; onDone: (n: number) => void }) {
  const { api } = useAuth();
  const { cycle, impact } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      props.onDone(await api!.unpublishCycle(cycle.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, color: "error.main" }}>
        <WarningIcon /> ביטול הפרסום של {cycle.name}
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="error" icon={false}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>הלוח ייעלם מיד לכל היחידה.</Typography>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            <li>{impact.assignments} שיבוצים יחזרו לטיוטה, כמו שהם, כולל התיקונים הידניים.</li>
            <li>המחזור יחזור לשלב "שיבוץ: טיוטה", והפוטנציאל, אוסף המשימות והשיבוץ ייפתחו לעריכה.</li>
            {impact.nextWeek > 0 && <li>{impact.nextWeek} משימות נופלות בשבעת הימים הקרובים.</li>}
            <li>מי שכבר ראה או הדפיס את הלוח לא יקבל עדכון מהמערכת – צריך להודיע למסגרות בערוצים הרגילים.</li>
          </ul>
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          הפעולה נרשמת ביומן הביקורת. אחרי התיקון מפרסמים שוב מהטיוטה.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={busy}>
          חזרה
        </Button>
        <Button color="error" variant="contained" onClick={run} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          ביטול הפרסום
        </Button>
      </DialogActions>
    </Dialog>
  );
}

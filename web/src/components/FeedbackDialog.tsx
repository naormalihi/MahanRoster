import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { APP_VERSION } from "../lib/changelog";
import { useAuth } from "../lib/auth";
import { deviceOf, draftProblem, KIND_LABEL, MAX_BODY, type FeedbackKind } from "../lib/feedback";

/** "הצעה לשיפור": a short form; the screen, version and device go along by themselves. */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const { api } = useAuth();
  const { pathname } = useLocation();
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = draftProblem({ body });

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
      await api!.submitFeedback({ kind, body, anonymous, screen: pathname, version: APP_VERSION, device: deviceOf(window.innerWidth, coarse) });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>הצעה לשיפור</DialogTitle>
      <DialogContent dividers>
        {sent ? (
          <Alert severity="success">
            תודה! ההודעה הגיעה לנע&quot;ת ולמפקד היחידה.{anonymous ? "" : " כשיטפלו בה – תקבל עדכון בפעמון."}
          </Alert>
        ) : (
          <Stack spacing={2}>
            <ToggleButtonGroup exclusive size="small" value={kind} onChange={(_, v) => v && setKind(v)} fullWidth>
              {(Object.keys(KIND_LABEL) as FeedbackKind[]).map((k) => (
                <ToggleButton key={k} value={k}>
                  {KIND_LABEL[k]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <TextField
              multiline
              minRows={4}
              autoFocus
              label={kind === "bug" ? "מה קרה, ואיפה?" : kind === "idea" ? "מה היה עוזר לך?" : "מה תרצה לומר?"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              helperText={`${body.trim().length}/${MAX_BODY} · בלי פרטים רפואיים או אישיים`}
              error={body.trim().length > MAX_BODY}
            />
            <FormControlLabel control={<Checkbox checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />} label="לשלוח בלי שם" />
            <Typography variant="caption" color="text.secondary">
              {anonymous ? "השם שלך לא נשמר עם ההודעה, ולכן לא תקבל עליה עדכון." : "השם שלך יופיע ליד ההודעה."} נשלח גם המסך שבו אתה נמצא וגרסת האפליקציה.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{sent ? "סגירה" : "ביטול"}</Button>
        {!sent && (
          <Button variant="contained" disabled={busy || !!problem} onClick={() => void send()}>
            שליחה
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

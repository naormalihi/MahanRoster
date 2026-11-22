import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { usernameProblem } from "../lib/users";
import { PasswordField } from "./PasswordField";

/** "שינוי שם משתמש" from the menu: the new name and the current password; once a week (checked by the server). */
export function RenameMeDialog({ onClose }: { onClose: () => void }) {
  const { api, me, refresh } = useAuth();
  const [name, setName] = useState(me?.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const v = name.trim().toLowerCase();
  const same = v === me?.username;
  const problem = v && !same ? usernameProblem(v, []) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (same || problem || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api!.renameMe(v, password);
      setDone(v);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>שינוי שם משתמש</DialogTitle>
        <DialogContent dividers>
          {done ? (
            <Alert severity="success">
              שם המשתמש שלך עכשיו <b dir="ltr">{done}</b>. בכניסה הבאה – בשם הזה, עם אותה סיסמה.
            </Alert>
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                השם שבו נכנסים לאפליקציה. הסיסמה, ההרשאות והאימות הדו-שלבי נשארים. אפשר לשנות פעם בשבוע.
              </Typography>
              <TextField
                label="שם משתמש חדש"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="username"
                helperText={problem ?? "אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון"}
                error={!!problem}
                autoFocus
                slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "none", spellCheck: false } }}
              />
              <PasswordField
                label="הסיסמה הנוכחית"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                slotProps={{ htmlInput: { dir: "ltr" } }}
              />
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{done ? "סגירה" : "ביטול"}</Button>
          {!done && (
            <Button type="submit" variant="contained" disabled={busy || same || !!problem || !v || !password}>
              שמירה
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}

import LogoutIcon from "@mui/icons-material/Logout";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { PushControl, RequestAlertsControl } from "../components/NotificationBell";
import { PasswordField } from "../components/PasswordField";
import { RenameMeDialog } from "../components/RenameMeDialog";
import { TOUR_EVENT, VersionFooter } from "../components/Layout";
import { isStaff, passwordProblems } from "../lib/api";
import { useAuth } from "../lib/auth";
import { pushState } from "../lib/notifications";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Typography variant="h3" sx={{ fontSize: 16, fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      <Stack spacing={1.5}>{children}</Stack>
    </Paper>
  );
}

function Line(props: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {props.label}
        </Typography>
        <Typography sx={{ fontWeight: 500 }}>{props.value}</Typography>
      </Box>
      {props.action}
    </Stack>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { api, me } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const problem = pw ? passwordProblems(pw, me?.username ?? "") : null;
  async function save() {
    if (problem) return setError(problem);
    if (pw !== pw2) return setError("הסיסמאות לא זהות");
    setBusy(true);
    try {
      await api!.changePassword(pw);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>שינוי סיסמה</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Alert severity="success">הסיסמה שונתה.</Alert>
        ) : (
          <Stack spacing={2}>
            <PasswordField label="סיסמה חדשה" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" helperText={problem ?? "לפחות 10 תווים, אותיות וספרות"} error={!!problem} autoFocus />
            <PasswordField label="שוב, לאימות" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{done ? "סגירה" : "ביטול"}</Button>
        {!done && (
          <Button variant="contained" onClick={save} disabled={busy}>
            שמירה
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** חשבון: sign-in details, notifications, the tour, signing out – one place for what was in the menu and on the duties screen. */
export function AccountPage() {
  const { api, me, signOut } = useAuth();
  const [renaming, setRenaming] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [push, setPush] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    pushState().then(setPush).catch(() => setPush(null));
  }, []);
  if (!me) return null;
  const staff = isStaff(me);
  const viewer = me.roles.includes("viewer");

  return (
    <Stack spacing={2} sx={{ maxWidth: 640, mx: "auto", width: "100%" }}>
      <Box>
        <Typography variant="h1">חשבון</Typography>
        <Typography variant="body2" color="text.secondary">
          כניסה, התראות ועזרה.
        </Typography>
      </Box>

      {!viewer && (
        <Section title="פרטי כניסה">
          <Line
            label="שם משתמש"
            value={<span dir="ltr">{me.username}</span>}
            action={
              <Button variant="outlined" size="small" onClick={() => setRenaming(true)}>
                שינוי
              </Button>
            }
          />
          <Line
            label="סיסמה"
            value="••••••••••"
            action={
              <Button variant="outlined" size="small" onClick={() => setPwOpen(true)}>
                שינוי
              </Button>
            }
          />
          {staff && <Line label="אימות דו־שלבי" value="פעיל – נדרש לסגל" action={<Chip size="small" color="success" variant="outlined" label="מוגן" />} />}
        </Section>
      )}

      <Section title="התראות">
        <PushControl />
        <Typography variant="body2" color="text.secondary">
          משימה חדשה, תזכורת לפני משימה ותדריך, החלפות, מטווח. ההגדרה היא לכל מכשיר בנפרד.
        </Typography>
        {push === "on" && (
          <Box>
            <Button
              variant="outlined"
              size="small"
              onClick={async () => {
                setTest(null);
                try {
                  await api!.sendTestNotification();
                  setTest({ ok: true, text: "נשלחה. אמורה להגיע לטלפון תוך כמה שניות." });
                } catch (e) {
                  setTest({ ok: false, text: (e as Error).message });
                }
              }}
            >
              שליחת התראת ניסיון
            </Button>
          </Box>
        )}
        {test && <Alert severity={test.ok ? "success" : "error"}>{test.text}</Alert>}
        <RequestAlertsControl />
      </Section>

      <Section title="עזרה">
        <Line
          label="סיור היכרות עם תורנצ׳יק"
          value="מה יש בכל מסך"
          action={
            <Button variant="outlined" size="small" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}>
              התחלה
            </Button>
          }
        />
        <Typography variant="body2" color="text.secondary">
          מצב בהיר או כהה – באייקון בראש המסך.
        </Typography>
      </Section>

      <Button variant="outlined" color="error" startIcon={<LogoutIcon />} onClick={signOut} sx={{ minHeight: 46 }}>
        יציאה
      </Button>
      <VersionFooter />

      {renaming && <RenameMeDialog onClose={() => setRenaming(false)} />}
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </Stack>
  );
}

import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { passwordProblems } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Mascot, type MascotPose } from "../components/Mascot";
import { PasswordField } from "../components/PasswordField";
import { ThemeToggle } from "../components/ThemePicker";
import { takeSignInNotice } from "../lib/signInNotice";

function Card({ title, subtitle, pose = "wave", children }: { title: string; subtitle?: string; pose?: MascotPose; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "background.default", px: 2, position: "relative" }}>
      <Box sx={{ position: "absolute", top: 8, left: 8, color: "text.secondary" }}>
        <ThemeToggle />
      </Box>
      <Paper sx={{ p: { xs: 3, sm: 4 }, width: "100%", maxWidth: 400 }}>
        <Stack spacing={2.5}>
          <Mascot pose={pose} height={170} sx={{ mx: "auto" }} />
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <Box>
              <Typography variant="h2">{title}</Typography>
              {subtitle && (
                <Typography variant="body2" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </Box>
          </Stack>
          {children}
        </Stack>
      </Paper>
    </Box>
  );
}

export function LoginPage() {
  const { api, refresh } = useAuth();
  // the join link the codes are handed out with opens straight on the join form
  const [joining, setJoining] = useState(() => new URLSearchParams(window.location.search).has("join"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(takeSignInNotice);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api!.signIn(username, password);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (joining) return <JoinPage onBack={() => setJoining(false)} />;

  return (
    <Card title="תורנצ׳יק" subtitle="מערכת התורנויות">
      <form onSubmit={submit}>
        <Stack spacing={2}>
          {api?.demo && (
            <Alert severity="info">
              מצב הדגמה. משתמשים: <b>naat</b> (נע"ת), <b>board</b> (צפייה), <b>cmd</b> (מפקד מסגרת), <b>chayal</b> (עובד), <b>new.user</b>. כל סיסמה מתקבלת.
            </Alert>
          )}
          <TextField
            label="שם משתמש או אימייל"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "none" } }}
          />
          <PasswordField
            label="סיסמה"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            slotProps={{ htmlInput: { dir: "ltr" } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            כניסה
          </Button>
          <Button onClick={() => setJoining(true)}>יש לי קוד הצטרפות</Button>
          <Typography variant="caption" color="text.secondary">
            שכחת סיסמה? פנה לנע"ת התורנויות לאיפוס.
          </Typography>
        </Stack>
      </form>
    </Card>
  );
}

/**
 * A soldier opens his account with the one-time code he got from נע"ת: the code ties the
 * account to his record (no personal number is asked), and he picks a username and a password.
 */
function JoinPage({ onBack }: { onBack: () => void }) {
  const { api, refresh } = useAuth();
  // the link in the WhatsApp message and the QR on the printed card carry the code
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = password && username ? passwordProblems(password, username) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    if (password !== again) return setError("שתי הסיסמאות לא זהות");
    setBusy(true);
    setError(null);
    try {
      const name = await api!.redeemInvite(code, username, password);
      await api!.signIn(name, password);
      window.history.replaceState(null, "", "/");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card title="הצטרפות" subtitle="חשבון אישי במערכת התורנויות">
      <form onSubmit={submit}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            את הקוד קיבלת מנע"ת התורנויות. הוא אישי ומשמש פעם אחת.
          </Typography>
          <TextField
            label="קוד הצטרפות"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXXX-XXXXX"
            autoComplete="one-time-code"
            autoFocus
            required
            slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "characters", style: { fontFamily: "monospace", letterSpacing: 2 } } }}
          />
          <TextField
            label="שם משתמש"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            helperText="אותיות לטיניות קטנות, ספרות, נקודה או מקף (למשל avi.cohen)"
            autoComplete="username"
            required
            slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "none" } }}
          />
          <PasswordField
            label="סיסמה"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={!!problem}
            helperText={problem ?? "לפחות 10 תווים, אותיות וספרות"}
            autoComplete="new-password"
            required
            slotProps={{ htmlInput: { dir: "ltr" } }}
          />
          <PasswordField
            label="הסיסמה שוב"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            required
            slotProps={{ htmlInput: { dir: "ltr" } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={busy}>
            פתיחת חשבון
          </Button>
          <Button onClick={onBack}>יש לי כבר חשבון – כניסה</Button>
        </Stack>
      </form>
    </Card>
  );
}

export function MfaPage() {
  const { api, mfa, refresh, signOut } = useAuth();
  const [factorId, setFactorId] = useState(mfa?.factorId);
  const [qr, setQr] = useState<{ svg: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enrolling = !!mfa?.needsEnroll;

  useEffect(() => {
    if (enrolling && !qr) {
      api!
        .mfaEnroll()
        .then((r) => {
          setFactorId(r.factorId);
          setQr({ svg: r.qrSvg, secret: r.secret });
        })
        .catch((e) => setError((e as Error).message));
    }
  }, [enrolling, qr, api]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api!.mfaVerify(factorId!, code.trim());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card pose="clipboard" title="אימות דו-שלבי" subtitle={enrolling ? "הגדרה חד-פעמית" : "הזן את הקוד מאפליקציית האימות"}>
      <form onSubmit={submit}>
        <Stack spacing={2}>
          {enrolling && (
            <>
              <Typography variant="body2">
                סרוק את הקוד באפליקציית אימות (Google Authenticator, Microsoft Authenticator או דומה), והזן את הקוד בן 6 הספרות שמופיע בה.
              </Typography>
              {qr?.svg && <Box component="img" src={qr.svg} alt="קוד QR להגדרת אימות" sx={{ width: 180, height: 180, alignSelf: "center" }} />}
              {qr?.secret && (
                <Typography variant="caption" sx={{ direction: "ltr", textAlign: "center", fontFamily: "monospace" }}>
                  {qr.secret}
                </Typography>
              )}
            </>
          )}
          {api?.demo && <Alert severity="info">במצב הדגמה כל קוד בן 6 ספרות מתקבל.</Alert>}
          <TextField
            label="קוד אימות"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            autoComplete="one-time-code"
            autoFocus
            required
            slotProps={{ htmlInput: { inputMode: "numeric", dir: "ltr", style: { letterSpacing: "0.4em", textAlign: "center" } } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" size="large" disabled={code.length !== 6 || !factorId}>
            אימות
          </Button>
          <Button onClick={signOut}>חזרה למסך הכניסה</Button>
        </Stack>
      </form>
    </Card>
  );
}

export function ChangePasswordPage() {
  const { api, me, refresh, signOut } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const problem = pw ? passwordProblems(pw, me?.username ?? "") : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    if (pw !== pw2) return setError("הסיסמאות לא זהות");
    try {
      await api!.changePassword(pw);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card pose="point" title="החלפת סיסמה" subtitle="קיבלת סיסמה זמנית. בחר סיסמה חדשה כדי להמשיך.">
      <form onSubmit={submit}>
        <Stack spacing={2}>
          <PasswordField
            label="סיסמה חדשה"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            helperText={problem ?? "לפחות 10 תווים, אותיות וספרות"}
            error={!!problem}
            required
            slotProps={{ htmlInput: { dir: "ltr" } }}
          />
          <PasswordField
            label="אימות סיסמה"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            required
            slotProps={{ htmlInput: { dir: "ltr" } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" size="large">
            שמירה
          </Button>
          <Button onClick={signOut}>יציאה</Button>
        </Stack>
      </form>
    </Card>
  );
}

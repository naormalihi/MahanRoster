import LockIcon from "@mui/icons-material/LockOutlined";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { passwordProblems } from "../lib/api";
import { useAuth } from "../lib/auth";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", bgcolor: "background.default", px: 2 }}>
      <Paper sx={{ p: { xs: 3, sm: 4 }, width: "100%", maxWidth: 400 }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "primary.main", color: "white", display: "grid", placeItems: "center" }}>
              <LockIcon fontSize="small" />
            </Box>
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  return (
    <Card title="MahanRoster" subtitle="מערכת התורנויות של היחידה">
      <form onSubmit={submit}>
        <Stack spacing={2}>
          {api?.demo && (
            <Alert severity="info">
              מצב הדגמה. משתמשים: <b>naat</b> (נע"ת), <b>board</b> (צפייה), <b>new.user</b>. כל סיסמה מתקבלת.
            </Alert>
          )}
          <TextField
            label="שם משתמש"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "none" } }}
          />
          <TextField
            label="סיסמה"
            type="password"
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
          <Typography variant="caption" color="text.secondary">
            שכחת סיסמה? פנה לנע"ת התורנויות לאיפוס.
          </Typography>
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
    <Card title="אימות דו-שלבי" subtitle={enrolling ? "הגדרה חד-פעמית" : "הזן את הקוד מאפליקציית האימות"}>
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
    <Card title="החלפת סיסמה" subtitle="קיבלת סיסמה זמנית. בחר סיסמה חדשה כדי להמשיך.">
      <form onSubmit={submit}>
        <Stack spacing={2}>
          <TextField
            label="סיסמה חדשה"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            helperText={problem ?? "לפחות 10 תווים, אותיות וספרות"}
            error={!!problem}
            required
            slotProps={{ htmlInput: { dir: "ltr" } }}
          />
          <TextField
            label="אימות סיסמה"
            type="password"
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

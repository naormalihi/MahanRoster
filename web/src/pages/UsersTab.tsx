import AddIcon from "@mui/icons-material/PersonAddAlt1Outlined";
import CopyIcon from "@mui/icons-material/ContentCopyOutlined";
import KeyIcon from "@mui/icons-material/KeyOutlined";
import LinkIcon from "@mui/icons-material/LinkOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import LockOpenIcon from "@mui/icons-material/LockOpenOutlined";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  MenuItem,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import type { ExistingSoldier } from "../lib/roster";
import { ROLE_NAME, tempPassword, usernameProblem, type AppUser } from "../lib/users";

function SoldierPicker(props: { soldiers: ExistingSoldier[]; value: string | null; onChange: (id: string | null) => void; autoFocus?: boolean }) {
  const options = useMemo(() => props.soldiers.filter((s) => s.is_active), [props.soldiers]);
  return (
    <Autocomplete
      options={options}
      value={options.find((s) => s.id === props.value) ?? null}
      onChange={(_, v) => props.onChange(v?.id ?? null)}
      getOptionLabel={(s) => `${s.full_name} · ${s.gaf_name}`}
      renderInput={(p) => <TextField {...p} label="החייל (מכוח האדם)" autoFocus={props.autoFocus} helperText="השיוך לפי רשומת החייל – המספר האישי לא נשמר במערכת" />}
    />
  );
}

/** What to hand over: username + temporary password, shown once. */
function Handover({ username, password }: { username: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const text = `כתובת: ${window.location.origin}\nשם משתמש: ${username}\nסיסמה זמנית: ${password}`;
  return (
    <Alert severity="success" icon={false}>
      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>למסור למשתמש (פעם אחת – הסיסמה לא תוצג שוב):</Typography>
      <Box component="pre" sx={{ m: 0, fontFamily: "inherit", whiteSpace: "pre-wrap", direction: "rtl" }}>
        {text}
      </Box>
      <Button
        size="small"
        startIcon={<CopyIcon />}
        sx={{ mt: 1 }}
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
        }}
      >
        {copied ? "הועתק" : "העתקה"}
      </Button>
      <Typography variant="body2" sx={{ mt: 1 }}>
        בכניסה הראשונה המשתמש יבחר סיסמה חדשה ויגדיר אימות דו-שלבי באפליקציית Authenticator.
      </Typography>
    </Alert>
  );
}

function CreateDialog(props: { soldiers: ExistingSoldier[]; taken: string[]; onClose: () => void; onDone: () => void }) {
  const { api } = useAuth();
  const [soldier, setSoldier] = useState<string | null>(null);
  const [role, setRole] = useState<"gaf_commander" | "gaf_rep">("gaf_commander");
  const [username, setUsername] = useState("");
  const [password] = useState(() => tempPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const problem = username ? usernameProblem(username, props.taken) : null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api!.createUser(username.trim().toLowerCase(), password, soldier, role);
      setDone(true);
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Dialog open onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>משתמש חדש – {role === "gaf_rep" ? "נציג גף" : "מפקד גף"}</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Handover username={username.trim().toLowerCase()} password={password} />
        ) : (
          <Stack spacing={2}>
            <TextField select label="תפקיד" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <MenuItem value="gaf_commander">מפקד גף</MenuItem>
              <MenuItem value="gaf_rep">נציג גף</MenuItem>
            </TextField>
            <Typography variant="body2" color="text.secondary">
              {role === "gaf_commander"
                ? 'מפקד גף רואה את כל נתוני היחידה לקריאה בלבד, ובמסך "הגף שלי" מזין אילוצים לחיילי הגף, מאשר את אילוצי הגף ומעיר על הטיוטה.'
                : 'נציג גף עובד רק במסך "הגף שלי": רואה את חיילי הגף והאילוצים שלהם, מזין לחיילים שנעדרים, מגיש למפקד הגף ומעיר על הטיוטה.'}{" "}
              הגף נקבע לפי החייל שהחשבון משויך אליו.
            </Typography>
            <SoldierPicker soldiers={props.soldiers} value={soldier} onChange={setSoldier} autoFocus />
            <TextField
              label="שם משתמש (לטינית)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={!!problem}
              helperText={problem ?? "למשל dana.k – כך המשתמש ייכנס"}
              slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "none" } }}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>{done ? "סגירה" : "ביטול"}</Button>
        {!done && (
          <Button variant="contained" onClick={create} disabled={busy || !username || !!problem}>
            יצירת משתמש
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function UsersTab() {
  const { api, me } = useAuth();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [soldiers, setSoldiers] = useState<ExistingSoldier[]>([]);
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<{ user: AppUser; password: string; done: boolean } | null>(null);
  const [linking, setLinking] = useState<{ user: AppUser; soldier: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api!.listUsers().then(setUsers).catch((e) => setError((e as Error).message));
  }, [api]);
  useEffect(() => {
    load();
    api!.soldiers().then(setSoldiers).catch(() => setSoldiers([]));
  }, [api, load]);

  const gafOf = new Map(soldiers.map((s) => [s.id, s.gaf_name]));
  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 260 }}>
          חשבונות אישיים. כל משתמש משויך לרשומת החייל שלו מכוח האדם (בלי מספר אישי). בגרסה הזו נוצרים כאן חשבונות של מפקדי גפים לצפייה; נע"ת
          וממלא מקום מוגדרים בהקמה.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          משתמש חדש
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!users ? (
        <CircularProgress />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                {["שם משתמש", "תפקיד", "חייל", "גף", "כניסה אחרונה", "מצב", ""].map((h) => (
                  <TableCell key={h} sx={{ whiteSpace: "nowrap" }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => {
                const self = u.user_id === me?.userId;
                const commander = u.roles.some((r) => r.role === "gaf_commander");
                return (
                  <TableRow key={u.user_id} hover sx={{ opacity: u.is_locked ? 0.55 : 1 }}>
                    <TableCell sx={{ direction: "ltr", textAlign: "right", fontFamily: "monospace" }}>{u.username}</TableCell>
                    <TableCell>
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                        {u.roles.map((r) => (
                          <Chip key={r.id} size="small" label={ROLE_NAME[r.role] ?? r.role} color={r.role === "coordinator" ? "primary" : "default"} />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>{u.soldier_name ?? "—"}</TableCell>
                    <TableCell>{u.soldier_id ? gafOf.get(u.soldier_id) ?? "" : ""}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "לא נכנס"}
                    </TableCell>
                    <TableCell>
                      {u.is_locked ? (
                        <Chip size="small" color="error" label="נעול" />
                      ) : u.must_change_password ? (
                        <Chip size="small" color="warning" variant="outlined" label="ממתין לכניסה ראשונה" />
                      ) : (
                        <Chip size="small" color="success" variant="outlined" label="פעיל" />
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {commander && (
                        <>
                          <Tooltip title="שיוך לחייל">
                            <IconButton size="small" onClick={() => setLinking({ user: u, soldier: u.soldier_id })}>
                              <LinkIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="סיסמה זמנית חדשה">
                            <IconButton size="small" onClick={() => setReset({ user: u, password: tempPassword(), done: false })}>
                              <KeyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                      {!self && (
                        <Tooltip title={u.is_locked ? "שחרור נעילה" : "נעילה – המשתמש לא יוכל להיכנס"}>
                          <IconButton size="small" onClick={() => act(() => api!.setUserLocked(u.user_id, !u.is_locked))}>
                            {u.is_locked ? <LockOpenIcon fontSize="small" /> : <LockIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {creating && <CreateDialog soldiers={soldiers} taken={(users ?? []).map((u) => u.username)} onClose={() => setCreating(false)} onDone={load} />}

      {reset && (
        <Dialog open onClose={() => setReset(null)} maxWidth="xs" fullWidth>
          <DialogTitle>סיסמה זמנית חדשה – {reset.user.username}</DialogTitle>
          <DialogContent dividers>
            {reset.done ? (
              <Handover username={reset.user.username} password={reset.password} />
            ) : (
              <Typography variant="body2">הסיסמה הנוכחית תפסיק לעבוד. המשתמש יקבל סיסמה זמנית ויבחר חדשה בכניסה הבאה.</Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setReset(null)}>{reset.done ? "סגירה" : "ביטול"}</Button>
            {!reset.done && (
              <Button
                variant="contained"
                onClick={() =>
                  act(async () => {
                    await api!.resetUserPassword(reset.user.user_id, reset.password);
                    setReset({ ...reset, done: true });
                  })
                }
              >
                איפוס
              </Button>
            )}
          </DialogActions>
        </Dialog>
      )}

      {linking && (
        <Dialog open onClose={() => setLinking(null)} maxWidth="sm" fullWidth>
          <DialogTitle>שיוך {linking.user.username} לחייל</DialogTitle>
          <DialogContent dividers>
            <Box sx={{ pt: 1 }}>
              <SoldierPicker soldiers={soldiers} value={linking.soldier} onChange={(id) => setLinking({ ...linking, soldier: id })} autoFocus />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLinking(null)}>ביטול</Button>
            <Button
              variant="contained"
              onClick={() =>
                act(async () => {
                  await api!.setUserSoldier(linking.user.user_id, linking.soldier);
                  setLinking(null);
                })
              }
            >
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

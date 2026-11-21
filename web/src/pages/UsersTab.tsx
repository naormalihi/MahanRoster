import AddIcon from "@mui/icons-material/PersonAddAlt1Outlined";
import CopyIcon from "@mui/icons-material/ContentCopyOutlined";
import KeyIcon from "@mui/icons-material/KeyOutlined";
import PhonelinkIcon from "@mui/icons-material/PhonelinkLockOutlined";
import LinkIcon from "@mui/icons-material/LinkOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
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
  Menu,
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
import { GRANTABLE, ROLE_NAME, tempPassword, usernameProblem, type AppUser, type CreatableRole } from "../lib/users";
import { CardList, RowCard, useNarrow } from "../components/CardList";

function SoldierPicker(props: { soldiers: ExistingSoldier[]; value: string | null; onChange: (id: string | null) => void; autoFocus?: boolean }) {
  const options = useMemo(() => props.soldiers.filter((s) => s.is_active), [props.soldiers]);
  return (
    <Autocomplete
      options={options}
      value={options.find((s) => s.id === props.value) ?? null}
      onChange={(_, v) => props.onChange(v?.id ?? null)}
      getOptionLabel={(s) => `${s.full_name} · ${s.gaf_name}`}
      renderInput={(p) => <TextField {...p} label="העובד (מכוח האדם)" autoFocus={props.autoFocus} helperText="השיוך לפי רשומת העובד – המספר האישי לא נשמר במערכת" />}
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
  const [role, setRole] = useState<CreatableRole>("gaf_commander");
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
      <DialogTitle>משתמש חדש – {role === "gaf_commander" ? "מפקד מסגרת" : ROLE_NAME[role]}</DialogTitle>
      <DialogContent dividers>
        {done ? (
          <Handover username={username.trim().toLowerCase()} password={password} />
        ) : (
          <Stack spacing={2}>
            <TextField select label="תפקיד" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <MenuItem value="gaf_commander">מפקד מסגרת</MenuItem>
              <MenuItem value="unit_commander">מפקד יחידה</MenuItem>
              <MenuItem value="coordinator">נע"ת תורנויות</MenuItem>
            </TextField>
            {role === "coordinator" ? (
              <Alert severity="warning">
                נע"ת תורנויות נוסף מקבל את כל ההרשאות שלך: שיבוץ, פרסום, הגדרות וניהול משתמשים – כולל איפוס סיסמאות ונעילה של נע"ת אחרים. בכניסה הראשונה
                הוא יחליף את הסיסמה הזמנית ויגדיר אימות דו-שלבי לפני שיוכל לפעול.
              </Alert>
            ) : (
            <Typography variant="body2" color="text.secondary">
              {role === "unit_commander"
                ? "מפקד היחידה רואה את כל נתוני היחידה לקריאה בלבד, ומסך הבית שלו הוא \"נתוני היחידה\" – כולל כל שינוי הגדרות שנע\"ת עשה בחודש האחרון."
                : "מפקד מסגרת רואה לקריאה בלבד את פרטי העובדים של המסגרת שלו – כולל ת\"ש, פטורים והיעדרויות – ואת הלוח, הטיוטה והפוטנציאל של כל היחידה בלי פרטים אישיים. המסגרת נקבע לפי העובד שמשויך אליו, ולכן כדאי לבחור אותו כאן."}
            </Typography>
            )}
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
  const narrow = useNarrow();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [soldiers, setSoldiers] = useState<ExistingSoldier[]>([]);
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<{ user: AppUser; password: string; done: boolean } | null>(null);
  const [linking, setLinking] = useState<{ user: AppUser; soldier: string | null } | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);
  const [mfaReset, setMfaReset] = useState<AppUser | null>(null);
  const [renaming, setRenaming] = useState<{ user: AppUser; name: string; error: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [granting, setGranting] = useState<{ user: AppUser; anchor: HTMLElement } | null>(null);
  const [revoking, setRevoking] = useState<{ user: AppUser; role: string } | null>(null);
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
          חשבונות אישיים. כל משתמש משויך לרשומת העובד שלו מכוח האדם (בלי מספר עובד). כאן נוצרים חשבונות של מפקדי מסגרות ומפקד היחידה (צפייה);
          עובדים מצטרפים בקוד הצטרפות ממסך העובדים; נע"ת וממלא מקום מוגדרים בהקמה.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          משתמש חדש
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {(users ?? [])
        .filter((u) => !u.is_locked && u.roles.some((r) => r.role === "viewer"))
        .map((u) => (
          <Alert
            key={u.user_id}
            severity="warning"
            action={
              <Button color="inherit" size="small" onClick={() => act(() => api!.setUserLocked(u.user_id, true))}>
                נעילה
              </Button>
            }
          >
            חשבון הצפייה המשותף <b>{u.username}</b> עדיין פעיל. בגרסה 2.0 לכל עובד חשבון אישי, ולכן מבטלים אותו: אחרי שהעובדים הצטרפו – לנעול.
          </Alert>
        ))}
      {!users ? (
        <CircularProgress />
      ) : (
        (() => {
          const parts = (u: AppUser) => {
            const self = u.user_id === me?.userId;
            const commander = u.roles.some((r) => r.role === "gaf_commander");
            // a staff role can be taken away (not the soldier one – it follows the link to a soldier – nor your own נע"ת)
            const removable = (role: string) => role !== "soldier" && u.roles.length > 1 && !(self && role === "coordinator");
            const roles = u.roles.map((r) => (
              <Chip
                key={r.id}
                size="small"
                label={ROLE_NAME[r.role] ?? r.role}
                color={r.role === "coordinator" ? "primary" : "default"}
                onDelete={removable(r.role) ? () => setRevoking({ user: u, role: r.role }) : undefined}
              />
            ));
            const grantable = GRANTABLE.filter((g) => !u.roles.some((r) => r.role === g));
            if (grantable.length && !u.is_locked)
              roles.push(
                <Chip key="add" size="small" variant="outlined" icon={<AddIcon />} label="תפקיד" onClick={(e) => setGranting({ user: u, anchor: e.currentTarget })} />,
              );
            // a gaf commander sees personal records of his own gaf only: without a gaf, of none
            if (u.roles.some((r) => r.role === "gaf_commander" && !r.gaf_id) && !u.soldier_id)
              roles.push(<Chip key="nogaf" size="small" color="warning" variant="outlined" label="לא משויך למסגרת – לא רואה פרטים אישיים" />);
            const login = u.last_login_at ? new Date(u.last_login_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "לא נכנס";
            const status = u.is_locked ? (
              <Chip size="small" color="error" label="נעול" />
            ) : u.must_change_password ? (
              <Chip size="small" color="warning" variant="outlined" label="ממתין לכניסה ראשונה" />
            ) : (
              <Chip size="small" color="success" variant="outlined" label="פעיל" />
            );
            const actions = (
              <>
                <Tooltip title="שינוי שם משתמש">
                  <IconButton size="small" aria-label="שינוי שם משתמש" onClick={() => setRenaming({ user: u, name: u.username, error: null })}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {commander && (
                  <Tooltip title="שיוך לעובד">
                    <IconButton size="small" aria-label="שיוך לעובד" onClick={() => setLinking({ user: u, soldier: u.soldier_id })}>
                      <LinkIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {/* any account but your own: a soldier, a commander or another coordinator who forgot it */}
                {!self && (
                  <Tooltip title="סיסמה זמנית חדשה">
                    <IconButton size="small" aria-label="סיסמה זמנית חדשה" onClick={() => setReset({ user: u, password: tempPassword(), done: false })}>
                      <KeyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {/* a new phone: another נע"ת or מ"מ removes the two-step login; he sets it up again when he signs in */}
                {!self && u.has_mfa && (
                  <Tooltip title="איפוס אימות דו-שלבי (טלפון חדש)">
                    <IconButton size="small" aria-label="איפוס אימות דו-שלבי" onClick={() => setMfaReset(u)}>
                      <PhonelinkIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {!self && (
                  <Tooltip title={u.is_locked ? "שחרור נעילה" : "נעילה – המשתמש לא יוכל להיכנס"}>
                    <IconButton size="small" aria-label={u.is_locked ? "שחרור נעילה" : "נעילה"} onClick={() => act(() => api!.setUserLocked(u.user_id, !u.is_locked))}>
                      {u.is_locked ? <LockOpenIcon fontSize="small" /> : <LockIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                )}
                {commander && !self && (
                  <Tooltip title="מחיקת המשתמש">
                    <IconButton size="small" aria-label="מחיקת המשתמש" color="error" onClick={() => setDeleting(u)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            );
            return { roles, login, status, actions };
          };
          return narrow ? (
            <CardList>
              {users.map((u) => {
                const x = parts(u);
                const gaf = u.soldier_id ? gafOf.get(u.soldier_id) : null;
                return (
                  <RowCard
                    key={u.user_id}
                    dim={u.is_locked}
                    title={
                      <Box component="span" sx={{ direction: "ltr", fontFamily: "monospace" }}>
                        {u.username}
                      </Box>
                    }
                    chips={
                      <>
                        {x.roles}
                        {x.status}
                      </>
                    }
                    sub={u.soldier_name ? `${u.soldier_name}${gaf ? ` · ${gaf}` : ""}` : undefined}
                    lines={[`כניסה אחרונה: ${x.login}`]}
                    actions={x.actions}
                  />
                );
              })}
            </CardList>
          ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                {["שם משתמש", "תפקיד", "עובד", "מסגרת", "כניסה אחרונה", "מצב", ""].map((h) => (
                  <TableCell key={h} sx={{ whiteSpace: "nowrap" }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => {
                const x = parts(u);
                return (
                  <TableRow key={u.user_id} hover sx={{ opacity: u.is_locked ? 0.55 : 1 }}>
                    <TableCell sx={{ direction: "ltr", textAlign: "right", fontFamily: "monospace" }}>{u.username}</TableCell>
                    <TableCell>
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                        {x.roles}
                      </Stack>
                    </TableCell>
                    <TableCell>{u.soldier_name ?? "—"}</TableCell>
                    <TableCell>{u.soldier_id ? gafOf.get(u.soldier_id) ?? "" : ""}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{x.login}</TableCell>
                    <TableCell>{x.status}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{x.actions}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
          );
        })()
      )}

      {renaming && (
        <Dialog open onClose={() => setRenaming(null)} maxWidth="xs" fullWidth>
          <DialogTitle>שינוי שם משתמש</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {renaming.user.soldier_name ? `${renaming.user.soldier_name} · ` : ""}השם הנוכחי: <b dir="ltr">{renaming.user.username}</b>. הסיסמה, ההרשאות והחיבורים הפתוחים
                נשארים; בכניסה הבאה הוא נכנס עם השם החדש – כדאי לעדכן אותו.
              </Typography>
              <TextField
                label="שם משתמש חדש"
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value, error: null })}
                helperText={renaming.error ?? "אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון · 3–32 תווים"}
                error={!!renaming.error}
                autoFocus
                slotProps={{ htmlInput: { dir: "ltr", autoCapitalize: "none", autoCorrect: "off", spellCheck: false } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenaming(null)}>ביטול</Button>
            <Button
              variant="contained"
              disabled={!/^[a-z0-9._-]{3,32}$/.test(renaming.name.trim().toLowerCase()) || renaming.name.trim().toLowerCase() === renaming.user.username}
              onClick={async () => {
                const r = renaming;
                const name = r.name.trim().toLowerCase();
                try {
                  await api!.renameUser(r.user.user_id, name);
                  setRenaming(null);
                  setNotice(`שם המשתמש שונה: ${r.user.username} ← ${name}`);
                  await load();
                } catch (e) {
                  setRenaming({ ...r, error: (e as Error).message });
                }
              }}
            >
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {mfaReset && (
        <Dialog open onClose={() => setMfaReset(null)} maxWidth="xs" fullWidth>
          <DialogTitle>איפוס אימות דו-שלבי</DialogTitle>
          <DialogContent dividers>
            <Typography>
              לאפס את האימות הדו-שלבי של <b>{mfaReset.username}</b>
              {mfaReset.soldier_name ? ` (${mfaReset.soldier_name})` : ""}?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              מתאים כשהוא החליף טלפון או מחק את אפליקציית האימות. הוא יוצא מכל המכשירים, ובכניסה הבאה – עם הסיסמה שלו – יסרוק קוד QR חדש.
              ודא קודם, בטלפון או פנים מול פנים, שזה באמת הוא שביקש. האיפוס נרשם ביומן ושאר הסגל מקבל עדכון.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setMfaReset(null)}>ביטול</Button>
            <Button
              variant="contained"
              onClick={() => {
                const u = mfaReset;
                setMfaReset(null);
                void act(async () => {
                  await api!.resetUserMfa(u.user_id);
                  setNotice(`האימות של ${u.username} אופס. בכניסה הבאה הוא יגדיר אותו מחדש.`);
                });
              }}
            >
              איפוס
            </Button>
          </DialogActions>
        </Dialog>
      )}
      <Menu anchorEl={granting?.anchor} open={!!granting} onClose={() => setGranting(null)}>
        {granting &&
          GRANTABLE.filter((g) => !granting.user.roles.some((r) => r.role === g)).map((g) => (
            <MenuItem
              key={g}
              onClick={() => {
                const u = granting.user;
                setGranting(null);
                void act(() => api!.grantUserRole(u.user_id, g));
              }}
            >
              הוספת תפקיד: {ROLE_NAME[g]}
            </MenuItem>
          ))}
      </Menu>
      {revoking && (
        <Dialog open onClose={() => setRevoking(null)} maxWidth="xs" fullWidth>
          <DialogTitle>הסרת תפקיד</DialogTitle>
          <DialogContent dividers>
            <Typography>
              להסיר מ-<b>{revoking.user.username}</b> את התפקיד {ROLE_NAME[revoking.role as keyof typeof ROLE_NAME] ?? revoking.role}?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              החשבון נשאר, עם שאר התפקידים שלו. הפעולה נרשמת ביומן.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRevoking(null)}>ביטול</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => {
                const x = revoking;
                setRevoking(null);
                void act(() => api!.revokeUserRole(x.user.user_id, x.role as never));
              }}
            >
              הסרה
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {deleting && (
        <Dialog open onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
          <DialogTitle>מחיקת משתמש</DialogTitle>
          <DialogContent dividers>
            <Typography>
              למחוק את <b>{deleting.username}</b>
              {deleting.soldier_name ? ` (${deleting.soldier_name})` : ""}?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              המשתמש לא יוכל להיכנס יותר, ושם המשתמש יתפנה. אם שמו רשום על פעולות במערכת (אישורים, החלטות), החשבון נסגר ומוסתר במקום להימחק,
              כדי לשמור מי עשה מה. המחיקה נרשמת ביומן.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(null)}>ביטול</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => {
                const u = deleting;
                setDeleting(null);
                void act(async () => {
                  await api!.deleteUser(u.user_id);
                });
              }}
            >
              מחיקה
            </Button>
          </DialogActions>
        </Dialog>
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
          <DialogTitle>שיוך {linking.user.username} לעובד</DialogTitle>
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

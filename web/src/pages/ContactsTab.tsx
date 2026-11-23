import AddIcon from "@mui/icons-material/Add";
import ArrowUpIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { contactProblems, ROLE_LABEL, toSave, type ContactEntry } from "../lib/contacts";
import { formatPhone } from "../lib/phone";
import type { AppUser } from "../lib/users";

const CONTACT_ROLES = ["coordinator", "deputy", "gaf_commander"];
const activeRole = (u: AppUser, now = Date.now()) =>
  u.roles.find(
    (r) => CONTACT_ROLES.includes(r.role) && (!r.valid_from || Date.parse(r.valid_from) <= now) && (!r.valid_to || Date.parse(r.valid_to) > now),
  )?.role ?? null;

/**
 * "אנשי קשר לעובדים": whom soldiers see under "למי לפנות". Up to two of אחראי השיבוצים / מ"מ are shown,
 * in this order, and each soldier sees his own gaf's commander if he is on the list.
 * The list reads as rows; adding or editing one opens a small window, and every change is saved.
 */
export function ContactsTab() {
  const { api } = useAuth();
  const [list, setList] = useState<ContactEntry[] | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** the row in the window: an index in the list, or a new one */
  const [editing, setEditing] = useState<{ index: number | null; entry: ContactEntry } | null>(null);
  const [pick, setPick] = useState("");

  const load = useCallback(() => {
    api!.soldierContactsList().then(setList, (e) => setMsg({ ok: false, text: (e as Error).message }));
    api!.listUsers().then(setUsers, () => setUsers([]));
  }, [api]);
  useEffect(load, [load]);

  if (!list) return null;
  const candidates = users.filter((u) => !u.is_locked && activeRole(u) && !list.some((c) => c.user_id === u.user_id));
  const roleOf = (c: ContactEntry) => {
    const u = users.find((x) => x.user_id === c.user_id);
    return (u && activeRole(u)) ?? c.role ?? null;
  };

  async function save(next: ContactEntry[], done: string): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      await api!.setSoldierContacts(toSave(next));
      setList(next);
      setMsg({ ok: true, text: done });
      load();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const problems = editing ? contactProblems([editing.entry]) : [];

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h3">אנשי קשר לעובדים</Typography>
          <Typography variant="body2" color="text.secondary">
            מי שמופיע כאן מוצג לעובדים תחת &quot;למי לפנות&quot;, עם וואטסאפ וחיוג. מוצגים עד שניים מאחראי השיבוצים / מ&quot;מ לפי הסדר, וכל עובד רואה גם את מפקד המסגרת שלו אם הוא ברשימה. הטלפון של מי
            שלא ברשימה לא מוצג לעובדים.
          </Typography>
        </Box>

        {list.length === 0 ? (
          <Alert severity="warning">עוד לא נבחר איש קשר – העובדים לא רואים למי לפנות.</Alert>
        ) : (
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2 }}>
            {list.map((c, i) => {
              const role = roleOf(c);
              const phone = c.phone || c.card_phone;
              return (
                <Stack
                  key={c.user_id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", px: 1.5, py: 1, borderTop: i ? 1 : 0, borderColor: "divider" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{c.display_name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {role ? ROLE_LABEL[role] : "אין תפקיד פעיל"}
                      {" · "}
                      {phone ? (
                        <span dir="ltr">{formatPhone(phone)}</span>
                      ) : (
                        "בלי טלפון"
                      )}
                      {!c.phone && c.card_phone ? " (מכרטיס העובד)" : ""}
                    </Typography>
                  </Box>
                  <Tooltip title="למעלה">
                    <span>
                      <IconButton
                        size="small"
                        disabled={i === 0 || busy}
                        onClick={() => {
                          const x = [...list];
                          [x[i - 1], x[i]] = [x[i], x[i - 1]];
                          void save(x, "הסדר נשמר.");
                        }}
                        aria-label={`העברת ${c.display_name} למעלה`}
                      >
                        <ArrowUpIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="עריכה">
                    <IconButton size="small" disabled={busy} onClick={() => setEditing({ index: i, entry: { ...c } })} aria-label={`עריכת ${c.display_name}`}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="הסרה">
                    <IconButton
                      size="small"
                      color="error"
                      disabled={busy}
                      onClick={() => void save(list.filter((_, j) => j !== i), `${c.display_name} הוסר מהרשימה.`)}
                      aria-label={`הסרת ${c.display_name}`}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              );
            })}
          </Box>
        )}

        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField select size="small" label="הוספת איש קשר" value={pick} onChange={(e) => setPick(e.target.value)} sx={{ flex: 1, maxWidth: 360 }} disabled={!candidates.length}>
            {candidates.map((u) => (
              <MenuItem key={u.user_id} value={u.user_id}>
                {u.soldier_name ?? u.username} · {ROLE_LABEL[activeRole(u)!]}
              </MenuItem>
            ))}
          </TextField>
          <Button
            startIcon={<AddIcon />}
            disabled={!pick || busy}
            onClick={() => {
              const u = users.find((x) => x.user_id === pick)!;
              setEditing({ index: null, entry: { user_id: u.user_id, display_name: u.soldier_name ?? "", phone: null, card_phone: null, role: activeRole(u) } });
              setPick("");
            }}
          >
            הוספה
          </Button>
        </Stack>
        {msg && (
          <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>
            {msg.text}
          </Alert>
        )}
      </Stack>

      {editing && (
        <Dialog open onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{editing.index === null ? "איש קשר חדש" : "עריכת איש קשר"}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {users.find((u) => u.user_id === editing.entry.user_id)?.username ?? ""}
                {roleOf(editing.entry) ? ` · ${ROLE_LABEL[roleOf(editing.entry)!]}` : ""}
              </Typography>
              <TextField
                label="שם שמוצג לעובדים"
                value={editing.entry.display_name}
                onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, display_name: e.target.value } })}
                autoFocus
              />
              <TextField
                label="טלפון"
                value={formatPhone(editing.entry.phone)}
                placeholder={editing.entry.card_phone ? `${formatPhone(editing.entry.card_phone)} (מכרטיס העובד)` : "050-0000000"}
                onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, phone: e.target.value } })}
                helperText={editing.entry.card_phone ? "ריק – הטלפון מכרטיס העובד" : undefined}
                slotProps={{ htmlInput: { dir: "ltr", inputMode: "tel" }, inputLabel: { shrink: true } }}
              />
              {problems.length > 0 && <Alert severity="warning">{problems.join(" · ")}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(null)}>ביטול</Button>
            <Button
              variant="contained"
              disabled={busy || problems.length > 0}
              onClick={async () => {
                const next =
                  editing.index === null ? [...list, editing.entry] : list.map((c, j) => (j === editing.index ? editing.entry : c));
                if (await save(next, editing.index === null ? `${editing.entry.display_name.trim()} נוסף – העובדים רואים אותו.` : "נשמר."))
                  setEditing(null);
              }}
            >
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Paper>
  );
}

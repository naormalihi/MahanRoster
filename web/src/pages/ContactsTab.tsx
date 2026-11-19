import AddIcon from "@mui/icons-material/Add";
import ArrowUpIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import { Alert, Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
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
 * "אנשי קשר לחיילים": whom soldiers see under "למי לפנות". Up to two of נע"ת / מ"מ are shown,
 * in this order, and each soldier sees his own gaf's commander if he is on the list.
 */
export function ContactsTab() {
  const { api } = useAuth();
  const [list, setList] = useState<ContactEntry[] | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    api!.soldierContactsList().then(setList, (e) => setMsg({ ok: false, text: (e as Error).message }));
    api!.listUsers().then(setUsers, () => setUsers([]));
  }, [api]);
  useEffect(load, [load]);

  if (!list) return null;
  const candidates = users.filter((u) => !u.is_locked && activeRole(u) && !list.some((c) => c.user_id === u.user_id));
  const edit = (i: number, patch: Partial<ContactEntry>) => {
    setList(list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    setDirty(true);
  };
  const problems = contactProblems(list);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api!.setSoldierContacts(toSave(list!));
      setMsg({ ok: true, text: "נשמר – החיילים רואים את אנשי הקשר האלה." });
      setDirty(false);
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h3">אנשי קשר לחיילים</Typography>
          <Typography variant="body2" color="text.secondary">
            מי שמופיע כאן מוצג לחיילים תחת &quot;למי לפנות&quot;, עם וואטסאפ וחיוג – ב&quot;התורנויות שלי&quot;, בבקשות כשהמועד נסגר ובתפריט. מוצגים עד שניים מנע&quot;ת / מ&quot;מ לפי הסדר, וכל
            חייל רואה גם את מפקד הגף שלו אם הוא ברשימה. הטלפון של מי שלא ברשימה לא מוצג לחיילים.
          </Typography>
        </Box>
        {list.length === 0 && <Alert severity="warning">עוד לא נבחר איש קשר – החיילים לא רואים למי לפנות.</Alert>}
        {list.map((c, i) => {
          const u = users.find((x) => x.user_id === c.user_id);
          const role = (u && activeRole(u)) ?? c.role ?? null;
          return (
            <Stack key={c.user_id} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 150 }}>
                {u?.username ?? "משתמש"} · {role ? ROLE_LABEL[role] : "אין תפקיד פעיל"}
              </Typography>
              <TextField size="small" label="שם שמוצג לחיילים" value={c.display_name} onChange={(e) => edit(i, { display_name: e.target.value })} sx={{ flex: 1 }} />
              <TextField
                size="small"
                label="טלפון"
                value={c.phone ? formatPhone(c.phone) : ""}
                placeholder={c.card_phone ? `${formatPhone(c.card_phone)} (מכרטיס החייל)` : "050-0000000"}
                onChange={(e) => edit(i, { phone: e.target.value })}
                slotProps={{ htmlInput: { dir: "ltr" }, inputLabel: { shrink: true } }}
                sx={{ width: { sm: 200 } }}
              />
              <Stack direction="row">
                <Tooltip title="למעלה">
                  <span>
                    <IconButton
                      size="small"
                      disabled={i === 0}
                      onClick={() => {
                        const x = [...list];
                        [x[i - 1], x[i]] = [x[i], x[i - 1]];
                        setList(x);
                        setDirty(true);
                      }}
                      aria-label="העברה למעלה"
                    >
                      <ArrowUpIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="הסרה">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => {
                      setList(list.filter((_, j) => j !== i));
                      setDirty(true);
                    }}
                    aria-label={`הסרת ${c.display_name}`}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          );
        })}
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField select size="small" label="הוספת איש קשר" value={pick} onChange={(e) => setPick(e.target.value)} sx={{ minWidth: 240 }} disabled={!candidates.length}>
            {candidates.map((u) => (
              <MenuItem key={u.user_id} value={u.user_id}>
                {u.soldier_name ?? u.username} · {ROLE_LABEL[activeRole(u)!]}
              </MenuItem>
            ))}
          </TextField>
          <Button
            startIcon={<AddIcon />}
            disabled={!pick}
            onClick={() => {
              const u = users.find((x) => x.user_id === pick)!;
              setList([...list, { user_id: u.user_id, display_name: u.soldier_name ?? "", phone: null, card_phone: null, role: activeRole(u) }]);
              setPick("");
              setDirty(true);
            }}
          >
            הוספה
          </Button>
        </Stack>
        {problems.length > 0 && <Alert severity="warning">{problems.join(" · ")}</Alert>}
        {msg && (
          <Alert severity={msg.ok ? "success" : "error"} onClose={() => setMsg(null)}>
            {msg.text}
          </Alert>
        )}
        <Box>
          <Button variant="contained" disabled={busy || !dirty || problems.length > 0} onClick={() => void save()}>
            שמירה
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

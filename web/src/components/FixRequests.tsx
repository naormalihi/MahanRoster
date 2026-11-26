import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { dmy, type StaffFixRequest } from "../lib/profile";

/** Staff: an employee's (or everyone's) open "לא נכון?" requests – "תוקן" / "לא רלוונטי", with a line back. */
export function FixRequestsDialog(props: { soldierId?: string; names: Map<string, string>; onClose: () => void; onChanged: () => void }) {
  const { api } = useAuth();
  const [list, setList] = useState<StaffFixRequest[] | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api!
      .profileFixes(props.soldierId)
      .then(setList)
      .catch((e) => setError((e as Error).message));
  }, [api, props.soldierId]);

  async function handle(f: StaffFixRequest, status: "fixed" | "dismissed") {
    setBusy(f.id);
    setError(null);
    try {
      await api!.handleProfileFix(f.id, status, reply[f.id] ?? "");
      setList((l) => (l ?? []).filter((x) => x.id !== f.id));
      props.onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  const who = props.soldierId ? props.names.get(props.soldierId) : null;
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>בקשות תיקון פרטים{who ? ` – ${who}` : ""}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {list === null && !error && <Typography color="text.secondary">טוען…</Typography>}
          {list?.length === 0 && <Typography color="text.secondary">אין בקשות פתוחות.</Typography>}
          {list?.map((f) => (
            <Box key={f.id} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                {props.soldierId ? "" : `${props.names.get(f.soldier_id) ?? "עובד"} · `}
                {f.field} · {dmy(f.created_at)}
              </Typography>
              {f.current && (
                <Typography variant="body2">
                  רשום היום: <b>{f.current}</b>
                </Typography>
              )}
              <Typography sx={{ mt: 0.5 }}>{f.requested}</Typography>
              <TextField
                size="small"
                fullWidth
                sx={{ mt: 1 }}
                label="תשובה לעובד (רשות)"
                value={reply[f.id] ?? ""}
                onChange={(e) => setReply({ ...reply, [f.id]: e.target.value.slice(0, 200) })}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button size="small" variant="contained" disabled={busy === f.id} onClick={() => void handle(f, "fixed")}>
                  תוקן
                </Button>
                <Button size="small" variant="outlined" color="inherit" disabled={busy === f.id} onClick={() => void handle(f, "dismissed")}>
                  לא רלוונטי
                </Button>
              </Stack>
            </Box>
          ))}
          <Typography variant="caption" color="text.secondary">
            את התיקון עצמו עושים בכרטיס העובד (או בטעינת הקובץ הבא). "תוקן" / "לא רלוונטי" שולחים לעובד הודעה עם התשובה.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}

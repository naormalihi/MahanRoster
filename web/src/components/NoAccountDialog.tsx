import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { NoAccountRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { shortDayLabel } from "../lib/dates";
import { DutyWhatsAppButton } from "./DutyWhatsApp";

/**
 * After publishing: the soldiers with duties in the cycle and no account. One WhatsApp message
 * each with all his coming duties and a join code; a sent one is marked, as with join codes.
 */
export function NoAccountDialog({ cycleId, onClose }: { cycleId: string; onClose: () => void }) {
  const { api } = useAuth();
  const [rows, setRows] = useState<NoAccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api!.noAccountDuties(cycleId).then(setRows, (e) => setError((e as Error).message));
  }, [api, cycleId]);
  const left = rows?.filter((r) => !r.sent).length ?? 0;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>שליחה למי שאין לו חשבון</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          העובדים האלה לא קיבלו התראה על הלוח. לכל אחד – הודעה אחת עם כל התורנויות שלו במחזור וקוד הצטרפות אישי. כשהוא עונה &quot;קיבלתי&quot; – מסמנים &quot;וידאתי בטלפון&quot; בתמונת המצב.
        </Typography>
        {!rows && !error && <CircularProgress size={22} />}
        {rows?.length === 0 && <Alert severity="success">לכל המשובצים יש חשבון – כולם קיבלו התראה.</Alert>}
        {rows && rows.length > 0 && (
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
            {rows.map((r) => (
              <Stack key={r.soldier_id} direction="row" spacing={1} sx={{ py: 0.75, alignItems: "center" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600 }}>{r.full_name}</Typography>
                    {r.gaf_name && (
                      <Typography variant="caption" color="text.secondary">
                        {r.gaf_name}
                      </Typography>
                    )}
                    {r.sent && <Chip size="small" color="success" variant="outlined" label="נשלח" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {r.duties === 1 ? "תורנות אחת" : `${r.duties} תורנויות`} · הראשונה {shortDayLabel(r.first_at)}
                    {!r.phone && (
                      <>
                        {" · "}
                        <Typography component={RouterLink} to={`/soldiers?edit=${r.soldier_id}`} variant="body2" sx={{ color: "primary.main" }}>
                          הוספת טלפון
                        </Typography>
                      </>
                    )}
                  </Typography>
                </Box>
                <DutyWhatsAppButton
                  query={{ soldierId: r.soldier_id, cycleId }}
                  name={r.full_name}
                  onError={setError}
                  onSent={() => setRows((x) => (x ?? []).map((y) => (y.soldier_id === r.soldier_id ? { ...y, sent: true } : y)))}
                />
              </Stack>
            ))}
          </Stack>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {rows && rows.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, px: 1 }}>
            {left ? `נשארו ${left} מתוך ${rows.length}` : "נשלח לכולם"}
          </Typography>
        )}
        <Button onClick={onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}

/** In operations: "N with duties and no account did not get a message" – opens the list. Staff only. */
export function NoAccountStrip({ cycleId }: { cycleId: string }) {
  const { api } = useAuth();
  const [left, setLeft] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) return;
    api!.noAccountDuties(cycleId).then(
      (r) => setLeft(r.filter((x) => !x.sent).length),
      () => setLeft(null),
    );
  }, [api, cycleId, open]);
  return (
    <>
      {!!left && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => setOpen(true)} sx={{ whiteSpace: "nowrap" }}>
              שליחת וואטסאפ
            </Button>
          }
        >
          {left === 1 ? "משובץ אחד בלי חשבון עוד לא קיבל" : `${left} משובצים בלי חשבון עוד לא קיבלו`} הודעה על התורנויות שלו{left === 1 ? "" : "הם"}.
        </Alert>
      )}
      {open && <NoAccountDialog cycleId={cycleId} onClose={() => setOpen(false)} />}
    </>
  );
}

import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { isoToDmy } from "../lib/dmy";
import { rangeWhen, validUntil, type MyRange } from "../lib/range";
import { DateTextField } from "./DateTextField";

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const daysTo = (iso: string) => Math.round((Date.parse(iso) - Date.parse(todayIso())) / 86_400_000);

/** מטווח: the employee's validity, the next planned range, and "עדכון" with the date of the last range. */
export function RangeCard() {
  const { api } = useAuth();
  const [r, setR] = useState<MyRange | null>(null);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    api!
      .myRange()
      .then(setR)
      .catch(() => setR(null));
  }, [api]);
  useEffect(load, [load]);
  if (!r) return null;

  const left = r.valid_until ? daysTo(r.valid_until) : null;
  const chip =
    left === null ? (
      <Chip size="small" variant="outlined" label="לא הוזן" />
    ) : left < 0 ? (
      <Chip size="small" color="error" label={`פג ב-${isoToDmy(r.valid_until)}`} />
    ) : left <= r.warning_days ? (
      <Chip size="small" color="warning" label={`פג בעוד ${left} ימים`} />
    ) : (
      <Chip size="small" color="success" variant="outlined" label={`בתוקף עד ${isoToDmy(r.valid_until)}`} />
    );

  async function save() {
    if (!last) return setError("צריך את תאריך המטווח");
    setBusy(true);
    setError(null);
    try {
      const until = await api!.updateMyRange(last);
      setOpen(false);
      setDone(`עודכן – בתוקף עד ${isoToDmy(until)}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          מטווח
        </Typography>
        {chip}
        <Button size="small" variant="outlined" sx={{ ms: "auto" }} onClick={() => (setLast(""), setError(null), setOpen(true))}>
          עדכון תאריך מטווח
        </Button>
      </Stack>
      {r.next && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          המטווח הקרוב: {rangeWhen(r.next)}
          {r.next.note ? ` · ${r.next.note}` : ""}
        </Typography>
      )}
      {done && (
        <Alert severity="success" sx={{ mt: 1 }} onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
      {open && (
        <Dialog open onClose={() => setOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>עדכון תאריך מטווח</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <DateTextField
                label="מתי ירית במטווח האחרון"
                value={last}
                onChange={(e) => setLast(e.target.value)}
                slotProps={{ htmlInput: { max: todayIso() } }}
                autoFocus
              />
              <Typography variant="body2" color="text.secondary">
                {last ? `התוקף יהיה עד ${isoToDmy(validUntil(last, r.validity_months))}` : `המטווח בתוקף ${r.validity_months} חודשים מהיום שבו ירית.`}
                {" "}העדכון חל מיד, ואחראי השיבוצים רואה שעדכנת בעצמך.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>ביטול</Button>
            <Button variant="contained" onClick={save} disabled={busy}>
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Paper>
  );
}

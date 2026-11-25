import { DateTextField } from "./DateTextField";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { todayIso } from "../lib/soldiers";

export type BulkRemoveResult =
  | { kind: "remove"; removed: number; duties_dropped: number }
  | { kind: "delete"; deleted: number; accounts: number; blocked: { id: string; name: string }[] };

/** "מחיקת הנבחרים": take them out of the unit (default), or delete them for good. */
export function BulkRemoveDialog({
  count,
  onClose,
  onRemove,
  onDelete,
}: {
  count: number;
  /** changed: something was done – clear the choice and reload */
  onClose: (changed: boolean) => void;
  onRemove: (fromDay: string) => Promise<BulkRemoveResult>;
  onDelete: () => Promise<BulkRemoveResult>;
}) {
  const [mode, setMode] = useState<"remove" | "delete">("remove");
  const [from, setFrom] = useState(todayIso());
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkRemoveResult | null>(null);

  const ready = mode === "remove" ? Boolean(from) : typed.trim() === String(count);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      setResult(mode === "remove" ? await onRemove(from) : await onDelete());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : () => onClose(Boolean(result))} fullWidth maxWidth="sm">
      <DialogTitle>{result ? "בוצע" : `מחיקת ${count === 1 ? "עובד אחד" : `${count} עובדים`}`}</DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={1.5}>
            {result.kind === "remove" ? (
              <Alert severity="success">
                {result.removed === 1 ? "עובד אחד הוצא" : `${result.removed} עובדים הוצאו`} מהיחידה
                {result.duties_dropped ? ` · ${result.duties_dropped} משימות ירדו מהם` : ""}.
                {result.removed < count ? " (מי שכבר לא היה פעיל – דולג.)" : ""}
              </Alert>
            ) : (
              <>
                <Alert severity="success">
                  {result.deleted === 1 ? "עובד אחד נמחק" : `${result.deleted} עובדים נמחקו`} לצמיתות
                  {result.accounts ? ` · ${result.accounts} חשבונות עובד נמחקו איתם` : ""}.
                </Alert>
                {result.blocked.length > 0 && (
                  <Alert severity="warning">
                    לא נמחקו – יש להם משימות בלוח שפורסם, וההיסטוריה שלו נשמרת. אפשר להוציא אותם מהיחידה במקום:
                    <Typography component="span" sx={{ display: "block", mt: 0.5, fontWeight: 600 }}>
                      {result.blocked.map((b) => b.name).join(", ")}
                    </Typography>
                  </Alert>
                )}
              </>
            )}
          </Stack>
        ) : (
          <Stack spacing={2}>
            <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as "remove" | "delete")}>
              <FormControlLabel
                value="remove"
                control={<Radio />}
                label={
                  <span>
                    <b>הוצאה מהיחידה</b> – מסומנים לא פעילים מהתאריך שתבחר, והמשימות שלהם מאותו יום יורדות. ההיסטוריה, הניקוד
                    והחשבון נשמרים.
                  </span>
                }
              />
              <FormControlLabel
                value="delete"
                control={<Radio color="error" />}
                sx={{ mt: 1 }}
                label={
                  <span>
                    <b>מחיקה לצמיתות</b> – העובד וכל מה שעליו נמחקים: אילוצים, פטורים, חסימות, ניקוד וקוד הצטרפות, וגם
                    חשבון עובד. מי שיש לו משימות בלוח שפורסם לא יימחק.
                  </span>
                }
              />
            </RadioGroup>
            {mode === "remove" ? (
              <DateTextField
                label="מתאריך"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 220 }}
              />
            ) : (
              <>
                <Alert severity="error">אי אפשר לבטל מחיקה לצמיתות.</Alert>
                <TextField
                  label={`להמשך, הקלד את מספר הנבחרים: ${count}`}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  slotProps={{ htmlInput: { inputMode: "numeric" } }}
                  sx={{ maxWidth: 320 }}
                />
              </>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {result ? (
          <Button variant="contained" onClick={() => onClose(true)}>
            סגירה
          </Button>
        ) : (
          <>
            <Button onClick={() => onClose(false)} disabled={busy}>
              ביטול
            </Button>
            <Button variant="contained" color={mode === "delete" ? "error" : "primary"} onClick={go} disabled={busy || !ready}>
              {mode === "delete" ? "מחיקה לצמיתות" : "הוצאה מהיחידה"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

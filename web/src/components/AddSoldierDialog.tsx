import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useState } from "react";
import { EMPTY_FORM, formProblems, toRow, type AddSoldierForm, type AddSoldierResult } from "../lib/addSoldier";
import type { NamedRef, RankItem } from "../lib/api";
import { useAuth } from "../lib/auth";
import { normalizeIdNumber, rememberedUnitKey, rememberUnitKey, soldierKey, unitKeyCheck, unitKeyProblems } from "../lib/hmac";
import { PasswordField } from "./PasswordField";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" });
const fmt = (iso: string) => iso.split("-").reverse().slice(0, 2).join(".");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * One soldier by hand, instead of a personnel file. The ת.ז is hashed here with the unit key and
 * never sent; the same checks as the file. A newcomer: average score, no automatic duties in his
 * grace period, and a manual one then counts as a call-up.
 */
export function AddSoldierDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string, name: string) => void }) {
  const { api } = useAuth();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [f, setF] = useState<AddSoldierForm>(EMPTY_FORM(today()));
  const [ranks, setRanks] = useState<RankItem[]>([]);
  const [gafim, setGafim] = useState<NamedRef[]>([]);
  const [grace, setGrace] = useState(90);
  const [key, setKey] = useState(rememberedUnitKey());
  const [keyOk, setKeyOk] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstKey, setFirstKey] = useState(false);
  const [found, setFound] = useState<Extract<AddSoldierResult, { status: "exists" | "inactive" }> | null>(null);

  useEffect(() => {
    api!.ranks().then(setRanks, () => undefined);
    api!.gafim().then(setGafim, () => undefined);
    api!.scoringSettings().then((s) => setGrace(s.grace_days), () => undefined);
  }, [api]);

  // a key remembered on this device is checked once, quietly
  useEffect(() => {
    if (!key || unitKeyProblems(key)) return;
    void checkKey(key, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkKey(k: string, quiet = false) {
    const p = unitKeyProblems(k);
    if (p) return quiet ? undefined : setError(p);
    const stored = await api!.unitKeyCheck();
    const mine = await unitKeyCheck(k);
    if (!stored) {
      // no soldier was ever added: this key becomes the unit's (as on a first file) – keep a copy of it
      if (quiet) return;
      await api!.setUnitKeyCheck(mine);
      setFirstKey(true);
    } else if (stored !== mine) return quiet ? setKeyOk(false) : setError("המפתח לא תואם למפתח של היחידה. בדוק שהוקלד נכון.");
    rememberUnitKey(k);
    setKeyOk(true);
    setError(null);
  }

  const problems = formProblems(f);
  const set = <K extends keyof AddSoldierForm>(k: K) => (v: AddSoldierForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const err = (k: keyof AddSoldierForm) => (touched ? problems[k] : undefined);
  const field = (k: keyof AddSoldierForm, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={f[k] as string}
      onChange={(e) => set(k)(e.target.value as never)}
      error={!!err(k)}
      helperText={err(k)}
      fullWidth
      size="small"
      {...extra}
    />
  );

  async function save() {
    setTouched(true);
    if (Object.keys(problems).length || !keyOk) return;
    setBusy(true);
    setError(null);
    try {
      const k = await soldierKey(key, normalizeIdNumber(f.idNumber)!);
      const r = await api!.addSoldier(toRow(f, k));
      if (r.status === "added") onAdded(r.id, `${f.firstName.trim()} ${f.lastName.trim()}`);
      else setFound(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reactivate() {
    if (!found) return;
    setBusy(true);
    try {
      await api!.reactivateSoldier(found.id, f.joinDate);
      onAdded(found.id, found.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const graceEnd = f.joinDate ? fmt(addDays(f.joinDate, grace)) : "";
  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>הוספת חייל</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {!keyOk && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                מפתח היחידה – כמו בטעינת כוח אדם. הת.ז מוצפנת בו כאן, במכשיר, ולא נשלחת לשרת.
              </Typography>
              <Stack direction="row" spacing={1}>
                <PasswordField label="מפתח היחידה" value={key} onChange={(e) => setKey(e.target.value)} size="small" fullWidth />
                <Button variant="outlined" onClick={() => void checkKey(key)}>
                  אישור
                </Button>
              </Stack>
            </Box>
          )}
          {firstKey && (
            <Alert severity="warning">
              זה המפתח הראשון של היחידה, והוא נקבע עכשיו. שמור עותק שלו במקום בטוח: בלעדיו אי אפשר לזהות את החיילים בטעינות הבאות.
            </Alert>
          )}
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, opacity: keyOk ? 1 : 0.5 }}>
            {field("idNumber", "ת.ז *", { slotProps: { htmlInput: { inputMode: "numeric", dir: "ltr" } }, disabled: !keyOk })}
            <Box />
            {field("firstName", "שם פרטי *", { disabled: !keyOk })}
            {field("lastName", "שם משפחה *", { disabled: !keyOk })}
            {field("rankId", "דרגה *", { select: true, disabled: !keyOk, children: ranks.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>) })}
            {field("serviceType", "סוג שירות *", {
              select: true,
              disabled: !keyOk,
              children: [
                <MenuItem key="m" value="mandatory">חובה</MenuItem>,
                <MenuItem key="c" value="career">קבע</MenuItem>,
              ],
            })}
            {field("gafId", "גף *", { select: true, disabled: !keyOk, children: gafim.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>) })}
            {field("gender", "מין", {
              select: true,
              disabled: !keyOk,
              children: [
                <MenuItem key="" value="">לא צוין</MenuItem>,
                <MenuItem key="m" value="male">זכר</MenuItem>,
                <MenuItem key="f" value="female">נקבה</MenuItem>,
              ],
            })}
            {f.serviceType === "mandatory" && field("enlistmentDate", "תאריך גיוס", { type: "date", slotProps: { inputLabel: { shrink: true } } })}
            {f.serviceType === "mandatory" && field("releaseDate", "תאריך שחרור", { type: "date", slotProps: { inputLabel: { shrink: true } } })}
            {f.serviceType === "career" && field("careerStartDate", "כניסה לקבע", { type: "date", slotProps: { inputLabel: { shrink: true } } })}
            {field("rangeValidUntil", "תוקף מטווח", { type: "date", slotProps: { inputLabel: { shrink: true } }, disabled: !keyOk })}
            {field("phone", "טלפון נייד", { slotProps: { htmlInput: { inputMode: "tel", dir: "ltr" } }, disabled: !keyOk })}
            {field("joinDate", "תאריך כניסה ליחידה *", { type: "date", slotProps: { inputLabel: { shrink: true } }, disabled: !keyOk })}
          </Box>
          <Stack direction="row" sx={{ flexWrap: "wrap" }}>
            <FormControlLabel control={<Checkbox checked={f.parent} onChange={(e) => set("parent")(e.target.checked)} disabled={!keyOk} />} label="משרת הורה" />
            <FormControlLabel control={<Checkbox checked={f.homeNightly} onChange={(e) => set("homeNightly")(e.target.checked)} disabled={!keyOk} />} label='ת"ש 7 (לינה בבית)' />
          </Stack>
          <Alert severity="info" icon={false}>
            <b>חייל חדש ביחידה:</b> נכנס עם הניקוד הממוצע של הקבוצה שלו. המנוע לא ישבץ אותו אוטומטית עד {graceEnd || "תום תקופת החסד"} ({grace} יום מהכניסה).
            אפשר לשבץ אותו ידנית גם קודם – אז זה נחשב הקפצה, כפיצוי.
          </Alert>
          {found && (
            <Alert
              severity={found.status === "inactive" ? "warning" : "info"}
              action={
                found.status === "inactive" ? (
                  <Button color="inherit" size="small" onClick={reactivate} disabled={busy}>
                    להחזיר ליחידה
                  </Button>
                ) : undefined
              }
            >
              {found.status === "exists" ? "כבר קיים: " : "היה ביחידה ויצא: "}
              <b>{found.name}</b>
              {found.gaf ? `, ${found.gaf}` : ""}.{found.status === "exists" ? " לא נוצר כפיל – אפשר לערוך אותו ברשימה." : " ההיסטוריה והניקוד שלו נשמרים."}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" onClick={save} disabled={busy || !keyOk}>
          הוספה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

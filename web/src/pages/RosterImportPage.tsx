import BackIcon from "@mui/icons-material/ArrowForward";
import DownloadIcon from "@mui/icons-material/DownloadOutlined";
import KeyIcon from "@mui/icons-material/KeyOutlined";
import UploadIcon from "@mui/icons-material/UploadFileOutlined";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import NextIcon from "@mui/icons-material/ArrowBack";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { FrameworkPicker } from "../components/FrameworkPicker";
import { useCycle } from "../lib/cycleContext";
import {
  buildTree,
  forSaving,
  hasFrameworks,
  initialSelection,
  isSelected,
  placeLabel,
  placeOf,
  type FrameworkSelection,
  type TreeNode,
} from "../lib/frameworks";
import { STAGE_SCREEN, stageLabel, type CycleStatus } from "../lib/cycles";
import * as XLSX from "xlsx";
import type { ApplyResult } from "../lib/api";
import { useAuth } from "../lib/auth";
import { forgetUnitKey, rememberUnitKey, rememberedUnitKey, soldierKey, unitKeyCheck, unitKeyProblems } from "../lib/hmac";
import { defaultPicks, doublePicks, matchForRekey, rekeyPairs, type RekeyRow } from "../lib/rekey";
import {
  FIELDS,
  RECORD_LABELS,
  approvePlan,
  changeKey,
  detectMapping,
  mappingProblems,
  parseRows,
  planImport,
  toRecord,
  type Mapping,
  type ParseResult,
  type RosterPlan,
  type ExistingSoldier,
  type SoldierRecord,
  rankResolver,
} from "../lib/roster";

import { formatPhone } from "../lib/phone";

const SERVICE_LABEL = { mandatory: "חובה", career: "קבע" } as const;

const showTash = (v: number | null) => (v ? `הת"ש ${v}` : "ללא");

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "כן";
  if (v === false) return "לא";
  if (v === "mandatory" || v === "career") return SERVICE_LABEL[v];
  if (v === "male") return "זכר";
  if (v === "female") return "נקבה";
  if (typeof v === "string" && /^9725\d{8}$/.test(v)) return formatPhone(v);
  return String(v);
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    FIELDS.filter((f) => f.key !== "firstName" && f.key !== "lastName").map((f) => f.label),
    FIELDS.filter((f) => f.key !== "firstName" && f.key !== "lastName").map((f) =>
      ({ idNumber: "1234567", fullName: "ישראל ישראלי", serviceType: "חובה", careerStartDate: "", gaf: "מסגרת מבצעים", framework: "", rank: "חובה 3",
         gender: "זכר", enlistmentDate: "01/03/2025", releaseDate: "01/09/2027", rangeValidUntil: "", parent: "לא", phone: "050-1234567" } as Record<string, string>)[f.key] ?? ""),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "כוח אדם");
  XLSX.writeFile(wb, "תבנית-כוח-אדם.xlsx");
}

export function RosterImportPage() {
  const { api } = useAuth();
  const [step, setStep] = useState(0);
  const [unitKey, setUnitKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const { reload: reloadCycle } = useCycle();
  const [keyError, setKeyError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [plan, setPlan] = useState<RosterPlan | null>(null);
  // changes of existing soldiers load only when approved here (nothing is approved by default)
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState(0);
  // "מסגרות לטעינה": the tree of the file and what is chosen (kept in the settings)
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [sel, setSel] = useState<FrameworkSelection | null>(null);
  // moved to a framework not chosen: אחראי השיבוצים marks who goes inactive (nobody by default)
  const [deactivate, setDeactivate] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ApplyResult | null>(null);

  const changes = useMemo(
    () =>
      (plan?.updated ?? []).flatMap((u) =>
        u.changes.map((field) => ({
          key: changeKey(u.id, field),
          field,
          name: u.before.full_name,
          before: field === "tash_level" ? showTash(u.before.tash_level) : show(u.before[field]),
          after: field === "tash_level" ? showTash(u.after.tash_level) : show(u.after[field]),
        })),
      ),
    [plan],
  );
  const approvedCount = changes.filter((c) => approved.has(c.key)).length;
  const fieldGroups = useMemo(() => {
    const m = new Map<keyof SoldierRecord, string[]>();
    for (const c of changes) m.set(c.field, [...(m.get(c.field) ?? []), c.key]);
    return [...m.entries()];
  }, [changes]);
  function setMany(keys: string[], on: boolean) {
    setApproved((cur) => {
      const next = new Set(cur);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }
  const toggle = (keys: string[]) => setMany(keys, !approved.has(keys[0]));

  // first key of the unit (nothing stored yet) – then the key must be saved outside the system
  const [firstKey, setFirstKey] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  // a forgotten key: the file is loaded with a new key and matched to the soldiers by name
  const [rekey, setRekey] = useState(false);
  const [rekeyRows, setRekeyRows] = useState<RekeyRow[] | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [existingNow, setExistingNow] = useState<ExistingSoldier[]>([]);

  // the key confirmed earlier in this tab is used again (sign-out or closing the tab forgets it)
  useEffect(() => {
    api!.unitKeyCheck().then((c) => setFirstKey(!c), () => undefined);
    const k = rememberedUnitKey();
    if (k) {
      setUnitKey(k);
      void confirmKey(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmKey(key = unitKey) {
    const p = unitKeyProblems(key);
    if (p) return setKeyError(p);
    if (rekey) {
      // the new key is stored only when the matches are approved
      setKeyError(null);
      return setStep(1);
    }
    const check = await unitKeyCheck(key);
    const stored = await api!.unitKeyCheck();
    if (stored && stored !== check) {
      forgetUnitKey();
      setMismatch(true);
      return setKeyError("המפתח לא תואם למפתח שבו נטענו העובדים בעבר. בדוק שהוקלד נכון.");
    }
    if (!stored) await api!.setUnitKeyCheck(check); // first import fixes the key
    rememberUnitKey(key);
    setMismatch(false);
    setKeyError(null);
    setStep(1);
  }

  function downloadKeyBackup() {
    const text = [
      "תורנצ׳יק (MahanRoster) – מפתח היחידה לטעינת כוח אדם",
      `נשמר: ${new Date().toLocaleString("he-IL")}`,
      "",
      unitKey,
      "",
      "שמור את הקובץ במקום מאובטח (מנהל סיסמאות או כונן מוצפן) ומחק אותו מתיקיית ההורדות.",
      "בלי המפתח המערכת לא מזהה עובדים קיימים בטעינה.",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = "mahanroster-unit-key.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function approveRekey() {
    setBusy(true);
    setError(null);
    try {
      await api!.rekeySoldiers(rekeyPairs(picks), await unitKeyCheck(unitKey));
      rememberUnitKey(unitKey);
      setRekey(false);
      setRekeyRows(null);
      setFirstKey(false);
      await buildPreview(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function readFile(file: File) {
    setError(null);
    setFileName(file.name);
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
    const hdrs = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map(String);
    setHeaders(hdrs);
    setRecords(rows);
    setMapping(detectMapping(hdrs));
  }

  const mapProblems = useMemo(() => mappingProblems(mapping, headers), [mapping, headers]);

  async function chooseFrameworks() {
    if (!hasFrameworks(mapping)) {
      setSel(null);
      return buildPreview();
    }
    setBusy(true);
    setError(null);
    try {
      const t = buildTree(records, mapping);
      setTree(t);
      setSel(initialSelection(await api!.rosterFrameworks(), t));
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmFrameworks() {
    if (!sel) return;
    setBusy(true);
    try {
      await api!.setRosterFrameworks(forSaving(sel, tree));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return;
    }
    await buildPreview();
  }

  async function buildPreview(matching = rekey) {
    setBusy(true);
    setError(null);
    try {
      const chosen = sel && hasFrameworks(mapping) ? sel : null;
      const result = parseRows(records, mapping, chosen ? (r) => {
        const p = placeOf(r, mapping);
        return !p || isSelected(chosen, p);
      } : undefined);
      setParsed(result);
      // a military rank in the file ("סמל") becomes its neutral name ("חובה 3")
      const resolve = rankResolver(await api!.ranks());
      const incoming = await Promise.all(
        result.rows.map(async (r) => toRecord({ ...r, rank: resolve(r.rank) ?? r.rank }, await soldierKey(unitKey, r.idNumber))),
      );
      if (matching) {
        const existing = await api!.soldiers();
        const rows = matchForRekey(incoming, existing);
        setExistingNow(existing);
        setRekeyRows(rows);
        setPicks(defaultPicks(rows));
        setStep(3);
        return;
      }
      const [existing, gafim, ranks] = await Promise.all([api!.soldiers(), api!.gafim(), api!.ranks()]);
      // the file puts them in a framework not chosen – to spot who moved out
      const outside = new Map(
        await Promise.all(
          result.outside.map(async (o) => {
            const p = placeOf(o.record, mapping);
            return [await soldierKey(unitKey, o.idNumber), p ? placeLabel(p) : ""] as const;
          }),
        ),
      );
      setPlan(planImport(incoming, existing, gafim.map((g) => g.name), ranks.map((r) => r.name), outside));
      setApproved(new Set());
      setDeactivate(new Set());
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api!.applyRoster(approvePlan(plan, approved, deactivate)));
      // the cycle moves on by itself once a file is loaded – let the next step show it
      reloadCycle().catch(() => undefined);
      setStep(4);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setRecords([]);
    setParsed(null);
    setPlan(null);
    setDone(null);
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Button size="small" startIcon={<BackIcon />} component={RouterLink} to="/soldiers">
          עובדים
        </Button>
        <Typography variant="h1">טעינת כוח אדם</Typography>
      </Box>
      <Stepper activeStep={step} alternativeLabel>
        {["מפתח יחידה", "קובץ ועמודות", "מסגרות", "תצוגה מקדימה", "סיום"].map((l) => (
          <Step key={l}>
            <StepLabel>{l}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {error && <Alert severity="error">{error}</Alert>}

      {step === 0 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2} sx={{ maxWidth: 520 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <KeyIcon color="primary" />
              <Typography variant="h2">מפתח היחידה</Typography>
            </Stack>
            <Typography variant="body2">
              מספרי העובד לא יוצאים מהמחשב הזה. הדפדפן הופך כל מספר עובד למזהה מוצפן בעזרת מפתח היחידה, ורק המזהה נשלח לשרת.
              המפתח לא נשלח לשרת. אחרי שהוזן הוא נשמר בלשונית הזו עד היציאה מהמערכת או סגירת הלשונית.
            </Typography>
            {rekey && (
              <Alert severity="warning">
                החלפת מפתח: הזן מפתח חדש וטען את קובץ כוח האדם המלא. המערכת תתאים כל שורה לעובד קיים לפי השם, ואחרי שתאשר את ההתאמות העובדים יעברו
                למפתח החדש עם כל ההיסטוריה שלהם. המפתח הישן יפסיק לעבוד.
              </Alert>
            )}
            {(firstKey || rekey) && (
              <Alert severity="info">
                שמור את המפתח במנהל סיסמאות או במקום מאובטח אחר. בלעדיו המערכת לא מזהה עובדים קיימים בטעינה הבאה.
                <Box sx={{ mt: 1 }}>
                  <Button size="small" variant="outlined" startIcon={<DownloadIcon />} disabled={!!unitKeyProblems(unitKey)} onClick={downloadKeyBackup}>
                    הורדת קובץ גיבוי של המפתח
                  </Button>
                </Box>
              </Alert>
            )}
            <TextField
              label="מפתח היחידה"
              type={showKey ? "text" : "password"}
              value={unitKey}
              onChange={(e) => setUnitKey(e.target.value)}
              error={!!keyError}
              helperText={keyError ?? "לפחות 16 תווים. שמור עותק במקום בטוח מחוץ למערכת."}
              autoComplete="off"
              slotProps={{
                htmlInput: { dir: "ltr" },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showKey ? "הסתרת המפתח" : "הצגת המפתח"}
                        onClick={() => setShowKey((v) => !v)}
                        onMouseDown={(e) => e.preventDefault()}
                        edge="end"
                      >
                        {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Box>
              <Button variant="contained" onClick={() => confirmKey()} disabled={!unitKey}>
                המשך
              </Button>
              {mismatch && !rekey && (
                <Button
                  sx={{ mr: 1 }}
                  onClick={() => {
                    setRekey(true);
                    setMismatch(false);
                    setKeyError(null);
                    setUnitKey("");
                  }}
                >
                  שכחתי את המפתח – החלפת מפתח
                </Button>
              )}
              {rekey && (
                <Button sx={{ mr: 1 }} onClick={() => setRekey(false)}>
                  ביטול החלפת מפתח
                </Button>
              )}
            </Box>
          </Stack>
        </Paper>
      )}

      {step === 1 && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button variant="contained" component="label" startIcon={<UploadIcon />}>
                בחירת קובץ אקסל
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              </Button>
              <Button startIcon={<DownloadIcon />} onClick={downloadTemplate}>
                הורדת תבנית
              </Button>
              {fileName && <Chip label={`${fileName} · ${records.length} שורות`} />}
            </Stack>
            {headers.length > 0 && (
              <>
                <Typography variant="h3">התאמת עמודות</Typography>
                <Typography variant="body2" color="text.secondary">
                  זיהיתי את העמודות לפי הכותרות. אפשר לתקן ידנית.
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                  {FIELDS.map((f) => (
                    <TextField
                      key={f.key}
                      select
                      label={f.label + (f.required ? " *" : "")}
                      value={mapping[f.key] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}
                    >
                      <MenuItem value="">— לא קיים בקובץ —</MenuItem>
                      {headers.map((h) => (
                        <MenuItem key={h} value={h}>{h}</MenuItem>
                      ))}
                    </TextField>
                  ))}
                </Box>
                {mapProblems.map((p) => (
                  <Alert key={p} severity="warning">{p}</Alert>
                ))}
                <Box>
                  <Button variant="contained" onClick={chooseFrameworks} disabled={busy || mapProblems.length > 0}>
                    {hasFrameworks(mapping) ? "בחירת מסגרות" : "תצוגה מקדימה"}
                  </Button>
                </Box>
                {busy && <LinearProgress />}
              </>
            )}
          </Stack>
        </Paper>
      )}

      {step === 2 && sel && (
        <FrameworkPicker
          tree={tree}
          sel={sel}
          setSel={setSel}
          busy={busy}
          onBack={() => setStep(1)}
          onNext={confirmFrameworks}
        />
      )}

      {step === 3 && rekeyRows && (
        <RekeyPanel
          rows={rekeyRows}
          existing={existingNow}
          picks={picks}
          setPicks={setPicks}
          busy={busy}
          onApprove={approveRekey}
          onCancel={() => {
            setRekeyRows(null);
            setStep(1);
          }}
        />
      )}

      {step === 3 && !rekeyRows && plan && parsed && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
              <Chip color="success" label={`חדשים: ${plan.added.length}`} />
              <Chip color="info" label={`שינויים לאישור: ${changes.length} (אושרו ${approvedCount})`} />
              <Chip color="warning" label={`לא בקובץ (יסומנו לא פעילים): ${plan.removed.length}`} />
              <Chip label={`ללא שינוי: ${plan.unchanged}`} />
              {parsed.errors.length > 0 && <Chip color="error" label={`שורות שגויות: ${parsed.errors.length}`} />}
              {parsed.outside.length > 0 && <Chip variant="outlined" label={`מחוץ למסגרות שנבחרו: ${parsed.outside.length}`} />}
            </Stack>
            {plan.movedOut.length > 0 && (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => setTab(4)}>
                    להחלטה
                  </Button>
                }
              >
                {plan.movedOut.length === 1 ? "עובד אחד מופיע" : `${plan.movedOut.length} עובדים מופיעים`} בקובץ במסגרת שלא נבחרה – כנראה עברו.
                הם נשארים פעילים, אלא אם תסמן אותם בלשונית &quot;עברו מסגרת&quot;.
              </Alert>
            )}
            {!mapping.serviceType && mapping.careerStartDate && (
              <Alert severity="info">
                סוג השירות נקבע לפי תאריך הכניסה לקבע: תאריך שעבר – קבע, תאריך עתידי – חובה עד שיגיע. בכל מחזור הסיווג נקבע מחדש לפי תאריך תחילת המחזור.
              </Alert>
            )}
            {!mapping.serviceType && !mapping.careerStartDate && (
              <Alert severity="warning">
                אין בקובץ עמודת סוג שירות או תאריך כניסה לקבע, ולכן סוג השירות נקבע לפי הדרגה: חובה 1–4 – חובה, כל השאר – קבע.
              </Alert>
            )}
            {!mapping.gaf && mapping.framework && (
              <Alert severity="info">המסגרת נלקחת מנתיב המסגרת (החלק שמתחיל ב"גף").</Alert>
            )}
            {plan.unknownRanks.length > 0 && (
              <Alert severity="error">
                דרגות שלא מוגדרות במערכת: {plan.unknownRanks.join(", ")}. יש להוסיף אותן בהגדרות לפני הטעינה, כי הדרגה קובעת זכאות.
              </Alert>
            )}
            {plan.unknownGafim.length > 0 && (
              <Alert severity="warning">מסגרות חדשות שייווצרו בטעינה: {plan.unknownGafim.join(", ")}</Alert>
            )}
            {plan.added.length > 0 && plan.added.length === parsed.rows.length && plan.unchanged + plan.updated.length === 0 && plan.removed.length > 0 && (
              <Alert severity="error">
                כל העובדים בקובץ מזוהים כחדשים, וכל הקיימים כחסרים. זה קורה בדרך כלל כשמפתח היחידה שגוי. מומלץ לבדוק לפני שממשיכים.
              </Alert>
            )}
            {changes.length > 0 && (
              <Alert severity="info">
                נמצאו {changes.length} שינויים אצל עובדים קיימים (בלשונית "שינויים לאישור"). רק שינוי שמסומן לאישור ייטען; שינוי שלא אושר
                לא דורס את הערך שבמערכת. מה שהוזן ידנית (שח"ר, תפקיד הקלה, דרגת מינוי, עקיפות) לא משתנה בטעינה בכל מקרה.
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}>
                  {fieldGroups.map(([field, keys]) => {
                    const all = keys.every((k) => approved.has(k));
                    return (
                      <Chip
                        key={field}
                        size="small"
                        color={all ? "primary" : "default"}
                        variant={all ? "filled" : "outlined"}
                        label={`${all ? "✓ " : ""}${RECORD_LABELS[field]} (${keys.length})`}
                        onClick={() => setMany(keys, !all)}
                      />
                    );
                  })}
                </Stack>
              </Alert>
            )}
            {plan.updated.some((u) => !u.before.is_active) && (
              <Alert severity="info">
                חוזרים לפעילות: {plan.updated.filter((u) => !u.before.is_active).map((u) => u.after.full_name).join(", ")}
              </Alert>
            )}
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable">
              <Tab label={`חדשים (${plan.added.length})`} />
              <Tab label={`שינויים לאישור (${changes.length})`} />
              <Tab label={`לא בקובץ (${plan.removed.length})`} />
              <Tab label={`שגיאות (${parsed.errors.length})`} />
              {plan.movedOut.length > 0 && <Tab label={`עברו מסגרת (${plan.movedOut.length})`} />}
            </Tabs>
            <Box sx={{ maxHeight: 420, overflow: "auto" }}>
              <Table size="small" stickyHeader>
                {tab === 0 && (
                  <>
                    <TableHead>
                      <TableRow>
                        {["שם", "סוג שירות", "מסגרת", "דרגה", "גיוס", "שחרור"].map((h) => <TableCell key={h}>{h}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {plan.added.map((s) => (
                        <TableRow key={s.soldier_key}>
                          <TableCell>{s.full_name}</TableCell>
                          <TableCell>{show(s.service_type)}</TableCell>
                          <TableCell>{s.gaf_name}</TableCell>
                          <TableCell>{s.rank_name}</TableCell>
                          <TableCell>{show(s.enlistment_date)}</TableCell>
                          <TableCell>{show(s.release_date)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
                {tab === 1 && (
                  <>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={changes.length > 0 && approvedCount === changes.length}
                            indeterminate={approvedCount > 0 && approvedCount < changes.length}
                            onChange={(e) => setApproved(new Set(e.target.checked ? changes.map((c) => c.key) : []))}
                            slotProps={{ input: { "aria-label": "אישור כל השינויים" } }}
                          />
                        </TableCell>
                        {["שם", "שדה", "במערכת", "בקובץ"].map((h) => <TableCell key={h}>{h}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {changes.map((c) => (
                        <TableRow key={c.key} hover selected={approved.has(c.key)} onClick={() => toggle([c.key])} sx={{ cursor: "pointer" }}>
                          <TableCell padding="checkbox">
                            <Checkbox checked={approved.has(c.key)} slotProps={{ input: { "aria-label": `אישור ${RECORD_LABELS[c.field]} – ${c.name}` } }} />
                          </TableCell>
                          <TableCell>{c.name}</TableCell>
                          <TableCell>{RECORD_LABELS[c.field]}</TableCell>
                          <TableCell sx={{ color: "text.secondary" }}>{c.before}</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{c.after}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
                {tab === 2 && (
                  <>
                    <TableHead>
                      <TableRow>
                        {["שם", "מסגרת", "דרגה"].map((h) => <TableCell key={h}>{h}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {plan.removed.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>{s.full_name}</TableCell>
                          <TableCell>{s.gaf_name}</TableCell>
                          <TableCell>{s.rank_name}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
                {tab === 4 && (
                  <>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={deactivate.size === plan.movedOut.length}
                            indeterminate={deactivate.size > 0 && deactivate.size < plan.movedOut.length}
                            onChange={() =>
                              setDeactivate(deactivate.size === plan.movedOut.length ? new Set() : new Set(plan.movedOut.map((m) => m.soldier.id)))
                            }
                            slotProps={{ input: { "aria-label": "סמן את כולם לא פעילים" } }}
                          />
                        </TableCell>
                        {["שם", "מסגרת עכשיו", "בקובץ", ""].map((h, i) => <TableCell key={i}>{h}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {plan.movedOut.map(({ soldier: m, to }) => {
                        const on = deactivate.has(m.id);
                        return (
                          <TableRow key={m.id}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={on}
                                onChange={() =>
                                  setDeactivate((cur) => {
                                    const next = new Set(cur);
                                    if (next.has(m.id)) next.delete(m.id);
                                    else next.add(m.id);
                                    return next;
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>{m.full_name}</TableCell>
                            <TableCell>{m.gaf_name}</TableCell>
                            <TableCell>{to}</TableCell>
                            <TableCell sx={{ color: on ? "warning.main" : "text.secondary" }}>{on ? "יסומן לא פעיל" : "נשאר פעיל"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </>
                )}
                {tab === 3 && (
                  <>
                    <TableHead>
                      <TableRow>
                        <TableCell>שורה</TableCell>
                        <TableCell>בעיה</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {parsed.errors.map((e) => (
                        <TableRow key={e.line}>
                          <TableCell>{e.line}</TableCell>
                          <TableCell>{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
              </Table>
            </Box>
            <Stack direction="row" spacing={1.5}>
              <Button variant="contained" onClick={apply} disabled={busy || plan.unknownRanks.length > 0}>
                אישור וטעינה
              </Button>
              <Button onClick={reset} disabled={busy}>
                ביטול
              </Button>
            </Stack>
            {busy && <LinearProgress />}
            {parsed.errors.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                שורות שגויות לא ייטענו. עובדים שמופיעים רק בשורות שגויות לא יסומנו כלא פעילים, אלא אם הם חסרים בקובץ.
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      {step === 4 && done && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Alert severity="success">
              הטעינה הושלמה: {done.added} חדשים, {done.updated} עודכנו, {done.deactivated} סומנו לא פעילים
              {done.gafimCreated ? `, ${done.gafimCreated} מסגרות חדשות` : ""}.
            </Alert>
            <NextStage />
            <Box>
              <Button onClick={reset}>טעינת קובץ נוסף</Button>
            </Box>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function RekeyPanel(props: {
  rows: RekeyRow[];
  existing: ExistingSoldier[];
  picks: Record<string, string>;
  setPicks: (p: Record<string, string>) => void;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { rows, existing, picks, setPicks } = props;
  const [only, setOnly] = useState<"check" | "all">("check");
  const twice = new Set(doublePicks(picks));
  const sure = rows.filter((r) => r.sure && picks[r.incoming.soldier_key] === r.candidates[0]?.id).length;
  const matched = Object.keys(picks).length;
  const picked = new Set(Object.values(picks));
  const left = existing.filter((s) => s.is_active && !picked.has(s.id));
  const shown = rows
    .filter((r) => only === "all" || !(r.sure && picks[r.incoming.soldier_key] === r.candidates[0]?.id))
    .sort((a, b) => b.candidates.length - a.candidates.length);
  const who = (s: ExistingSoldier) => [s.full_name, s.gaf_name, s.rank_name, s.enlistment_date ? show(s.enlistment_date) : ""].filter(Boolean).join(" · ");
  return (
    <Paper sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h2">התאמת עובדים למפתח החדש</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Chip color="success" label={`התאמה ודאית: ${sure}`} />
          <Chip color="warning" label={`לבדיקה: ${rows.length - sure}`} />
          <Chip color="info" label={`יותאמו: ${matched} מתוך ${rows.length}`} />
          <Chip label={`קיימים שלא הותאמו: ${left.length}`} />
        </Stack>
        <Alert severity="info">
          ודאי = שם יחיד בשני הצדדים, ורוב הפרטים (מסגרת, דרגה, מין, גיוס) זהים. בשורות לבדיקה בחר את העובד הקיים, או "עובד חדש" אם אין לו התאמה. שורה בלי
          התאמה תיטען כעובד חדש, ועובד קיים שלא הותאם יופיע בטעינה כ"לא בקובץ".
        </Alert>
        <Tabs value={only} onChange={(_, v) => setOnly(v)}>
          <Tab value="check" label={`לבדיקה (${rows.length - sure})`} />
          <Tab value="all" label={`הכל (${rows.length})`} />
        </Tabs>
        <Box sx={{ maxHeight: 460, overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {["בקובץ", "מסגרת · דרגה · גיוס", "עובד קיים במערכת"].map((h) => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => {
                const k = r.incoming.soldier_key;
                const v = picks[k] ?? "";
                return (
                  <TableRow key={k}>
                    <TableCell>
                      {r.incoming.full_name}
                      {r.sure && v === r.candidates[0]?.id && <Chip size="small" color="success" variant="outlined" label="ודאי" sx={{ mr: 1 }} />}
                    </TableCell>
                    <TableCell>{[r.incoming.gaf_name, r.incoming.rank_name, show(r.incoming.enlistment_date)].join(" · ")}</TableCell>
                    <TableCell sx={{ minWidth: 260 }}>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={v}
                        error={!!v && twice.has(v)}
                        helperText={v && twice.has(v) ? "נבחר כבר בשורה אחרת" : undefined}
                        onChange={(e) => {
                          const next = { ...picks };
                          if (e.target.value) next[k] = e.target.value;
                          else delete next[k];
                          setPicks(next);
                        }}
                        slotProps={{ select: { displayEmpty: true } }}
                      >
                        <MenuItem value="">עובד חדש (ללא התאמה)</MenuItem>
                        {r.candidates.map((c) => (
                          <MenuItem key={c.id} value={c.id}>
                            {who(c)}
                            {!c.is_active ? " (לא פעיל)" : ""}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                );
              })}
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3}>כל השורות הותאמו בוודאות.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
        {left.length > 0 && (
          <Alert severity="warning">
            {left.length} עובדים פעילים במערכת לא הותאמו: {left.slice(0, 12).map((s) => s.full_name).join(", ")}
            {left.length > 12 ? " ועוד" : ""}. הם ישארו עם המפתח הישן ויסומנו בטעינה כ"לא בקובץ".
          </Alert>
        )}
        <Alert severity="warning">אחרי האישור המפתח הישן מפסיק לעבוד. מיד אחר כך תוצג התצוגה המקדימה הרגילה של הטעינה.</Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="contained" onClick={props.onApprove} disabled={props.busy || twice.size > 0 || matched === 0}>
            אישור והחלפת מפתח
          </Button>
          <Button onClick={props.onCancel} disabled={props.busy}>
            חזרה
          </Button>
        </Stack>
        {props.busy && <LinearProgress />}
      </Stack>
    </Paper>
  );
}

const EARLY: CycleStatus[] = ["draft", "loading", "collecting", "approving", "potential", "slots"];

/** After a load: where the planning cycle goes next, as a plain button. */
function NextStage() {
  const { cycle } = useCycle();
  if (!cycle || !EARLY.includes(cycle.status)) {
    return (
      <Box>
        <Button variant="contained" component={RouterLink} to="/cycle">
          חזרה למחזור
        </Button>
      </Box>
    );
  }
  // the file is in: the next stage is at least the constraints collection
  const next: CycleStatus = cycle.status === "draft" || cycle.status === "loading" ? "collecting" : cycle.status;
  return (
    <Alert severity="info" icon={false}>
      <Stack spacing={1.5}>
        <Typography>
          השלב הבא במחזור <b>{cycle.name}</b>: <b>{stageLabel(next)}</b>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
          <Button variant="contained" endIcon={<NextIcon />} component={RouterLink} to={STAGE_SCREEN[next].staff}>
            לשלב הבא: {stageLabel(next)}
          </Button>
          <Button component={RouterLink} to="/cycle">
            לסקירת המחזור
          </Button>
        </Stack>
      </Stack>
    </Alert>
  );
}

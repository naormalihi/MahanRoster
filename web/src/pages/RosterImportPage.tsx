import DownloadIcon from "@mui/icons-material/DownloadOutlined";
import KeyIcon from "@mui/icons-material/KeyOutlined";
import UploadIcon from "@mui/icons-material/UploadFileOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
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
import * as XLSX from "xlsx";
import type { ApplyResult } from "../lib/api";
import { useAuth } from "../lib/auth";
import { soldierKey, unitKeyCheck, unitKeyProblems } from "../lib/hmac";
import {
  FIELDS,
  RECORD_LABELS,
  detectMapping,
  mappingProblems,
  parseRows,
  planImport,
  toRecord,
  type Mapping,
  type ParseResult,
  type RosterPlan,
} from "../lib/roster";

const SERVICE_LABEL = { mandatory: "חובה", career: "קבע" } as const;

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "כן";
  if (v === false) return "לא";
  if (v === "mandatory" || v === "career") return SERVICE_LABEL[v];
  if (v === "male") return "זכר";
  if (v === "female") return "נקבה";
  return String(v);
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    FIELDS.filter((f) => f.key !== "firstName" && f.key !== "lastName").map((f) => f.label),
    ["1234567", "ישראל ישראלי", "חובה", "גף מבצעים", "סמל", "זכר", "01/03/2025", "01/09/2027", "30/06/2027", "לא"],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "כוח אדם");
  XLSX.writeFile(wb, "תבנית-כוח-אדם.xlsx");
}

export function RosterImportPage() {
  const { api } = useAuth();
  const [step, setStep] = useState(0);
  const [unitKey, setUnitKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [plan, setPlan] = useState<RosterPlan | null>(null);
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ApplyResult | null>(null);

  // The unit key lives only in this component's memory: leaving the page forgets it.
  useEffect(() => () => setUnitKey(""), []);

  async function confirmKey() {
    const p = unitKeyProblems(unitKey);
    if (p) return setKeyError(p);
    const check = await unitKeyCheck(unitKey);
    const stored = await api!.unitKeyCheck();
    if (stored && stored !== check) {
      return setKeyError("המפתח לא תואם למפתח שבו נטענו החיילים בעבר. בדוק שהוקלד נכון.");
    }
    if (!stored) await api!.setUnitKeyCheck(check); // first import fixes the key
    setKeyError(null);
    setStep(1);
  }

  async function readFile(file: File) {
    setError(null);
    setFileName(file.name);
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
    const hdrs = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map(String);
    setHeaders(hdrs);
    setRecords(rows);
    setMapping(detectMapping(hdrs));
  }

  const mapProblems = useMemo(() => mappingProblems(mapping), [mapping]);

  async function buildPreview() {
    setBusy(true);
    setError(null);
    try {
      const result = parseRows(records, mapping);
      setParsed(result);
      const incoming = await Promise.all(result.rows.map(async (r) => toRecord(r, await soldierKey(unitKey, r.personalNumber))));
      const [existing, gafim, ranks] = await Promise.all([api!.soldiers(), api!.gafim(), api!.ranks()]);
      setPlan(planImport(incoming, existing, gafim.map((g) => g.name), ranks.map((r) => r.name)));
      setStep(2);
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
      setDone(await api!.applyRoster(plan));
      setStep(3);
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
      <Typography variant="h1">טעינת כוח אדם</Typography>
      <Stepper activeStep={step} alternativeLabel>
        {["מפתח יחידה", "קובץ ועמודות", "תצוגה מקדימה", "סיום"].map((l) => (
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
              המספרים האישיים לא יוצאים מהמחשב הזה. הדפדפן הופך כל מספר אישי למזהה מוצפן בעזרת מפתח היחידה, ורק המזהה נשלח לשרת.
              המפתח לא נשמר בשום מקום, וצריך להזין אותו מחדש בכל טעינה. אם המפתח יאבד, יהיה צורך לשייך את החיילים מחדש לפי שם ותאריך גיוס.
            </Typography>
            <TextField
              label="מפתח היחידה"
              type="password"
              value={unitKey}
              onChange={(e) => setUnitKey(e.target.value)}
              error={!!keyError}
              helperText={keyError ?? "לפחות 16 תווים. שמור עותק במקום בטוח מחוץ למערכת."}
              autoComplete="off"
              slotProps={{ htmlInput: { dir: "ltr" } }}
            />
            <Box>
              <Button variant="contained" onClick={confirmKey} disabled={!unitKey}>
                המשך
              </Button>
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
                  <Button variant="contained" onClick={buildPreview} disabled={busy || mapProblems.length > 0}>
                    תצוגה מקדימה
                  </Button>
                </Box>
                {busy && <LinearProgress />}
              </>
            )}
          </Stack>
        </Paper>
      )}

      {step === 2 && plan && parsed && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
              <Chip color="success" label={`חדשים: ${plan.added.length}`} />
              <Chip color="info" label={`עודכנו: ${plan.updated.length}`} />
              <Chip color="warning" label={`לא בקובץ (יסומנו לא פעילים): ${plan.removed.length}`} />
              <Chip label={`ללא שינוי: ${plan.unchanged}`} />
              {parsed.errors.length > 0 && <Chip color="error" label={`שורות שגויות: ${parsed.errors.length}`} />}
            </Stack>
            {plan.unknownRanks.length > 0 && (
              <Alert severity="error">
                דרגות שלא מוגדרות במערכת: {plan.unknownRanks.join(", ")}. יש להוסיף אותן בהגדרות לפני הטעינה, כי הדרגה קובעת זכאות.
              </Alert>
            )}
            {plan.unknownGafim.length > 0 && (
              <Alert severity="warning">גפים חדשים שייווצרו בטעינה: {plan.unknownGafim.join(", ")}</Alert>
            )}
            {plan.added.length > 0 && plan.added.length === parsed.rows.length && plan.unchanged + plan.updated.length === 0 && plan.removed.length > 0 && (
              <Alert severity="error">
                כל החיילים בקובץ מזוהים כחדשים, וכל הקיימים כחסרים. זה קורה בדרך כלל כשמפתח היחידה שגוי. מומלץ לבדוק לפני שממשיכים.
              </Alert>
            )}
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable">
              <Tab label={`חדשים (${plan.added.length})`} />
              <Tab label={`עודכנו (${plan.updated.length})`} />
              <Tab label={`לא בקובץ (${plan.removed.length})`} />
              <Tab label={`שגיאות (${parsed.errors.length})`} />
            </Tabs>
            <Box sx={{ maxHeight: 420, overflow: "auto" }}>
              <Table size="small" stickyHeader>
                {tab === 0 && (
                  <>
                    <TableHead>
                      <TableRow>
                        {["שם", "סוג שירות", "גף", "דרגה", "גיוס", "שחרור"].map((h) => <TableCell key={h}>{h}</TableCell>)}
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
                        <TableCell>שם</TableCell>
                        <TableCell>שינויים</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {plan.updated.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>{u.after.full_name}</TableCell>
                          <TableCell>
                            {!u.before.is_active && <Chip size="small" label="חוזר לפעילות" sx={{ ml: 1 }} />}
                            {u.changes.map((c) => `${RECORD_LABELS[c]}: ${show(u.before[c])} ← ${show(u.after[c])}`).join(" · ")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </>
                )}
                {tab === 2 && (
                  <>
                    <TableHead>
                      <TableRow>
                        {["שם", "גף", "דרגה"].map((h) => <TableCell key={h}>{h}</TableCell>)}
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
                שורות שגויות לא ייטענו. חיילים שמופיעים רק בשורות שגויות לא יסומנו כלא פעילים, אלא אם הם חסרים בקובץ.
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      {step === 3 && done && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Alert severity="success">
              הטעינה הושלמה: {done.added} חדשים, {done.updated} עודכנו, {done.deactivated} סומנו לא פעילים
              {done.gafimCreated ? `, ${done.gafimCreated} גפים חדשים` : ""}.
            </Alert>
            <Box>
              <Button onClick={reset}>טעינת קובץ נוסף</Button>
            </Box>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

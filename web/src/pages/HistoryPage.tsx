import CheckIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/DownloadOutlined";
import KeyIcon from "@mui/icons-material/KeyOutlined";
import UploadIcon from "@mui/icons-material/UploadFileOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import type { TaskType } from "../lib/catalog";
import type { Alias } from "../lib/baseSchedule";
import { soldierKey, unitKeyCheck, unitKeyProblems } from "../lib/hmac";
import {
  HISTORY_HEADERS,
  readHistory,
  resolveHistory,
  summarizeHistory,
  type HistoryDraft,
  type HistoryDuty,
  type HistoryImport,
  type LineError,
} from "../lib/history";
import type { ExistingSoldier } from "../lib/roster";
import { POOL_LABEL } from "../lib/schedule";

const dateFmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" });

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    HISTORY_HEADERS,
    ["1234567", "05/06/2026", "", "קצין תורן – חול", "", ""],
    ["7654321", "10/06/2026", "17/06/2026", "שמירות חובה", "", ""],
    ["2345678", "12/06/2026", "", "קצין תורן – שבת", "כן", ""],
  ]);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "היסטוריה");
  XLSX.writeFile(wb, "תבנית-היסטוריה.xlsx");
}

interface Refs {
  soldiers: ExistingSoldier[];
  tasks: TaskType[];
  aliases: Alias[];
  weekend: number[];
}

interface Preview {
  fileName: string;
  drafts: HistoryDraft[];
  errors: LineError[];
  unknownDuties: string[];
}

/** One import: per-soldier totals, the soldiers without history, approve or delete. */
function ImportReview({ imp, refs, onChanged }: { imp: HistoryImport; refs: Refs; onChanged: () => void }) {
  const { api } = useAuth();
  const [duties, setDuties] = useState<HistoryDuty[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api!.historyDuties(imp.id).then(setDuties).catch((e) => setError((e as Error).message));
  }, [api, imp.id]);

  const byId = useMemo(() => new Map(refs.soldiers.map((s) => [s.id, s])), [refs.soldiers]);
  const sums = useMemo(() => summarizeHistory(duties ?? []), [duties]);
  const means = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const s of sums) {
      const k = byId.get(s.soldier_id)?.service_type ?? "?";
      const [t, n] = m.get(k) ?? [0, 0];
      m.set(k, [t + s.points, n + 1]);
    }
    return new Map([...m].map(([k, [t, n]]) => [k, t / n]));
  }, [sums, byId]);
  const without = refs.soldiers.filter((s) => s.is_active && !sums.some((x) => x.soldier_id === s.id));
  const range = duties?.length ? [duties[0].starts_at, duties[duties.length - 1].starts_at] : null;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700 }}>{imp.file_name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {imp.rows} תורנויות · {sums.length} חיילים
              {range && ` · ${dateFmt.format(new Date(range[0]))} – ${dateFmt.format(new Date(range[1]))}`} · נטען {dateFmt.format(new Date(imp.created_at))}
            </Typography>
          </Box>
          {imp.approved_at ? (
            <Chip color="success" icon={<CheckIcon />} label={`אושר ${dateFmt.format(new Date(imp.approved_at))}`} />
          ) : (
            <Chip color="warning" label="ממתין לאישור – עדיין לא נספר בניקוד" />
          )}
          {!imp.approved_at && (
            <Button variant="contained" disabled={busy || !duties} onClick={() => act(() => api!.approveHistory(imp.id))}>
              אישור הייבוא
            </Button>
          )}
          <Button color="error" startIcon={<DeleteIcon />} disabled={busy} onClick={() => setConfirmDelete(true)}>
            מחיקה
          </Button>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {!duties && !error && <CircularProgress size={24} />}
        {duties && (
          <>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              {[...means].map(([k, m]) => (
                <Chip key={k} variant="outlined" label={`ממוצע ${POOL_LABEL[k] ?? k}: ${m.toFixed(1)}`} />
              ))}
            </Stack>
            {without.length > 0 && (
              <Alert severity="info">
                ל־{without.length} חיילים פעילים אין תורנויות בקובץ. בשיבוץ הבא הם יתחילו בממוצע של קבוצת ההוגנות שלהם (ולא באפס), כמו חייל חדש.
                {without.length <= 12 && ` (${without.map((s) => s.full_name).join(", ")})`}
              </Alert>
            )}
            <TableContainer sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {["חייל", "גף", "שירות", "תורנויות", "ניקוד מנורמל", "סופ״ש", "קנסות", "מול הממוצע"].map((h) => (
                      <TableCell key={h} sx={{ whiteSpace: "nowrap" }}>
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sums.map((s) => {
                    const sol = byId.get(s.soldier_id);
                    const mean = means.get(sol?.service_type ?? "?") ?? 0;
                    const diff = s.points - mean;
                    const far = mean > 0 && Math.abs(diff) > Math.max(5, mean * 0.5);
                    return (
                      <TableRow key={s.soldier_id} hover>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{sol?.full_name ?? "?"}</TableCell>
                        <TableCell>{sol?.gaf_name}</TableCell>
                        <TableCell>{POOL_LABEL[sol?.service_type ?? ""] ?? ""}</TableCell>
                        <TableCell>{s.duties}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{s.points.toFixed(1)}</TableCell>
                        <TableCell>{s.weekends}</TableCell>
                        <TableCell>{s.penalties || ""}</TableCell>
                        <TableCell sx={{ color: far ? (diff > 0 ? "error.main" : "info.main") : undefined, fontWeight: far ? 600 : undefined }}>
                          {diff > 0 ? "+" : ""}
                          {diff.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Stack>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>מחיקת הייבוא</DialogTitle>
        <DialogContent>
          {imp.approved_at
            ? "הייבוא כבר אושר. מחיקה תוריד את התורנויות שלו מהניקוד של המחזורים שעוד לא צולמו מחדש."
            : "התורנויות של הקובץ יימחקו. אפשר לטעון אותו שוב אחר כך."}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>ביטול</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setConfirmDelete(false);
              act(() => api!.deleteHistory(imp.id));
            }}
          >
            מחיקה
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export function HistoryPage() {
  const { api } = useAuth();
  const [unitKey, setUnitKey] = useState("");
  const [keyOk, setKeyOk] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [imports, setImports] = useState<HistoryImport[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the unit key lives only in this page's memory
  useEffect(() => () => setUnitKey(""), []);

  const loadImports = useCallback(() => {
    api!.historyImports().then(setImports).catch((e) => setError((e as Error).message));
  }, [api]);

  useEffect(() => {
    Promise.all([api!.soldiers(), api!.taskTypes(), api!.taskTypeAliases(), api!.scoringSettings()])
      .then(([soldiers, tasks, aliases, sc]) => setRefs({ soldiers, tasks, aliases, weekend: sc.weekend_weekdays }))
      .catch((e) => setError((e as Error).message));
    loadImports();
  }, [api, loadImports]);

  async function confirmKey() {
    const p = unitKeyProblems(unitKey);
    if (p) return setKeyError(p);
    const stored = await api!.unitKeyCheck();
    if (!stored) return setKeyError("עדיין לא נטען כוח אדם. קודם טוענים את קובץ כוח האדם, ואחריו את ההיסטוריה.");
    if (stored !== (await unitKeyCheck(unitKey))) return setKeyError("המפתח לא תואם למפתח שבו נטענו החיילים. בדוק שהוקלד נכון.");
    setKeyError(null);
    setKeyOk(true);
  }

  async function readFile(file: File) {
    if (!refs) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
      const parsed = readHistory(data);
      if (!parsed.header) throw new Error("לא נמצאה שורת כותרות עם מספר אישי, תאריך ותורנות. השתמש בתבנית.");
      const keyed = await Promise.all(parsed.rows.map(async (r) => ({ ...r, key: await soldierKey(unitKey, r.personalNumber) })));
      const days = parsed.rows.map((r) => r.start).sort();
      const cal = days.length ? await api!.calendarDays(days[0], days[days.length - 1]) : [];
      const holidays = new Set(cal.filter((d) => d.day_type === "holiday" || d.day_type === "holiday_eve").map((d) => d.day));
      const out = resolveHistory(keyed, {
        soldierByKey: new Map(refs.soldiers.map((s) => [s.soldier_key, s.id])),
        tasks: refs.tasks,
        aliases: refs.aliases,
        weekendIsoDays: refs.weekend,
        holidays,
      });
      setPreview({ fileName: file.name, drafts: out.drafts, errors: [...parsed.errors, ...out.errors].sort((a, b) => a.line - b.line), unknownDuties: out.unknownDuties });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await api!.importHistory(preview.fileName, preview.drafts);
      setPreview(null);
      loadImports();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h1">ייבוא היסטוריה</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760, mt: 0.5 }}>
          לפני השיבוץ הראשון טוענים את התורנויות של חצי השנה האחרונה, כדי שהניקוד ההתחלתי ישקף את העומס האמיתי. הניקוד מחושב לפי המשקלים
          והמכפילים שמוגדרים עכשיו. ייבוא נספר רק אחרי אישור, ונכנס לשיבוץ הבא (בחישוב הפוטנציאל או בהרצה). חייל בלי היסטוריה מתחיל בממוצע של
          הקבוצה שלו.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}

      <Paper sx={{ p: 2.5 }}>
        {!keyOk ? (
          <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <KeyIcon color="primary" />
              <Typography variant="h2">מפתח היחידה</Typography>
            </Stack>
            <Typography variant="body2">המספרים האישיים בקובץ מומרים בדפדפן למזהה המוצפן, כמו בטעינת כוח האדם. המפתח לא נשמר.</Typography>
            <TextField
              label="מפתח היחידה"
              type="password"
              value={unitKey}
              onChange={(e) => setUnitKey(e.target.value)}
              error={!!keyError}
              helperText={keyError ?? " "}
              autoComplete="off"
              slotProps={{ htmlInput: { dir: "ltr" } }}
            />
            <Stack direction="row" spacing={1.5}>
              <Button variant="contained" onClick={confirmKey} disabled={!unitKey}>
                המשך
              </Button>
              <Button startIcon={<DownloadIcon />} onClick={downloadTemplate}>
                הורדת תבנית
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
              <Button variant="contained" component="label" startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <UploadIcon />} disabled={busy || !refs}>
                בחירת קובץ היסטוריה
                <input hidden type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              </Button>
              <Button startIcon={<DownloadIcon />} onClick={downloadTemplate}>
                הורדת תבנית
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              עמודות: מספר אישי, תאריך, תאריך סיום (לתורנות של כמה ימים), תורנות (השם כמו בלוח הבסיס), עתודה שהוקפצה (כן), קנס (כן – בלי ניקוד).
              עתודה שלא הוקפצה לא נכנסת לקובץ.
            </Typography>
            {preview && (
              <Stack spacing={1.5}>
                <Alert severity={preview.drafts.length ? "success" : "warning"}>
                  {preview.fileName}: {preview.drafts.length} תורנויות מוכנות לטעינה
                  {preview.errors.length > 0 && `, ${preview.errors.length} שורות עם בעיה (לא ייטענו)`}.
                </Alert>
                {preview.unknownDuties.length > 0 && (
                  <Alert severity="warning">
                    תורנויות לא מוכרות: {preview.unknownDuties.join(", ")}. אפשר לשייך שמות כאלה לסוג תורנות בהגדרות ← "שמות מהבסיס", ואז לטעון את הקובץ
                    שוב.
                  </Alert>
                )}
                {preview.errors.length > 0 && (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 240 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>שורה</TableCell>
                          <TableCell>בעיה</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {preview.errors.map((e, i) => (
                          <TableRow key={i}>
                            <TableCell>{e.line}</TableCell>
                            <TableCell>{e.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
                <Stack direction="row" spacing={1.5}>
                  <Button variant="contained" onClick={upload} disabled={busy || !preview.drafts.length}>
                    טעינה לבדיקה
                  </Button>
                  <Button onClick={() => setPreview(null)}>ביטול</Button>
                </Stack>
              </Stack>
            )}
          </Stack>
        )}
      </Paper>

      <Typography variant="h2">ייבואים</Typography>
      {!imports || !refs ? (
        <CircularProgress />
      ) : imports.length === 0 ? (
        <Typography color="text.secondary">עדיין לא נטענה היסטוריה.</Typography>
      ) : (
        imports.map((imp) => <ImportReview key={imp.id} imp={imp} refs={refs} onChanged={loadImports} />)
      )}
    </Stack>
  );
}

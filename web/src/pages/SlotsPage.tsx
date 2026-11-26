import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import UploadIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Chip,
  CircularProgress,
  FormControlLabel,
  Link,
  List,
  ListItem,
  ListSubheader,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { NamedRef } from "../lib/api";
import { DutyNote } from "../components/DutyNote";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { EmptyState } from "../components/EmptyState";
import {
  buildSlots,
  readRows,
  type Alias,
  type BaseRow,
  BASE_TEMPLATE_HEADERS,
  type BuildResult,
  type RankRef,
  slotName,
  type SlotRow,
} from "../lib/baseSchedule";
import { HOLIDAY_TYPES, type TaskType } from "../lib/catalog";
import type { Cycle } from "../lib/cycles";
import { shortDayLabel, spanLabel, TZ } from "../lib/dates";
import { useNarrow } from "../components/CardList";
import { useLiveTick } from "../lib/live";

const fmtDay = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

const tsFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const dowFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "short" });
const span = (a: string, b: string) => `${shortDayLabel(a)}, ${spanLabel(a, b)}`;

function Loading() {
  return (
    <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

interface Refs {
  tasks: TaskType[];
  categories: NamedRef[];
  ranks: RankRef[];
  aliases: Alias[];
  weekend: number[];
  holidays: Set<string>;
}

const TaskDialog = lazy(() => import("./AdminPage").then((m) => ({ default: m.TaskDialog })));
/** A new catalog type, made from an unknown name in the file. */
const NEW = "__new__";

/** "לא לקלוט" in the duty mapping (an empty value means: not chosen yet). */
const SKIP = "__skip__";

function TaskSelect(props: { refs: Refs; value: string; onChange: (id: string) => void; label?: string; onNew?: () => void }) {
  const groups = props.refs.categories
    .map((c) => ({ c, tasks: props.refs.tasks.filter((t) => t.is_active && !t.is_special && t.category_id === c.id) }))
    .filter((g) => g.tasks.length);
  const loose = props.refs.tasks.filter((t) => t.is_active && !t.is_special && !props.refs.categories.some((c) => c.id === t.category_id));
  return (
    <TextField
      select
      size="small"
      label={props.label ?? "סוג משימה"}
      value={props.value}
      onChange={(e) => (e.target.value === NEW ? props.onNew?.() : props.onChange(e.target.value))}
      sx={{ minWidth: 220 }}
    >
      <MenuItem value={SKIP}>
        <em>לא לקלוט</em>
      </MenuItem>
      {props.onNew && (
        <MenuItem value={NEW} sx={{ color: "primary.main", fontWeight: 600 }}>
          + סוג משימה חדש בשם הזה
        </MenuItem>
      )}
      {!groups.length && !loose.length && (
        <MenuItem disabled sx={{ whiteSpace: "normal" }}>
          אין סוגי משימה פעילים בקטלוג
        </MenuItem>
      )}
      {/* a category heads its types only when it has more than one – a lone type is its own title */}
      {[...groups.filter((g) => g.tasks.length === 1).map((g) => g.tasks[0]), ...loose]
        .sort((a, b) => a.name.localeCompare(b.name, "he"))
        .map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.name}
          </MenuItem>
        ))}
      {groups
        .filter((g) => g.tasks.length > 1)
        .flatMap((g) => [
          <ListSubheader key={`h-${g.c.id}`}>{g.c.name}</ListSubheader>,
          ...g.tasks.map((t) => (
            <MenuItem key={t.id} value={t.id} sx={{ pl: 4 }}>
              {t.name}
            </MenuItem>
          )),
        ])}
    </TextField>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function ImportCard(props: {
  cycle: Cycle;
  refs: Refs;
  existing: SlotRow[];
  onDone: (msg: string) => void;
  onAliases: (a: Alias[]) => void;
  /** re-reads the catalog after a type was added here; returns the fresh list */
  onTasksChanged: () => Promise<TaskType[]>;
}) {
  const { api } = useAuth();
  const narrow = useNarrow();
  const { refs, cycle } = props;
  const [file, setFile] = useState<string>("");
  const [rows, setRows] = useState<BaseRow[] | null>(null);
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null); // an unknown name opened as a new type
  const [showOutside, setShowOutside] = useState(false);

  const result: BuildResult | null = useMemo(
    () => (rows ? buildSlots(rows, { aliases: refs.aliases, tasks: refs.tasks.filter((t) => !t.is_special), ranks: refs.ranks, weekendIsoDays: refs.weekend, cycle, holidays: refs.holidays }) : null),
    [rows, refs, cycle],
  );
  const taskName = new Map(refs.tasks.map((t) => [t.id, t.name]));
  const replaceable = props.existing.filter((s) => s.assigned === 0).length;
  const withNote = result?.slots.filter((s) => s.instructions).length ?? 0;

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([BASE_TEMPLATE_HEADERS]);
    ws["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "לוח משימות");
    XLSX.writeFile(wb, "תבנית לוח משימות.xlsx");
  }

  async function read(f: File) {
    setBusy(true);
    setMsg(null);
    setRows(null);
    setMapping({});
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer());
      const sheetName = wb.SheetNames.find((n) => readRows(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: "" })).header) ?? wb.SheetNames[0];
      const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      const r = readRows(data);
      if (!r.header) setMsg("לא מצאתי שורת כותרות עם העמודות \"מועד\" ו\"סוג משימה\".");
      else {
        setFile(f.name);
        setRows(r.rows);
        setErrors(r.errors);
      }
    } catch (e) {
      setMsg(`לא הצלחתי לקרוא את הקובץ: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  async function applyMapping() {
    const chosen = Object.entries(mapping)
      .filter(([, id]) => id && id !== SKIP)
      .map(([alias, task_type_id]) => ({ alias, task_type_id }));
    if (remember) await api!.saveTaskTypeAliases(chosen);
    props.onAliases(chosen);
  }

  async function doImport() {
    if (!result) return;
    setBusy(true);
    try {
      const r = await api!.importSlots(cycle.id, result.slots, replace && replaceable > 0, file);
      setRows(null);
      props.onDone(`נקלטו ${r.inserted} משבצות${r.deleted ? `, ${r.deleted} משבצות קודמות הוחלפו` : ""}.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  const unknownRankRows = result?.slots.filter((s) => s.unknownRanks.length) ?? [];
  const switched = result?.slots.filter((s) => s.weekendSwitched).length ?? 0;
  const holidayMismatch = result?.slots.filter((s) => s.holidayMismatch) ?? [];
  const popMismatch = result?.slots.filter((s) => s.populationMismatch) ?? [];
  const briefingIgnored = result?.slots.filter((s) => s.briefingIgnored) ?? [];
  // every unknown name has a choice; the preview opens once only skipped names are left
  const allMapped = result && result.unmapped.every((u) => !!mapping[u.duty]);
  const onlySkipped = result && result.unmapped.every((u) => mapping[u.duty] === SKIP);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      {creating !== null && (
        <Suspense fallback={null}>
          <TaskDialog
            task={null}
            initialName={creating}
            all={refs.tasks.filter((t) => !t.is_special)}
            categories={refs.categories}
            ranks={refs.ranks}
            onClose={() => setCreating(null)}
            onSaved={async () => {
              const name = creating;
              setCreating(null);
              const tasks = await props.onTasksChanged();
              // the new type matches the name by itself; keep it chosen if it was renamed
              const made = tasks.find((t) => t.name.trim() === name.trim());
              if (made) setMapping((m) => ({ ...m, [name]: made.id }));
            }}
          />
        </Suspense>
      )}
      <Stack spacing={2}>
        <Typography variant="h3">טעינת לוח משימות</Typography>
        <Typography variant="body2" color="text.secondary">
          בקובץ נדרשות שתי עמודות: <b>מועד</b> ו<b>סוג משימה</b>, ועמודת <b>הערה</b> אופציונלית – היא מוצגת על המשימה בלוח השיבוצים, ב&quot;המשימות שלי&quot; ובהודעות (עד 300 תווים,
          גלויה לכל מי שרואה את הלוח – בלי טלפונים). שורה = משבצת עם מבצע ועתודה. כל השאר נגזר: השעות מסוג המשימה (לפי יום בשבוע), גרסת השבת והחגים מהתאריך,
          ומי יכול לבצע מסוג המשימה. עמודות אחרות בקובץ לא נקראות. משבצת שייכת למחזור שבו היא מתחילה.
        </Typography>
        <Box>
          <Button variant="contained" component="label" startIcon={<UploadIcon />} disabled={busy}>
            בחירת קובץ
            <input
              hidden
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void read(f);
              }}
            />
          </Button>
          <Button sx={{ mr: 1 }} onClick={() => void downloadTemplate()}>
            תבנית ריקה
          </Button>
          {file && rows && (
            <Typography component="span" variant="body2" sx={{ mr: 2 }}>
              {file}
            </Typography>
          )}
        </Box>
        {busy && <CircularProgress size={24} />}
        {msg && <Alert severity="error">{msg}</Alert>}

        {result && result.unmapped.length > 0 && (
          <Alert severity="warning" icon={false}>
            <Stack spacing={1.5}>
              {!refs.tasks.some((t) => t.is_active && !t.is_special) && (
                <Alert severity="error">
                  בקטלוג אין סוגי משימה פעילים, ולכן אין למה להתאים. הוסף סוג מכל שם כאן (&quot;+ סוג משימה חדש&quot; ברשימה) או בהגדרות ← קטלוג.
                </Alert>
              )}
              <Typography>
                <b>{result.unmapped.length} שמות משימה לא מוכרים.</b> בחר לכל שם את סוג המשימה בקטלוג. שם ומשימת שבת של אותו סוג מזוהים אוטומטית לפי היום.
              </Typography>
              {result.unmapped.map((u) => (
                <Stack key={u.duty} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
                  <Box sx={{ minWidth: 220 }}>
                    <b>{u.duty}</b>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {u.count} שורות{u.population ? ` · ${u.population}` : ""}
                    </Typography>
                  </Box>
                  <TaskSelect
                    refs={refs}
                    value={mapping[u.duty] ?? ""}
                    onChange={(id) => setMapping({ ...mapping, [u.duty]: id })}
                    onNew={() => setCreating(u.duty)}
                  />
                </Stack>
              ))}
              <FormControlLabel control={<Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />} label="לזכור את ההתאמות לקבצים הבאים" />
              <Box>
                <Button variant="contained" onClick={applyMapping} disabled={!allMapped}>
                  המשך
                </Button>
                {!allMapped && (
                  <Typography variant="caption" sx={{ mr: 1 }}>
                    בחר סוג לכל שם, או "לא לקלוט"
                  </Typography>
                )}
              </Box>
            </Stack>
          </Alert>
        )}

        {result && onlySkipped && (
          <>
            <Alert severity={result.slots.length ? "info" : "warning"}>
              <b>{result.slots.length} משבצות ייקלטו</b> ל{cycle.name}.
              {result.outside.length > 0 && (
                <>
                  {" "}
                  <Link component="button" type="button" color="inherit" sx={{ verticalAlign: "baseline", font: "inherit" }}
                    onClick={() => setShowOutside((v) => !v)}>
                    {result.outside.length} שורות מתחילות מחוץ למחזור
                  </Link>{" "}
                  ולא ייקלטו.
                </>
              )}
              {switched > 0 && ` ${switched} משבצות שמתחילות בסוף שבוע הועברו לסוג המשימה של שבת.`}
              {result.unmapped.length > 0 && ` ${result.unmapped.reduce((n, u) => n + u.count, 0)} שורות של שמות שסומנו "לא לקלוט" דולגו.`}
              {showOutside && result.outside.length > 0 && (
                <List dense disablePadding sx={{ mt: 1 }}>
                  {result.outside.map((r) => (
                    <ListItem key={r.line} disableGutters sx={{ py: 0, display: "block" }}>
                      שורה {r.line}: {fmtDay(r.start)}{r.end && r.end !== r.start ? ` – ${fmtDay(r.end)}` : ""} · <b>{r.duty}</b>
                      {r.instructions ? (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {r.instructions}
                        </Typography>
                      ) : null}
                    </ListItem>
                  ))}
                </List>
              )}
            </Alert>
            {(errors.length > 0 || unknownRankRows.length > 0) && (
              <Alert severity="warning">
                {errors.length > 0 && <b>{errors.length} שורות לא תקינות לא ייקלטו:</b>}
                <List dense disablePadding>
                  {errors.slice(0, 20).map((e) => (
                    <ListItem key={e.line} disableGutters sx={{ py: 0 }}>
                      שורה {e.line}: {e.message}
                    </ListItem>
                  ))}
                </List>
                {unknownRankRows.length > 0 && (
                  <>
                    <b>דרגות לא מוכרות (המשבצת תיקלט עם שאר הדרגות):</b>
                    <List dense disablePadding>
                      {[...new Set(unknownRankRows.flatMap((s) => s.unknownRanks))].map((u) => (
                        <ListItem key={u} disableGutters sx={{ py: 0 }}>
                          "{u}" – {unknownRankRows.filter((s) => s.unknownRanks.includes(u)).map((s) => s.line).join(", ")}
                        </ListItem>
                      ))}
                    </List>
                  </>
                )}
              </Alert>
            )}
            {popMismatch.length > 0 && (
              <Alert severity="warning">
                <b>עמודת האוכלוסייה סותרת את סוג המשימה ב-{popMismatch.length} משבצות</b> (למשל "חובה" על סוג שמיועד לקבע). בדוק את ההתאמה:
                <List dense disablePadding>
                  {[...new Set(popMismatch.map((s) => `${s.duty} → ${taskName.get(s.task_type_id)}`))].map((t) => (
                    <ListItem key={t} disableGutters sx={{ py: 0 }}>
                      {t}
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}
            {briefingIgnored.length > 0 && (
              <Alert severity="info">
                ב-{briefingIgnored.length} משבצות כתוב תדריך ביום שרחוק יותר מ-3 ימים לפני ההתחלה (שורות{" "}
                {briefingIgnored.slice(0, 10).map((s) => s.line).join(", ")}), ולכן הוא לא נבדק. אם התאריכים בשורה שגויים, תקן אותם בקובץ.
              </Alert>
            )}
            {holidayMismatch.length > 0 && (
              <Alert severity="info">
                <b>עמודת "חג" בקובץ לא תואמת את לוח החגים ב-{holidayMismatch.length} משבצות.</b> תוספת החג נקבעת לפי לוח החגים (במסך הגדרות); אם הקובץ צודק,
                עדכן את לוח החגים.
                <List dense disablePadding>
                  {holidayMismatch.slice(0, 15).map((s) => (
                    <ListItem key={s.line} disableGutters sx={{ py: 0 }}>
                      שורה {s.line} ({s.duty}, {span(s.starts_at, s.ends_at)}):{" "}
                      {s.holidayMismatch === "file_only" ? "בקובץ – חג, בלוח החגים – לא" : "בלוח החגים – חג, בקובץ – לא"}
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary">
              {result.slots.length} משבצות{withNote > 0 ? ` · ${withNote} עם הערה` : ""}
            </Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {!narrow && <TableCell>שורה</TableCell>}
                    <TableCell>מועד</TableCell>
                    {!narrow && <TableCell>בקובץ</TableCell>}
                    <TableCell>סוג משימה</TableCell>
                    {!narrow && withNote > 0 && <TableCell>הערה</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.slots.map((s) => (
                    <TableRow key={s.line}>
                      {!narrow && <TableCell>{s.line}</TableCell>}
                      {narrow ? (
                        <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {shortDayLabel(s.starts_at)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {spanLabel(s.starts_at, s.ends_at)}
                          </Typography>
                        </TableCell>
                      ) : (
                        <TableCell sx={{ whiteSpace: "nowrap" }} dir="ltr">
                          {span(s.starts_at, s.ends_at)}
                        </TableCell>
                      )}
                      {!narrow && <TableCell>{s.duty}</TableCell>}
                      <TableCell sx={narrow ? { verticalAlign: "top" } : undefined}>
                        {narrow && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                            שורה {s.line} · בקובץ: {s.duty}
                          </Typography>
                        )}
                        {taskName.get(s.task_type_id)}
                        {s.weekendSwitched && <Chip size="small" label="שבת" sx={{ mr: 0.5 }} />}
                        {s.gender && <Chip size="small" label={s.gender === "male" ? "בנים" : "בנות"} sx={{ mr: 0.5 }} />}
                        {s.prefer_home_nightly && <Chip size="small" color="info" label="ת״ש 7" sx={{ mr: 0.5 }} />}
                  {s.daily_hours && <Chip size="small" variant="outlined" label={`כל יום ${s.daily_hours.replace("-", "–")}`} sx={{ mr: 0.5 }} />}
                  {s.briefing_at && <Chip size="small" variant="outlined" label={`תדריך ${dowFmt.format(new Date(s.briefing_at))} ${tsFmt.format(new Date(s.briefing_at))}`} sx={{ mr: 0.5 }} />}
                        {narrow && s.instructions && <DutyNote note={s.instructions} />}
                      </TableCell>
                      {!narrow && withNote > 0 && (
                        <TableCell sx={{ maxWidth: 280 }} title={s.instructions ?? undefined}>
                          <Typography variant="body2" noWrap>{s.instructions?.replace(/\n/g, " · ") ?? ""}</Typography>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {replaceable > 0 && (
              <FormControlLabel
                control={<Checkbox checked={replace} onChange={(e) => setReplace(e.target.checked)} />}
                label={`להחליף את ${replaceable} המשבצות שכבר קיימות במחזור ועוד לא שובצו (כולל הערות שנערכו ידנית)`}
              />
            )}
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={doImport} disabled={busy || !result.slots.length}>
                קליטה
              </Button>
              <Button onClick={() => setRows(null)}>ביטול</Button>
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Existing slots
// ---------------------------------------------------------------------------

function SlotList(props: { slots: SlotRow[]; refs: Refs; onDeleted: () => void; locked?: boolean }) {
  const { api } = useAuth();
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const taskName = new Map(props.refs.tasks.map((t) => [t.id, t.name]));
  const rankName = new Map(props.refs.ranks.map((r) => [r.id, r.name]));
  const shown = props.slots.filter((s) => !task || s.task_type_id === task);
  // a slot with a duty assigned in it can't be deleted from here
  const selectable = shown.filter((s) => s.assigned === 0);
  const allSelected = selectable.length > 0 && selectable.every((s) => selected.has(s.id));
  const someSelected = selectable.some((s) => selected.has(s.id));
  const toggleAll = () => {
    const n = new Set(selected);
    selectable.forEach((s) => (allSelected ? n.delete(s.id) : n.add(s.id)));
    setSelected(n);
  };
  const counts = new Map<string, number>();
  props.slots.forEach((s) => counts.set(s.task_type_id, (counts.get(s.task_type_id) ?? 0) + 1));

  async function del() {
    setBusy(true);
    try {
      await api!.deleteSlots([...selected]);
      setSelected(new Set());
      props.onDeleted();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!props.slots.length) return <EmptyState title="עוד אין משבצות במחזור" text="קולטים את קובץ לוח המשימות למעלה – ומכאן יוצאים לשיבוץ." />;
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <Chip label={`הכל (${props.slots.length})`} color={task ? "default" : "primary"} onClick={() => setTask("")} />
        {[...counts].map(([id, n]) => (
          <Chip key={id} label={`${props.refs.tasks.find((t) => t.id === id)?.is_special ? "הקפצה מיוחדת" : (taskName.get(id) ?? "?")} (${n})`} color={task === id ? "primary" : "default"} variant={task === id ? "filled" : "outlined"} onClick={() => setTask(id)} />
        ))}
      </Stack>
      {selected.size > 0 && !props.locked && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => setConfirming(true)}>
            מחיקת {selected.size} משבצות
          </Button>
          <Button color="inherit" onClick={() => setSelected(new Set())}>
            ניקוי הבחירה
          </Button>
        </Stack>
      )}
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "65vh" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {!props.locked && (
                <TableCell padding="checkbox">
                  <Tooltip title={allSelected ? "ניקוי הבחירה" : `בחירת כל ${selectable.length} המוצגות`}>
                    <span>
                      <Checkbox
                        size="small"
                        disabled={!selectable.length}
                        checked={allSelected}
                        indeterminate={!allSelected && someSelected}
                        onChange={toggleAll}
                        slotProps={{ input: { "aria-label": "בחירת הכל" } }}
                      />
                    </span>
                  </Tooltip>
                </TableCell>
              )}
              <TableCell>מועד</TableCell>
              <TableCell>משימה</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((s) => (
              <TableRow key={s.id} hover selected={selected.has(s.id)}>
                {!props.locked && <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    disabled={s.assigned > 0}
                    checked={selected.has(s.id)}
                    onChange={(e) => {
                      const n = new Set(selected);
                      if (e.target.checked) n.add(s.id);
                      else n.delete(s.id);
                      setSelected(n);
                    }}
                  />
                </TableCell>}
                <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{shortDayLabel(s.starts_at)}</Typography>
                  <Typography variant="caption" color="text.secondary">{spanLabel(s.starts_at, s.ends_at)}</Typography>
                </TableCell>
                <TableCell sx={{ verticalAlign: "top" }}>
                  <Typography variant="body2" component="span" sx={{ ml: 0.5 }}>{slotName(s, (id) => taskName.get(id))}</Typography>
                  {s.fixed_points != null && (
                    <Chip size="small" color="warning" variant="outlined" label={`הקפצה מיוחדת · ${Number(s.fixed_points)} נק׳`} sx={{ mr: 0.5 }} />
                  )}
                  {s.gender && <Chip size="small" label={s.gender === "male" ? "בנים" : "בנות"} sx={{ mr: 0.5 }} />}
                  {s.prefer_home_nightly && <Chip size="small" color="info" label="ת״ש 7" sx={{ mr: 0.5 }} />}
                  {s.allowed_rank_ids && <Chip size="small" variant="outlined" label={`רק ${s.allowed_rank_ids.map((id) => rankName.get(id)).join(", ")}`} sx={{ mr: 0.5 }} />}
                  {s.daily_hours && <Chip size="small" variant="outlined" label={`כל יום ${s.daily_hours.replace("-", "–")}`} sx={{ mr: 0.5 }} />}
                  {s.briefing_at && <Chip size="small" variant="outlined" label={`תדריך ${dowFmt.format(new Date(s.briefing_at))} ${tsFmt.format(new Date(s.briefing_at))}`} sx={{ mr: 0.5 }} />}
                  <DutyNote note={s.instructions} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={confirming} onClose={() => !busy && setConfirming(false)}>
        <DialogTitle>מחיקת {selected.size} משבצות</DialogTitle>
        <DialogContent>
          <Typography>המשבצות שנבחרו יימחקו מהמחזור. אפשר לקלוט אותן שוב מקובץ לוח המשימות.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            ביטול
          </Button>
          <Button color="error" variant="contained" onClick={del} disabled={busy}>
            מחיקה
          </Button>
        </DialogActions>
      </Dialog>
      <Typography variant="caption" color="text.secondary">
        ת״ש 7 = משבצת שהבסיס ייעד קודם לעובדים שלנים בבית; אם אין מהם זמין, ישובץ כל עובד זכאי. משבצת שכבר שובצה בה משימה אי אפשר למחוק מכאן.
      </Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------

export function SlotsPage() {
  const live = useLiveTick();
  const { api } = useAuth();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const { cycleId, locked } = useCycle();
  const [refs, setRefs] = useState<Refs | null>(null);
  const [slots, setSlots] = useState<SlotRow[] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const y = new Date().getFullYear();
    Promise.all([
      api!.cycles(),
      api!.taskTypes(),
      api!.dutyCategories(),
      api!.rankRefs(),
      api!.taskTypeAliases(),
      api!.scoringSettings(),
      api!.calendarDays(`${y - 1}-01-01`, `${y + 2}-12-31`),
    ])
      .then(([c, tasks, categories, ranks, aliases, sc, cal]) => {
        setCycles(c);
        const holidays = new Set(cal.filter((d) => HOLIDAY_TYPES.has(d.day_type)).map((d) => d.day));
        setRefs({ tasks, categories, ranks, aliases, weekend: sc.weekend_weekdays, holidays });
      })
      .catch((e) => setError((e as Error).message));
  }, [api, live]);

  const loadSlots = useCallback(async () => {
    if (!cycleId) return;
    try {
      setSlots(await api!.cycleSlots(cycleId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, cycleId]);
  useEffect(() => setSlots(null), [cycleId]); // another cycle: start empty
  useEffect(() => void loadSlots(), [loadSlots, live]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!cycles || !refs) return <Loading />;
  const cycle = cycles.find((c) => c.id === cycleId);

  return (
    <Stack spacing={2}>
      {!cycle ? (
        <Alert severity="info">צריך קודם ליצור מחזור בניהול המחזורים.</Alert>
      ) : (
        <>
          {done && (
            <Alert severity="success" onClose={() => setDone(null)}>
              {done}
            </Alert>
          )}
          {locked ? (
            <Alert severity="info">
              המחזור פורסם, ולכן אי אפשר לקלוט מחדש את לוח המשימות או למחוק משבצות. שינוי מהבסיס אחרי הפרסום ייקלט בתפעול השוטף, בשיבוץ במצב
              יציבות שמשנה רק את המשבצות שהשתנו.
            </Alert>
          ) : (
          <ImportCard
            key={cycle.id}
            cycle={cycle}
            refs={refs}
            existing={slots ?? []}
            onAliases={(a) => setRefs({ ...refs, aliases: [...refs.aliases.filter((x) => !a.some((y) => y.alias === x.alias)), ...a] })}
            onTasksChanged={async () => {
              const tasks = (await api!.taskTypes()).filter((x) => !x.is_special);
              setRefs((r) => (r ? { ...r, tasks } : r));
              return tasks;
            }}
            onDone={(m) => {
              setDone(m);
              void loadSlots();
            }}
          />
          )}
          <Typography variant="h2">משבצות במחזור</Typography>
          {slots ? <SlotList slots={slots} refs={refs} onDeleted={loadSlots} locked={locked} /> : <Loading />}
        </>
      )}
    </Stack>
  );
}

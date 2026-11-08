import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import UploadIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
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
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NamedRef } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import {
  buildSlots,
  readRows,
  type Alias,
  type BaseRow,
  type BuildResult,
  type RankRef,
  type SlotRow,
} from "../lib/baseSchedule";
import type { TaskType } from "../lib/catalog";
import type { Cycle } from "../lib/cycles";
import { TZ } from "../lib/dates";

const tsFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const dowFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "short" });
const span = (a: string, b: string) => `${dowFmt.format(new Date(a))} ${tsFmt.format(new Date(a))} – ${tsFmt.format(new Date(b))}`;

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

function TaskSelect(props: { refs: Refs; value: string; onChange: (id: string) => void; label?: string }) {
  const groups = props.refs.categories
    .map((c) => ({ c, tasks: props.refs.tasks.filter((t) => t.is_active && t.category_id === c.id) }))
    .filter((g) => g.tasks.length);
  const loose = props.refs.tasks.filter((t) => t.is_active && !props.refs.categories.some((c) => c.id === t.category_id));
  return (
    <TextField select size="small" label={props.label ?? "סוג תורנות"} value={props.value} onChange={(e) => props.onChange(e.target.value)} sx={{ minWidth: 220 }}>
      <MenuItem value="">
        <em>לא לקלוט</em>
      </MenuItem>
      {groups.flatMap((g) => [
        <ListSubheader key={`h-${g.c.id}`}>{g.c.name}</ListSubheader>,
        ...g.tasks.map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.name}
          </MenuItem>
        )),
      ])}
      {loose.map((t) => (
        <MenuItem key={t.id} value={t.id}>
          {t.name}
        </MenuItem>
      ))}
    </TextField>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function ImportCard(props: { cycle: Cycle; refs: Refs; existing: SlotRow[]; onDone: (msg: string) => void; onAliases: (a: Alias[]) => void }) {
  const { api } = useAuth();
  const { refs, cycle } = props;
  const [file, setFile] = useState<string>("");
  const [rows, setRows] = useState<BaseRow[] | null>(null);
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const result: BuildResult | null = useMemo(
    () => (rows ? buildSlots(rows, { aliases: refs.aliases, tasks: refs.tasks, ranks: refs.ranks, weekendIsoDays: refs.weekend, cycle, holidays: refs.holidays }) : null),
    [rows, refs, cycle],
  );
  const taskName = new Map(refs.tasks.map((t) => [t.id, t.name]));
  const rankName = new Map(refs.ranks.map((r) => [r.id, r.name]));
  const replaceable = props.existing.filter((s) => s.assigned === 0).length;

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
      if (!r.header) setMsg("לא מצאתי שורת כותרות עם העמודות \"תורנות\" ו\"תאריך התחלה\".");
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
      .filter(([, id]) => id)
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
  const allMapped = result && result.unmapped.every((u) => mapping[u.duty] !== undefined);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h3">קליטת קובץ המשבצות מהבסיס</Typography>
        <Typography variant="body2" color="text.secondary">
          שורה בקובץ = משבצת עם מבצע ועתודה. עמודות המבצע, העתודה והגף לא נקראות; הצבעים לא נקראים; החגים לפי לוח השנה. שעות לפי ברירת המחדל של כל
          סוג תורנות. משבצת שייכת למחזור שבו היא מתחילה.
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
              <Typography>
                <b>{result.unmapped.length} שמות תורנות לא מוכרים.</b> בחר לכל שם את סוג התורנות בקטלוג. שם ותורנות שבת של אותו סוג מזוהים אוטומטית לפי היום.
              </Typography>
              {result.unmapped.map((u) => (
                <Stack key={u.duty} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
                  <Box sx={{ minWidth: 220 }}>
                    <b>{u.duty}</b>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {u.count} שורות{u.population ? ` · ${u.population}` : ""}
                    </Typography>
                  </Box>
                  <TaskSelect refs={refs} value={mapping[u.duty] ?? ""} onChange={(id) => setMapping({ ...mapping, [u.duty]: id })} />
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

        {result && result.unmapped.every((u) => mapping[u.duty] !== undefined) && (
          <>
            <Alert severity={result.slots.length ? "info" : "warning"}>
              <b>{result.slots.length} משבצות ייקלטו</b> ל{cycle.name}.
              {result.outside.length > 0 && ` ${result.outside.length} שורות מתחילות מחוץ למחזור ולא ייקלטו.`}
              {switched > 0 && ` ${switched} משבצות שמתחילות בסוף שבוע הועברו לסוג התורנות של שבת.`}
              {result.unmapped.some((u) => !mapping[u.duty]) && " שמות שסומנו \"לא לקלוט\" דולגו."}
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
                <b>עמודת האוכלוסייה סותרת את סוג התורנות ב-{popMismatch.length} משבצות</b> (למשל "חובה" על סוג שמיועד לקבע). בדוק את ההתאמה:
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
                <b>עמודת "חג" בקובץ לא תואמת את לוח החגים ב-{holidayMismatch.length} משבצות.</b> מקדם החג נקבע לפי לוח החגים (במסך הגדרות); אם הקובץ צודק,
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
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>שורה</TableCell>
                    <TableCell>מועד</TableCell>
                    <TableCell>בקובץ</TableCell>
                    <TableCell>סוג תורנות</TableCell>
                    <TableCell>דרגות</TableCell>
                    <TableCell>הנחיות</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.slots.map((s) => (
                    <TableRow key={s.line}>
                      <TableCell>{s.line}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }} dir="ltr">
                        {span(s.starts_at, s.ends_at)}
                      </TableCell>
                      <TableCell>{s.duty}</TableCell>
                      <TableCell>
                        {taskName.get(s.task_type_id)}
                        {s.weekendSwitched && <Chip size="small" label="שבת" sx={{ mr: 0.5 }} />}
                        {s.gender && <Chip size="small" label={s.gender === "male" ? "בנים" : "בנות"} sx={{ mr: 0.5 }} />}
                        {s.prefer_home_nightly && <Chip size="small" color="info" label="ת״ש 7" sx={{ mr: 0.5 }} />}
                        {s.daily_hours && <Chip size="small" variant="outlined" label={`כל יום ${s.daily_hours.replace("-", "–")}`} sx={{ mr: 0.5 }} />}
                        {s.briefing_at && <Chip size="small" variant="outlined" label={`תדריך ${dowFmt.format(new Date(s.briefing_at))} ${tsFmt.format(new Date(s.briefing_at))}`} sx={{ mr: 0.5 }} />}
                      </TableCell>
                      <TableCell title={s.ranksText}>
                        {s.allowed_rank_ids ? s.allowed_rank_ids.map((id) => rankName.get(id)).join(", ") : "לפי סוג התורנות"}
                        {s.unknownRanks.length > 0 && <Chip size="small" color="warning" label="?" sx={{ mr: 0.5 }} />}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.instructions ?? ""}>
                        {s.instructions}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {replaceable > 0 && (
              <FormControlLabel
                control={<Checkbox checked={replace} onChange={(e) => setReplace(e.target.checked)} />}
                label={`להחליף את ${replaceable} המשבצות שכבר קיימות במחזור ועוד לא שובצו`}
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
  const taskName = new Map(props.refs.tasks.map((t) => [t.id, t.name]));
  const rankName = new Map(props.refs.ranks.map((r) => [r.id, r.name]));
  const shown = props.slots.filter((s) => !task || s.task_type_id === task);
  const counts = new Map<string, number>();
  props.slots.forEach((s) => counts.set(s.task_type_id, (counts.get(s.task_type_id) ?? 0) + 1));

  async function del() {
    await api!.deleteSlots([...selected]);
    setSelected(new Set());
    props.onDeleted();
  }

  if (!props.slots.length) return <Alert severity="info">אין עדיין משבצות במחזור הזה.</Alert>;
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <Chip label={`הכל (${props.slots.length})`} color={task ? "default" : "primary"} onClick={() => setTask("")} />
        {[...counts].map(([id, n]) => (
          <Chip key={id} label={`${taskName.get(id) ?? "?"} (${n})`} color={task === id ? "primary" : "default"} variant={task === id ? "filled" : "outlined"} onClick={() => setTask(id)} />
        ))}
      </Stack>
      {selected.size > 0 && !props.locked && (
        <Box>
          <Button color="error" startIcon={<DeleteIcon />} onClick={del}>
            מחיקת {selected.size} משבצות
          </Button>
        </Box>
      )}
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "65vh" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>מועד</TableCell>
              <TableCell>תורנות</TableCell>
              <TableCell>מבצע/עתודה</TableCell>
              <TableCell>דרגות</TableCell>
              <TableCell>הנחיות</TableCell>
              <TableCell>הערות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((s) => (
              <TableRow key={s.id} hover selected={selected.has(s.id)}>
                <TableCell padding="checkbox">
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
                </TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }} dir="ltr">
                  {span(s.starts_at, s.ends_at)}
                </TableCell>
                <TableCell>
                  {taskName.get(s.task_type_id)}
                  {s.gender && <Chip size="small" label={s.gender === "male" ? "בנים" : "בנות"} sx={{ mr: 0.5 }} />}
                  {s.prefer_home_nightly && <Chip size="small" color="info" label="ת״ש 7" sx={{ mr: 0.5 }} />}
                        {s.daily_hours && <Chip size="small" variant="outlined" label={`כל יום ${s.daily_hours.replace("-", "–")}`} sx={{ mr: 0.5 }} />}
                        {s.briefing_at && <Chip size="small" variant="outlined" label={`תדריך ${dowFmt.format(new Date(s.briefing_at))} ${tsFmt.format(new Date(s.briefing_at))}`} sx={{ mr: 0.5 }} />}
                </TableCell>
                <TableCell>
                  {s.performers_needed}/{s.reserves_needed}
                </TableCell>
                <TableCell>{s.allowed_rank_ids ? s.allowed_rank_ids.map((id) => rankName.get(id)).join(", ") : "לפי הסוג"}</TableCell>
                <TableCell sx={{ maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.instructions ?? ""}>
                  {s.instructions}
                </TableCell>
                <TableCell sx={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.notes ?? ""}>
                  {s.notes}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">
        ת״ש 7 = משבצת שהבסיס ייעד קודם לחיילים שלנים בבית; אם אין מהם זמין, ישובץ כל חייל זכאי. ההערות (אנשי קשר וטלפונים) נשמרות למשבצת ולא מוצגות בלוח המפורסם. משבצת שכבר שובצה בה תורנות אי אפשר למחוק מכאן.
      </Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------

export function SlotsPage() {
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
        const holidays = new Set(cal.filter((d) => d.day_type === "holiday" || d.day_type === "holiday_eve").map((d) => d.day));
        setRefs({ tasks, categories, ranks, aliases, weekend: sc.weekend_weekdays, holidays });
      })
      .catch((e) => setError((e as Error).message));
  }, [api]);

  const loadSlots = useCallback(async () => {
    if (!cycleId) return;
    setSlots(null);
    try {
      setSlots(await api!.cycleSlots(cycleId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, cycleId]);
  useEffect(() => void loadSlots(), [loadSlots]);

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
              המחזור פורסם, ולכן אי אפשר לקלוט מחדש את לוח הבסיס או למחוק משבצות. שינוי מהבסיס אחרי הפרסום ייקלט בתפעול השוטף, בשיבוץ במצב
              יציבות שמשנה רק את המשבצות שהשתנו.
            </Alert>
          ) : (
          <ImportCard
            key={cycle.id}
            cycle={cycle}
            refs={refs}
            existing={slots ?? []}
            onAliases={(a) => setRefs({ ...refs, aliases: [...refs.aliases.filter((x) => !a.some((y) => y.alias === x.alias)), ...a] })}
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

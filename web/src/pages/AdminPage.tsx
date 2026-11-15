import AddIcon from "@mui/icons-material/Add";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { NamedRef } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { LoadRoleRef } from "../lib/soldiers";
import { UsersTab } from "./UsersTab";
import {
  DAY_TYPE_LABEL,
  ISO_DAY_LABEL,
  SERVICE_LABEL,
  israeliHolidays,
  mergeHolidays,
  newTaskCode,
  rankListLabel,
  scoringProblems,
  taskTypeProblems,
  EMPTY_MULTIPLIER,
  ISO_WEEK,
  MARKABLE,
  describeMultiplier,
  multiplierProblems,
  HOLIDAYS,
  HOLIDAY_KINDS,
  HOLIDAY_KIND_NAME,
  HOLIDAY_NAME,
  holidayPhrase,
  calendarMatch,
  calendarOnly,
  type HolidayKey,
  type HolidayKind,
  type CalendarDay,
  type DayTypeRef,
  type ScoreMultiplier,
  type ScoreMultiplierInput,
  type ScoringSettings,
  type ServiceRestriction,
  type TaskType,
  type TaskTypeInput,
} from "../lib/catalog";

const fmt = (iso: string) => iso.split("-").reverse().join("/");
const HEB_WEEKDAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const weekdayOf = (iso: string) => HEB_WEEKDAY[new Date(iso + "T12:00:00Z").getUTCDay()];

function Loading() {
  return (
    <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Duty catalog
// ---------------------------------------------------------------------------

const EMPTY_TASK: TaskTypeInput = {
  code: "",
  name: "",
  category_id: null,
  weight: 1,
  min_rest_hours: 0,
  service_restriction: "any",
  requires_weapon: false,
  is_weekend_type: false,
  includes_holidays: false,
  shachar_compatible: false,
  shachar_only: false,
  tash_rule: "auto",
  qualifying_duty: false,
  allowed_rank_ids: null,
  gender: null,
  default_start_time: "08:00",
  default_end_time: "08:00",
  weekday_hours: null,
  color: "#3b6ea8",
  is_active: true,
};

const WEEKDAY_KEYS: { key: string; label: string }[] = [
  { key: "0", label: "ראשון" },
  { key: "1", label: "שני" },
  { key: "2", label: "שלישי" },
  { key: "3", label: "רביעי" },
  { key: "4", label: "חמישי" },
  { key: "5", label: "שישי" },
  { key: "6", label: "שבת" },
  { key: "after_holiday", label: "אחרי חג" },
];

/** Optional hours per start weekday, e.g. מפקד תורן: Sunday 06:00 → 08:00 next day, Thursday 08:00 → 18:00. */
function WeekdayHours(props: { value: Record<string, string> | null; onChange: (v: Record<string, string> | null) => void }) {
  const on = !!props.value;
  const setDay = (k: string, w: string) => {
    const next = { ...(props.value ?? {}) };
    if (w.trim()) next[k] = w.trim();
    else delete next[k];
    props.onChange(Object.keys(next).length ? next : {});
  };
  return (
    <Box>
      <FormControlLabel
        control={<Switch checked={on} onChange={(e) => props.onChange(e.target.checked ? {} : null)} />}
        label="שעות שונות לפי יום בשבוע"
      />
      {on && (
        <>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            לפי היום שבו התורנות מתחילה. תבנית 08:00-18:00; סיום למחרת: 06:00-08:00+1 (או כשהסיום לא אחרי ההתחלה, כמו 08:00-08:00). ריק = שעות ברירת
            המחדל. "אחרי חג" גובר ביום שאחרי חג.
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" }, gap: 1 }}>
            {WEEKDAY_KEYS.map((d) => (
              <TextField
                key={d.key}
                size="small"
                label={d.label}
                value={props.value?.[d.key] ?? ""}
                onChange={(e) => setDay(d.key, e.target.value)}
                placeholder="08:00-08:00"
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: "ltr" } }}
              />
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

export function TaskDialog(props: {
  task: TaskType | null;
  /** a new type's name to start from (e.g. an unknown name in the base's file) */
  initialName?: string;
  all: TaskType[];
  categories: NamedRef[];
  ranks: NamedRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAuth();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [t, setT] = useState<TaskTypeInput>(() => {
    if (!props.task) return { ...EMPTY_TASK, name: props.initialName ?? EMPTY_TASK.name };
    const { id: _id, ...rest } = props.task;
    return rest;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TaskTypeInput>(k: K, v: TaskTypeInput[K]) => setT((x) => ({ ...x, [k]: v }));
  const problems = taskTypeProblems(t, props.all, props.task?.id);
  const weightChanged = props.task && props.task.weight !== t.weight;

  const [confirmDelete, setConfirmDelete] = useState(false);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api!.deleteTaskType(props.task!.id);
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  async function save() {
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    setError(null);
    try {
      await api!.saveTaskType(props.task?.id ?? null, { ...t, name: t.name.trim(), code: t.code || newTaskCode() });
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const ALL = "__all__";
  const rankPicker = (
    <TextField
      select
      label="דרגות"
      value={t.allowed_rank_ids ?? [ALL]}
      onChange={(e) => {
        const v = e.target.value as unknown as string[];
        // "כל הדרגות" picked last clears the list; picking a rank drops it
        set("allowed_rank_ids", v[v.length - 1] === ALL || !v.length ? null : v.filter((x) => x !== ALL));
      }}
      fullWidth
      helperText="אפשר לבחור כמה. בלי בחירה – כל הדרגות"
      slotProps={{
        select: {
          multiple: true,
          renderValue: (v) => ((v as string[]).includes(ALL) ? "כל הדרגות" : rankListLabel(v as string[], props.ranks)),
        },
      }}
    >
      <MenuItem value={ALL}>
        <Checkbox size="small" checked={!t.allowed_rank_ids} sx={{ p: 0.5, ml: 1 }} />
        כל הדרגות
      </MenuItem>
      {props.ranks.map((r) => (
        <MenuItem key={r.id} value={r.id}>
          <Checkbox size="small" checked={!!t.allowed_rank_ids?.includes(r.id)} sx={{ p: 0.5, ml: 1 }} />
          {r.name}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Dialog open onClose={props.onClose} fullScreen={fullScreen} maxWidth="md" fullWidth>
      <DialogTitle>{props.task ? `עריכת תורנות – ${props.task.name}` : "תורנות חדשה"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="שם" value={t.name} onChange={(e) => set("name", e.target.value)} fullWidth autoFocus />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="קטגוריה" value={t.category_id ?? ""} onChange={(e) => set("category_id", e.target.value || null)} fullWidth slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
              <MenuItem value="">ללא</MenuItem>
              {props.categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="number"
              label="משקל"
              value={t.weight}
              onChange={(e) => set("weight", Number(e.target.value))}
              slotProps={{ htmlInput: { step: 0.25, min: 0.25, max: 99 } }}
              helperText={weightChanged ? "חל על שיבוצים חדשים בלבד. ניקוד שכבר נצבר לא משתנה" : "נקודות ליחידת 24 שעות"}
              fullWidth
            />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              type="time"
              label="שעת התחלה"
              value={t.default_start_time ?? ""}
              onChange={(e) => set("default_start_time", e.target.value || null)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              type="time"
              label="שעת סיום"
              value={t.default_end_time ?? ""}
              onChange={(e) => set("default_end_time", e.target.value || null)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              type="color"
              label="צבע בלוח"
              value={t.color ?? "#3b6ea8"}
              onChange={(e) => set("color", e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>
          <WeekdayHours value={t.weekday_hours} onChange={(v) => set("weekday_hours", v)} />

          <Typography variant="subtitle2" sx={{ pt: 1 }}>
            מי יכול לבצע
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              select
              label="סוג שירות"
              value={t.service_restriction}
              onChange={(e) => set("service_restriction", e.target.value as ServiceRestriction)}
              fullWidth
            >
              {(Object.keys(SERVICE_LABEL) as ServiceRestriction[]).map((k) => (
                <MenuItem key={k} value={k}>
                  {SERVICE_LABEL[k]}
                </MenuItem>
              ))}
            </TextField>
            {rankPicker}
            <TextField
              select
              label="מגדר"
              value={t.gender ?? ""}
              onChange={(e) => set("gender", (e.target.value || null) as TaskTypeInput["gender"])}
              fullWidth
              slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
            >
              <MenuItem value="">כולם</MenuItem>
              <MenuItem value="male">גברים</MenuItem>
              <MenuItem value="female">נשים</MenuItem>
            </TextField>
            <TextField
              select
              label='שח"ר'
              value={t.shachar_only ? "only" : t.shachar_compatible ? "also" : "no"}
              onChange={(e) => {
                const v = e.target.value;
                set("shachar_compatible", v !== "no");
                set("shachar_only", v === "only");
              }}
              fullWidth
            >
              <MenuItem value="no">לא לשח"ר</MenuItem>
              <MenuItem value="also">גם לשח"ר</MenuItem>
              <MenuItem value="only">רק לשח"ר</MenuItem>
            </TextField>
            <TextField
              select
              label='ת"ש'
              value={t.tash_rule}
              onChange={(e) => set("tash_rule", e.target.value as TaskType["tash_rule"])}
              fullWidth
            >
              <MenuItem value="auto">לפי שעות לילה</MenuItem>
              <MenuItem value="home">מתאימה לת"ש</MenuItem>
              <MenuItem value="closed">לא מתאימה לת"ש</MenuItem>
            </TextField>
          </Stack>
          <FormGroup>
            <FormControlLabel
              control={<Switch checked={t.requires_weapon} onChange={(e) => set("requires_weapon", e.target.checked)} />}
              label="דורשת נשק (ומטווח בתוקף)"
            />
            <FormControlLabel
              control={<Switch checked={t.is_weekend_type} onChange={(e) => set("is_weekend_type", e.target.checked)} />}
              label="תורנות שבת (המשקל כבר כולל את סוף השבוע, בלי מקדם נוסף)"
            />
            <FormControlLabel
              control={<Switch checked={t.includes_holidays} onChange={(e) => set("includes_holidays", e.target.checked)} />}
              label={
                <span>
                  המשקל כבר כולל חגים (בלי מקדם חג)
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    מקדמי לוח החגים לא חלים עליה. החג עדיין נחשב לה כ"תורנות חג".
                  </Typography>
                </span>
              }
            />
            <FormControlLabel
              control={<Switch checked={t.qualifying_duty} onChange={(e) => set("qualifying_duty", e.target.checked)} />}
              label="תורנות מזכה (פתוחה גם למשרתי הורה ולבעלי פטור מזכה)"
            />
            <FormControlLabel
              control={<Switch checked={t.is_active} onChange={(e) => set("is_active", e.target.checked)} />}
              label="פעילה (תורנות לא פעילה לא תשובץ)"
            />
          </FormGroup>
        </Stack>
      </DialogContent>
      {/* outside the scrolling content, so a refusal (e.g. a duty in use) is always seen */}
      {error && (
        <Alert severity="error" sx={{ mx: 2, mt: 1.5 }}>
          {error}
        </Alert>
      )}
      <DialogActions>
        {props.task &&
          (confirmDelete ? (
            <>
              <Box sx={{ flex: 1, color: "error.main", fontSize: 14, px: 1 }}>למחוק את "{props.task.name}" לצמיתות?</Box>
              <Button color="error" variant="contained" onClick={remove} disabled={busy}>
                מחיקה
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>לא</Button>
            </>
          ) : (
            <Button color="error" onClick={() => setConfirmDelete(true)} disabled={busy} sx={{ mr: "auto" }}>
              מחיקת התורנות
            </Button>
          ))}
        {!confirmDelete && (
          <>
            <Button onClick={props.onClose}>ביטול</Button>
            <Button variant="contained" onClick={save} disabled={busy}>
              שמירה
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function CatalogTab() {
  const { api } = useAuth();
  const [tasks, setTasks] = useState<TaskType[] | null>(null);
  const [categories, setCategories] = useState<NamedRef[]>([]);
  const [ranks, setRanks] = useState<NamedRef[]>([]);
  const [editing, setEditing] = useState<TaskType | "new" | null>(null);
  const [editCats, setEditCats] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c, r] = await Promise.all([api!.taskTypes(), api!.dutyCategories(), api!.ranks()]);
      setTasks(t);
      setCategories(c);
      setRanks(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!tasks) return <Loading />;
  const shown = tasks
    .filter((t) => showInactive || t.is_active)
    .sort((a, b) => (catName.get(a.category_id ?? "") ?? "").localeCompare(catName.get(b.category_id ?? "") ?? "", "he") || a.name.localeCompare(b.name, "he"));
  const inactive = tasks.filter((t) => !t.is_active).length;

  const who = (t: TaskType) => {
    const parts: string[] = [];
    if (t.service_restriction !== "any") parts.push(SERVICE_LABEL[t.service_restriction]);
    if (t.allowed_rank_ids) parts.push(rankListLabel(t.allowed_rank_ids, ranks));
    if (t.gender) parts.push(t.gender === "male" ? "גברים" : "נשים");
    return parts.join(" · ") || "כולם";
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
          תורנות חדשה
        </Button>
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditCats(true)}>
          קטגוריות
        </Button>
        {inactive > 0 && (
          <FormControlLabel
            control={<Switch checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />}
            label={`הצג לא פעילות (${inactive})`}
          />
        )}
      </Stack>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>תורנות</TableCell>
              <TableCell>קטגוריה</TableCell>
              <TableCell>משקל</TableCell>
              <TableCell>שעות</TableCell>
              <TableCell>מי מבצע</TableCell>
              <TableCell>סימונים</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((t) => (
              <TableRow key={t.id} hover onClick={() => setEditing(t)} sx={{ opacity: t.is_active ? 1 : 0.5, cursor: "pointer" }}>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: t.color ?? "grey.400", flexShrink: 0 }} />
                    <span>{t.name}</span>
                  </Stack>
                </TableCell>
                <TableCell>{catName.get(t.category_id ?? "") ?? "—"}</TableCell>
                <TableCell>{t.weight}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }} dir="ltr">
                  {t.weekday_hours && Object.keys(t.weekday_hours).length ? "לפי יום" : t.default_start_time ? `${t.default_start_time}–${t.default_end_time}` : "—"}
                </TableCell>
                <TableCell>{who(t)}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                    {t.is_weekend_type && <Chip size="small" label="שבת" />}
                    {t.includes_holidays && <Chip size="small" label="כולל חג" />}
                    {t.qualifying_duty && <Chip size="small" color="primary" variant="outlined" label="מזכה" />}
                    {t.requires_weapon && <Chip size="small" variant="outlined" label="נשק" />}
                    {t.shachar_only ? (
                      <Chip size="small" color="primary" label='רק שח"ר' />
                    ) : (
                      t.shachar_compatible && <Chip size="small" variant="outlined" label='שח"ר' />
                    )}
                    {t.tash_rule === "home" && <Chip size="small" color="success" variant="outlined" label='מתאימה לת"ש' />}
                    {t.tash_rule === "closed" && <Chip size="small" variant="outlined" label='לא לת"ש' />}
                    {!t.is_active && <Chip size="small" label="לא פעילה" />}
                  </Stack>
                </TableCell>
                <TableCell>
                  <IconButton size="small" aria-label="עריכה" onClick={() => setEditing(t)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      {editCats && (
        <CategoriesDialog
          categories={categories}
          tasks={tasks}
          onClose={() => setEditCats(false)}
          onChanged={() => void load()}
        />
      )}
      {editing && (
        <TaskDialog
          task={editing === "new" ? null : editing}
          all={tasks}
          categories={categories}
          ranks={ranks}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

/**
 * The duty categories: rename one in place, or add a new one. A category groups duty types for
 * the potential and the fairness groups, so a rename shows everywhere at once; past cycles keep
 * the group labels they were snapshotted with.
 */
function CategoriesDialog(props: { categories: NamedRef[]; tasks: TaskType[]; onClose: () => void; onChanged: () => void }) {
  const { api } = useAuth();
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(props.categories.map((c) => [c.id, c.name])));
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const used = (id: string) => props.tasks.filter((t) => t.category_id === id).length;
  const clash = (name: string, id?: string) => props.categories.some((c) => c.id !== id && c.name.trim() === name.trim());
  const sorted = [...props.categories].sort((a, b) => a.name.localeCompare(b.name, "he"));

  async function save(name: string, id?: string) {
    const v = name.trim();
    if (!v) return setError("שם הקטגוריה לא יכול להיות ריק");
    if (clash(v, id)) return setError(`כבר יש קטגוריה בשם "${v}"`);
    setBusy(id ?? "new");
    setError(null);
    try {
      await api!.saveDutyCategory(v, id);
      if (!id) setAdded("");
      props.onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>קטגוריות תורנות</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            הקטגוריה מקבצת סוגי תורנות לפוטנציאל ולקבוצות ההוגנות. שינוי שם מתעדכן בכל המקומות; מחזורים קודמים שומרים את שמות הקבוצות מהחישוב שלהם.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {sorted.map((c) => {
            const v = names[c.id] ?? c.name;
            const dirty = v.trim() !== c.name;
            return (
              <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <TextField
                  size="small"
                  fullWidth
                  value={v}
                  onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && dirty && void save(v, c.id)}
                  helperText={`${used(c.id)} סוגי תורנות`}
                />
                <Button size="small" variant="contained" disabled={!dirty || !!busy} onClick={() => void save(v, c.id)} sx={{ mb: 2.5 }}>
                  {busy === c.id ? <CircularProgress size={16} color="inherit" /> : "שמירה"}
                </Button>
              </Stack>
            );
          })}
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", pt: 1, borderTop: 1, borderColor: "divider" }}>
            <TextField
              size="small"
              fullWidth
              label="קטגוריה חדשה"
              value={added}
              onChange={(e) => setAdded(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && added.trim() && void save(added)}
            />
            <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={!added.trim() || !!busy} onClick={() => void save(added)}>
              הוספה
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Scoring multipliers
// ---------------------------------------------------------------------------

/** Pick day types (any of), with a quick way to add a new one. */
function DayTypePicker(props: { types: DayTypeRef[]; value: string[]; onChange: (v: string[]) => void; onAdded: () => Promise<void> }) {
  const { api } = useAuth();
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = (code: string) =>
    props.onChange(props.value.includes(code) ? props.value.filter((x) => x !== code) : [...props.value, code]);
  async function remove(t: DayTypeRef) {
    if (!window.confirm(`למחוק את סוג היום "${t.name}"?`)) return;
    try {
      await api!.deleteDayType(t.code);
      props.onChange(props.value.filter((x) => x !== t.code));
      await props.onAdded();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add() {
    const name = (adding ?? "").trim();
    if (!name) return;
    if (props.types.some((t) => t.name === name)) return setError("כבר יש סוג יום בשם הזה");
    try {
      const code = await api!.addDayType(name);
      await props.onAdded();
      props.onChange([...props.value, code]);
      setAdding(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Box>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        {props.types.filter(MARKABLE).map((t) => (
          <Chip
            key={t.code}
            label={t.name}
            color={props.value.includes(t.code) ? "primary" : "default"}
            variant={props.value.includes(t.code) ? "filled" : "outlined"}
            onClick={() => toggle(t.code)}
            // a type נע"ת added can be deleted (the built-in ones cannot)
            onDelete={t.code.startsWith("custom_") ? () => void remove(t) : undefined}
          />
        ))}
        {adding === null ? (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding("")}>
            סוג יום חדש
          </Button>
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TextField size="small" label="שם סוג היום" value={adding} onChange={(e) => setAdding(e.target.value)} autoFocus />
            <Button size="small" variant="outlined" onClick={add}>
              הוספה
            </Button>
            <Button size="small" onClick={() => setAdding(null)}>
              ביטול
            </Button>
          </Stack>
        )}
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>
  );
}

/** The holiday days (name and date) a multiplier's calendar conditions hit in the coming year. */
function holidayHits(m: ScoreMultiplierInput, calendar: CalendarDay[]) {
  const iso = (d: number) => ((d + 6) % 7) + 1; // JS Sunday=0 → ISO 7
  return calendar.filter(
    (d) =>
      calendarMatch(m, d) &&
      (!m.weekdays.length || m.weekdays.includes(iso(new Date(d.day + "T12:00:00Z").getUTCDay()))) &&
      (!m.date_from || d.day >= m.date_from) &&
      (!m.date_to || d.day <= m.date_to),
  );
}

function MultiplierDialog(props: {
  m: ScoreMultiplier | null;
  all: ScoreMultiplier[];
  calendar: CalendarDay[];
  types: DayTypeRef[];
  onTypesChanged: () => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAuth();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [m, setM] = useState<ScoreMultiplierInput>(() => {
    if (!props.m) return EMPTY_MULTIPLIER;
    const { id: _id, ...rest } = props.m;
    return rest;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof ScoreMultiplierInput>(k: K, v: ScoreMultiplierInput[K]) => setM((x) => ({ ...x, [k]: v }));
  const problems = multiplierProblems(m, props.all, props.m?.id);
  const [wFrom, wTo] = (m.time_window ?? "22:00-06:00").split("-");
  const byCalendar = m.holidays.length > 0 || m.holiday_kinds.length > 0 || m.day_types.length > 0;
  const hits = byCalendar ? holidayHits(m, props.calendar) : [];

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await f();
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Dialog open onClose={props.onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>{props.m ? `עריכת מקדם – ${props.m.name}` : "מקדם חדש"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={2}>
            <TextField label="שם" value={m.name} onChange={(e) => set("name", e.target.value)} fullWidth autoFocus />
            <TextField
              type="number"
              label="ערך"
              value={m.value}
              onChange={(e) => set("value", Number(e.target.value))}
              slotProps={{ htmlInput: { step: 0.05, min: 1, max: 10 } }}
              sx={{ width: 130 }}
            />
          </Stack>
          <Alert severity="info" icon={false}>
            המקדם חל על יום של תורנות כשכל התנאים שבחרת מתקיימים. בתוך תנאי מספיק אחת האפשרויות. כשכמה מקדמים חלים, נלקח הגבוה מביניהם.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            מקדם לחג מסוים (ערב חג, החג, חול המועד) נקבע בטבלה "מקדם לכל יום חג" בהמשך העמוד.
          </Typography>
          {(m.holidays.length > 0 || m.holiday_kinds.length > 0) && (
            // a multiplier made before the table keeps its holiday condition until it is cleared
            <Alert
              severity="info"
              icon={false}
              action={
                <Button size="small" onClick={() => setM((x) => ({ ...x, holidays: [], holiday_kinds: [] }))}>
                  ניקוי
                </Button>
              }
            >
              תנאי חג: {holidayPhrase(m.holidays, m.holiday_kinds)}
            </Alert>
          )}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              סוג יום בלוח השנה
            </Typography>
            <DayTypePicker types={props.types} value={m.day_types} onChange={(v) => set("day_types", v)} onAdded={props.onTypesChanged} />
          </Box>
          {byCalendar && (
            <Alert severity={hits.length ? "success" : "warning"} icon={false} sx={{ py: 0.5 }}>
              {hits.length ? (
                <>
                  <b>חל ב-12 החודשים הקרובים על:</b>{" "}
                  {hits
                    .slice(0, 12)
                    .map((d) => `${d.note ?? HOLIDAY_KIND_NAME[d.holiday_kind as HolidayKind] ?? ""} (${fmt(d.day).slice(0, 5)})`)
                    .join(" · ")}
                  {hits.length > 12 && ` ועוד ${hits.length - 12}`}
                </>
              ) : (
                "לא חל על אף יום ב-12 החודשים הקרובים."
              )}
            </Alert>
          )}
          <Box>
            <Typography variant="subtitle2">ימים בשבוע</Typography>
            <FormGroup row>
              {ISO_WEEK.map((d) => (
                <FormControlLabel
                  key={d}
                  label={ISO_DAY_LABEL[d]}
                  control={
                    <Checkbox
                      checked={m.weekdays.includes(d)}
                      onChange={(e) => set("weekdays", e.target.checked ? [...m.weekdays, d].sort() : m.weekdays.filter((x) => x !== d))}
                    />
                  }
                />
              ))}
            </FormGroup>
          </Box>
          <Box>
            <FormControlLabel
              control={<Switch checked={m.time_window !== null} onChange={(e) => set("time_window", e.target.checked ? "22:00-06:00" : null)} />}
              label="חלון שעות (לתורנות קצרה מ-24 שעות שרוב שעותיה בחלון)"
            />
            {m.time_window !== null && (
              <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                <TextField type="time" label="מ" value={wFrom} onChange={(e) => set("time_window", `${e.target.value}-${wTo}`)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
                <TextField type="time" label="עד" value={wTo} onChange={(e) => set("time_window", `${wFrom}-${e.target.value}`)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField type="date" label="מתאריך" value={m.date_from ?? ""} onChange={(e) => set("date_from", e.target.value || null)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            <TextField type="date" label="עד תאריך" value={m.date_to ?? ""} onChange={(e) => set("date_to", e.target.value || null)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
          </Stack>
          <FormGroup>
            <FormControlLabel
              control={<Switch checked={m.skip_shabbat_types} onChange={(e) => set("skip_shabbat_types", e.target.checked)} />}
              label="לא לתורנויות שבת (המשקל שלהן כבר כולל את סוף השבוע)"
            />
            <FormControlLabel control={<Switch checked={m.is_active} onChange={(e) => set("is_active", e.target.checked)} />} label="פעיל" />
          </FormGroup>
        </Stack>
      </DialogContent>
      {(error || problems.length > 0) && (
        <Alert severity={error ? "error" : "warning"} sx={{ mx: 2, mt: 1.5 }}>
          {error ?? problems[0]}
        </Alert>
      )}
      <DialogActions>
        {props.m &&
          (confirmDelete ? (
            <>
              <Box sx={{ flex: 1, color: "error.main", fontSize: 14, px: 1 }}>למחוק את המקדם "{props.m.name}"?</Box>
              <Button color="error" variant="contained" disabled={busy} onClick={() => run(() => api!.deleteScoreMultiplier(props.m!.id))}>
                מחיקה
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>לא</Button>
            </>
          ) : (
            <Button color="error" onClick={() => setConfirmDelete(true)} disabled={busy} sx={{ mr: "auto" }}>
              מחיקת המקדם
            </Button>
          ))}
        {!confirmDelete && (
          <>
            <Button onClick={props.onClose}>ביטול</Button>
            <Button variant="contained" disabled={busy || problems.length > 0} onClick={() => run(() => api!.saveScoreMultiplier(props.m?.id ?? null, m))}>
              שמירה
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** One cell of the holiday table: its own multiplier, edited in place. */
function HolidayCell(props: { h: HolidayKey; k: HolidayKind; row: ScoreMultiplier | undefined; other: { value: number; name: string } | null; onChanged: () => void }) {
  const { api } = useAuth();
  const own = props.row?.is_active ? props.row.value : null;
  const [text, setText] = useState(own === null ? "" : String(own));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(own === null ? "" : String(own)), [own]);

  async function commit() {
    const t = text.trim();
    const v = t === "" ? null : Number(t);
    if (v !== null && (!(v >= 1) || v > 10)) return setError("בין 1 ל-10");
    if (v === own || (v === 1 && own === null)) return setError(null);
    setBusy(true);
    setError(null);
    try {
      if (v === null || v === 1) {
        if (props.row) await api!.deleteScoreMultiplier(props.row.id);
      } else {
        await api!.saveScoreMultiplier(props.row?.id ?? null, {
          ...EMPTY_MULTIPLIER,
          name: `${HOLIDAY_NAME[props.h]} · ${HOLIDAY_KIND_NAME[props.k]}`,
          value: v,
          holidays: [props.h],
          holiday_kinds: [props.k],
          holiday_cell: true,
        });
      }
      props.onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const effective = Math.max(own ?? 1, props.other?.value ?? 1);
  return (
    <Box>
      <TextField
        size="small"
        type="number"
        value={text}
        placeholder="1"
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        error={!!error}
        slotProps={{ htmlInput: { step: 0.05, min: 1, max: 10, "aria-label": `${HOLIDAY_NAME[props.h]} – ${HOLIDAY_KIND_NAME[props.k]}`, style: { padding: "6px 8px" } } }}
        sx={{ width: 84 }}
      />
      {error ? (
        <Typography variant="caption" color="error" sx={{ display: "block" }}>
          {error}
        </Typography>
      ) : (
        props.other &&
        props.other.value > (own ?? 1) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.2, mt: 0.25 }}>
            חל ×{effective} · {props.other.name}
          </Typography>
        )
      )}
    </Box>
  );
}

/**
 * The multiplier of each day of each holiday, edited here directly: a value in a cell is that
 * day's own multiplier (empty = none). A general multiplier from the list above that is higher
 * still wins, and the cell says so.
 */
function HolidayMatrix({ list, calendar, onChanged }: { list: ScoreMultiplier[]; calendar: CalendarDay[]; onChanged: () => void }) {
  const general = list.filter((m) => m.is_active && !m.holiday_cell && calendarOnly(m));
  // the stored calendar first; a holiday not in it yet is looked up in the generated dates
  const generated = useMemo(() => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    return israeliHolidays(from, to);
  }, []);
  const otherFor = (h: HolidayKey, k: HolidayKind) => {
    const d = calendar.find((x) => x.holiday === h && x.holiday_kind === k) ?? generated.find((x) => x.holiday === h && x.holiday_kind === k);
    if (!d) return null;
    const hit = general.filter((m) => calendarMatch(m, d)).sort((a, b) => b.value - a.value);
    return hit.length ? { value: hit[0].value, name: hit[0].name } : null;
  };
  const cellRow = (h: HolidayKey, k: HolidayKind) => list.find((m) => m.holiday_cell && m.holidays[0] === h && m.holiday_kinds[0] === k);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={1.5}>
        <Typography variant="h3">מקדם לכל יום חג</Typography>
        <Typography variant="body2" color="text.secondary">
          כתוב מקדם בתא כדי לקבוע אותו לאותו יום (ריק = בלי מקדם משלו). אם מקדם כללי מהרשימה למעלה גבוה יותר, הוא חל – והתא מראה אותו. גם בסוף שבוע
          או בתורנות לילה נלקח תמיד המקדם הגבוה.
        </Typography>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>חג</TableCell>
                {HOLIDAY_KINDS.map((k) => (
                  <TableCell key={k.key}>{k.name}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {HOLIDAYS.map((h) => (
                <TableRow key={h.key}>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>{h.name}</TableCell>
                  {HOLIDAY_KINDS.map((k) =>
                    h.kinds.includes(k.key) ? (
                      <TableCell key={k.key} sx={{ py: 0.75 }}>
                        <HolidayCell h={h.key} k={k.key} row={cellRow(h.key, k.key)} other={otherFor(h.key, k.key)} onChanged={onChanged} />
                      </TableCell>
                    ) : (
                      <TableCell key={k.key} sx={{ color: "text.disabled" }}>
                        —
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Stack>
    </Paper>
  );
}

/** Relief roles (ראש צוות, כונן מבצעי…): a soldier's points are divided by the factor. */
function LoadRolesCard() {
  const { api } = useAuth();
  const [roles, setRoles] = useState<LoadRoleRef[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; factor: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setRoles(await api!.loadRoles()), [api]);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await f();
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  function save() {
    const f = Number(editing!.factor);
    if (!editing!.name.trim()) return setError("חסר שם");
    if (!(f > 0) || f > 1) return setError("המקדם – גדול מ-0 ועד 1 (0.5 = חצי מהעומס)");
    if (roles!.some((r) => r.id !== editing!.id && r.name === editing!.name.trim())) return setError("כבר יש הקלה בשם הזה");
    void run(() => api!.saveLoadRole(editing!.id, { name: editing!.name, factor: f }));
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Typography variant="h3" sx={{ flex: 1 }}>
            מקדמי הקלה (תפקידים)
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          חייל עם תפקיד מקבל חלק מהעומס: הניקוד שלו מחולק במקדם (0.5 = חצי מהעומס של חייל רגיל). לחייל עם כמה תפקידים חלה ההקלה הגדולה ביותר – המקדם
          הנמוך – בלי הכפלה. את התפקיד של כל חייל קובעים במסך חיילים.
        </Typography>
        {!roles ? (
          <Loading />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>הקלה</TableCell>
                <TableCell>מקדם</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {roles.map((r) => (
                <TableRow key={r.id} hover onClick={() => setEditing({ id: r.id, name: r.name, factor: String(r.factor) })} sx={{ cursor: "pointer" }}>
                  <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                  <TableCell>×{r.factor}</TableCell>
                  <TableCell>
                    <IconButton size="small" aria-label="עריכה">
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {error && !editing && <Alert severity="error">{error}</Alert>}
      </Stack>
      {editing && (
        <Dialog open onClose={() => setEditing(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{editing.id ? "עריכת הקלה" : "הקלה חדשה"}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <TextField label="שם" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} fullWidth autoFocus />
              <TextField
                type="number"
                label="מקדם"
                value={editing.factor}
                onChange={(e) => setEditing({ ...editing, factor: e.target.value })}
                slotProps={{ htmlInput: { step: 0.05, min: 0.05, max: 1 } }}
                helperText="0.5 = חצי מהעומס. שינוי חל על שיבוצים חדשים; ניקוד שכבר נשמר לא משתנה."
                fullWidth
              />
            </Stack>
          </DialogContent>
          {error && (
            <Alert severity="error" sx={{ mx: 2, mt: 1.5 }}>
              {error}
            </Alert>
          )}
          <DialogActions>
            {editing.id && (
              <Button color="error" disabled={busy} onClick={() => run(() => api!.deleteLoadRole(editing.id!))} sx={{ mr: "auto" }}>
                מחיקה
              </Button>
            )}
            <Button onClick={() => setEditing(null)}>ביטול</Button>
            <Button variant="contained" onClick={save} disabled={busy}>
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Paper>
  );
}

function ScoringTab() {
  const { api } = useAuth();
  const [list, setList] = useState<ScoreMultiplier[] | null>(null);
  const [types, setTypes] = useState<DayTypeRef[]>([]);
  const [editing, setEditing] = useState<ScoreMultiplier | "new" | null>(null);
  const [s, setS] = useState<ScoringSettings | null>(null);
  const [saved, setSaved] = useState<ScoringSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [surprise, setSurprise] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);

  async function saveSurprise() {
    const v = Number(surprise);
    if (!(v >= 1) || v > 10) return setMsg({ ok: false, text: "מקדם הקפצה – בין 1 ל-10" });
    try {
      const next = { ...saved!, surprise_multiplier: v };
      await api!.saveScoringSettings(next);
      setSaved(next);
      setS((x) => (x ? { ...x, surprise_multiplier: v } : x));
      setSurprise(null);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const loadTypes = useCallback(async () => setTypes(await api!.dayTypes()), [api]);
  const load = useCallback(async () => {
    try {
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 10);
      const [l, v, cal] = await Promise.all([api!.scoreMultipliers(), api!.scoringSettings(), api!.calendarDays(from, to), loadTypes()]);
      setList(l);
      setCalendar(cal);
      setS(v);
      setSaved(v);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, [api, loadTypes]);
  useEffect(() => void load(), [load]);

  const typeName = useCallback((code: string) => types.find((t) => t.code === code)?.name ?? DAY_TYPE_LABEL[code] ?? code, [types]);

  if (!s || !list) return msg ? <Alert severity="error">{msg.text}</Alert> : <Loading />;
  const [nightFrom, nightTo] = s.night_window.split("-");
  const problems = scoringProblems(s);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  async function save() {
    if (problems.length) return setMsg({ ok: false, text: problems[0] });
    setBusy(true);
    try {
      await api!.saveScoringSettings(s!);
      setSaved(s);
      setMsg({ ok: true, text: "נשמר." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ alignItems: "center" }}>
            <Typography variant="h3" sx={{ flex: 1 }}>
              מקדמי ניקוד
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
              מקדם חדש
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            הניקוד של תורנות הוא המשקל שלה לכל יחידת 24 שעות, כפול המקדם הגבוה מבין המקדמים שחלים על היום. מקדמים לא מצטברים זה על זה. שינוי
            חל על השיבוץ הבא; ניקוד שכבר נצבר לא משתנה.
          </Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>מקדם</TableCell>
                  <TableCell>ערך</TableCell>
                  <TableCell>מתי חל</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {list.filter((m) => !m.holiday_cell).map((m) => (
                  <TableRow key={m.id} hover onClick={() => setEditing(m)} sx={{ cursor: "pointer", opacity: m.is_active ? 1 : 0.5 }}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {m.name} {!m.is_active && <Chip size="small" label="לא פעיל" />}
                    </TableCell>
                    <TableCell>×{m.value}</TableCell>
                    <TableCell>{describeMultiplier(m, typeName)}</TableCell>
                    <TableCell>
                      <IconButton size="small" aria-label="עריכה" onClick={() => setEditing(m)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow hover onClick={() => setSurprise(String(saved?.surprise_multiplier ?? 1.5))} sx={{ cursor: "pointer" }}>
                  <TableCell sx={{ fontWeight: 600 }}>הקפצה</TableCell>
                  <TableCell>×{saved?.surprise_multiplier}</TableCell>
                  <TableCell>תורנות שנוספה אחרי הפרסום וסומנה "הקפצה" · מוכפל על המקדם של היום</TableCell>
                  <TableCell>
                    <IconButton size="small" aria-label="עריכה" onClick={() => setSurprise(String(saved?.surprise_multiplier ?? 1.5))}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
        </Stack>
      </Paper>

      <HolidayMatrix list={list} calendar={calendar} onChanged={() => void load()} />

      <LoadRolesCard />

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h3">הגדרות כלליות</Typography>
          <Box>
            <Typography variant="subtitle2">ימי סוף שבוע (לאיזון סופי השבוע בין החיילים)</Typography>
            <FormGroup row>
              {ISO_WEEK.map((d) => (
                <FormControlLabel
                  key={d}
                  label={ISO_DAY_LABEL[d]}
                  control={
                    <Checkbox
                      checked={s.weekend_weekdays.includes(d)}
                      onChange={(e) =>
                        setS({
                          ...s,
                          weekend_weekdays: e.target.checked ? [...s.weekend_weekdays, d].sort() : s.weekend_weekdays.filter((x) => x !== d),
                        })
                      }
                    />
                  }
                />
              ))}
            </FormGroup>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              שעות לילה (מי שלן בבית לא משובץ בהן)
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField type="time" label="לילה – מ" value={nightFrom} onChange={(e) => setS({ ...s, night_window: `${e.target.value}-${nightTo}` })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
              <TextField type="time" label="לילה – עד" value={nightTo} onChange={(e) => setS({ ...s, night_window: `${nightFrom}-${e.target.value}` })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            </Stack>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              הוגנות בטיוטה
            </Typography>
            <TextField
              type="number"
              label="טווח מותר מהממוצע (%)"
              value={s.fairness_tolerance_pct}
              onChange={(e) => setS({ ...s, fairness_tolerance_pct: Number(e.target.value) })}
              slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }}
              helperText="במסך העומס, חייל שרחוק יותר מזה מממוצע מי שזכאים לאותן תורנויות מסומן כחורג (לפחות חצי נקודה)."
              sx={{ maxWidth: 320 }}
            />
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              חייל חדש ביחידה
            </Typography>
            <TextField
              type="number"
              label="תקופת הכשרה (ימים)"
              value={s.grace_days}
              onChange={(e) => setS({ ...s, grace_days: Math.round(Number(e.target.value)) })}
              slotProps={{ htmlInput: { min: 0, max: 365, step: 1 } }}
              helperText={
                (s.grace_days >= 30 ? `≈ ${Math.round(s.grace_days / 30)} חודשים. ` : "") +
                "חייל חדש לא משובץ לתורנויות בימים הראשונים שלו ביחידה, מתחילת המחזור הראשון שלו, ומקבל עליהם זיכוי. 0 = בלי תקופת הכשרה. חל מהחישוב הבא של הפוטנציאל."
              }
              sx={{ maxWidth: 320 }}
            />
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              סגירת אילוצים ופטורים במחזור חדש
            </Typography>
            <TextField
              type="number"
              label="ימים לפני תחילת המחזור"
              value={s.exemption_deadline_days}
              onChange={(e) => setS({ ...s, exemption_deadline_days: Math.round(Number(e.target.value)) })}
              slotProps={{ htmlInput: { min: 1, max: 180, step: 1 } }}
              helperText="ברירת המחדל כשיוצרים מחזור. את המועד של כל מחזור אפשר לשנות במסך האילוצים שלו."
              sx={{ maxWidth: 320 }}
            />
          </Box>
          {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          <Box>
            <Button variant="contained" onClick={save} disabled={busy || !dirty}>
              שמירה
            </Button>
          </Box>
        </Stack>
      </Paper>

      {surprise !== null && (
        <Dialog open onClose={() => setSurprise(null)} maxWidth="xs" fullWidth>
          <DialogTitle>מקדם הקפצה</DialogTitle>
          <DialogContent dividers>
            <TextField
              type="number"
              label="ערך"
              value={surprise}
              onChange={(e) => setSurprise(e.target.value)}
              slotProps={{ htmlInput: { step: 0.05, min: 1, max: 10 } }}
              helperText="לתורנות שנוספה אחרי הפרסום וסומנה הקפצה. מוכפל בניקוד שלה, מעבר למקדם היום."
              fullWidth
              autoFocus
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSurprise(null)}>ביטול</Button>
            <Button variant="contained" onClick={saveSurprise}>
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {editing && (
        <MultiplierDialog
          m={editing === "new" ? null : editing}
          all={list}
          calendar={calendar}
          types={types}
          onTypesChanged={loadTypes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

const CHIP_COLOR: Record<string, "error" | "warning" | "default" | "info"> = {
  major_holiday: "error",
  major_holiday_eve: "warning",
  holiday: "error",
  holiday_eve: "warning",
  memorial: "default",
  weekend: "info",
  weekday: "default",
};

function DayDialog(props: { day: CalendarDay | null; types: DayTypeRef[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const [d, setD] = useState<CalendarDay>(props.day ?? { day: "", day_type: "holiday", source: "manual", note: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!d.day) return setError("בחר תאריך");
    if (!d.holiday !== !d.holiday_kind) return setError("לחג צריך לבחור גם איזה יום בחג (או לנקות את שניהם)");
    try {
      await api!.saveCalendarDays([{ ...d, source: "manual", note: d.note?.trim() || null }]);
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog open onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{props.day ? "עריכת יום" : "הוספת יום"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            type="date"
            label="תאריך"
            value={d.day}
            disabled={!!props.day}
            onChange={(e) => setD({ ...d, day: e.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField select label="סוג" value={d.day_type} onChange={(e) => setD({ ...d, day_type: e.target.value })}>
            {props.types.filter(MARKABLE).map((t) => (
              <MenuItem key={t.code} value={t.code}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="תיאור" value={d.note ?? ""} onChange={(e) => setD({ ...d, note: e.target.value })} />
          <Stack direction="row" spacing={1.5}>
            <TextField select label="חג" value={d.holiday ?? ""} onChange={(e) => setD({ ...d, holiday: (e.target.value || null) as HolidayKey | null })} fullWidth>
              <MenuItem value="">—</MenuItem>
              {HOLIDAYS.map((h) => (
                <MenuItem key={h.key} value={h.key}>
                  {h.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="איזה יום בחג"
              value={d.holiday_kind ?? ""}
              onChange={(e) => setD({ ...d, holiday_kind: (e.target.value || null) as HolidayKind | null })}
              fullWidth
            >
              <MenuItem value="">—</MenuItem>
              {HOLIDAY_KINDS.map((k) => (
                <MenuItem key={k.key} value={k.key}>
                  {k.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            יום שנערך ידנית לא יידרס בטעינה אוטומטית של החגים.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" onClick={save}>
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CalendarTab() {
  const { api } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [types, setTypes] = useState<DayTypeRef[]>([]);
  const [editing, setEditing] = useState<CalendarDay | "new" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const load = useCallback(async () => {
    setDays(null);
    try {
      setDays(await api!.calendarDays(from, to));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setDays([]);
    }
  }, [api, from, to]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    api!.dayTypes().then(setTypes).catch(() => setTypes([]));
  }, [api]);
  const typeName = (code: string) => types.find((t) => t.code === code)?.name ?? DAY_TYPE_LABEL[code] ?? code;

  async function autoLoad() {
    setBusy(true);
    setMsg(null);
    try {
      const { toWrite, keptManual } = mergeHolidays(days ?? [], israeliHolidays(from, to));
      await api!.saveCalendarDays(toWrite);
      setMsg({
        ok: true,
        text:
          (toWrite.length ? `נטענו ${toWrite.length} ימים לשנת ${year}.` : `לוח ${year} כבר מעודכן.`) +
          (keptManual ? ` ${keptManual} ימים שנערכו ידנית נשארו כמו שהם.` : ""),
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  async function remove(d: CalendarDay) {
    try {
      await api!.deleteCalendarDay(d.day);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <TextField select size="small" label="שנה" value={year} onChange={(e) => setYear(Number(e.target.value))} sx={{ width: 120 }}>
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
            <MenuItem key={y} value={y}>
              {y}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" startIcon={<AutorenewIcon />} onClick={autoLoad} disabled={busy || !days}>
          רענון חגי ישראל
        </Button>
        <Button startIcon={<AddIcon />} onClick={() => setEditing("new")}>
          הוספת יום
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        חגי ישראל לשנים 2026–2035 כבר טעונים. חג וערב חג נספרים כימי סוף שבוע באיזון. המקדם של כל סוג יום נקבע בלשונית "מקדמי ניקוד". חול המועד לא מסומן; אפשר להוסיף אותו ידנית, וגם סוגי יום חדשים. "רענון" משלים ימים שנמחקו ולא נוגע בימים שנערכו ידנית.
      </Typography>
      {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
      {!days ? (
        <Loading />
      ) : days.length === 0 ? (
        <Alert severity="info">אין ימים מסומנים ל-{year}. לחץ על "רענון חגי ישראל".</Alert>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>תאריך</TableCell>
                <TableCell>יום</TableCell>
                <TableCell>סוג</TableCell>
                <TableCell>תיאור</TableCell>
                <TableCell>מקור</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d.day} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmt(d.day)}</TableCell>
                  <TableCell>{weekdayOf(d.day)}</TableCell>
                  <TableCell>
                    <Chip size="small" color={CHIP_COLOR[d.day_type] ?? "info"} label={typeName(d.day_type)} />
                  </TableCell>
                  <TableCell>{d.note ?? "—"}</TableCell>
                  <TableCell>{d.source === "manual" ? "ידני" : "אוטומטי"}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <IconButton size="small" aria-label="עריכה" onClick={() => setEditing(d)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label="מחיקה" onClick={() => remove(d)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {editing && (
        <DayDialog
          day={editing === "new" ? null : editing}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------

function AliasesTab() {
  const { api } = useAuth();
  const [aliases, setAliases] = useState<{ alias: string; task_type_id: string }[] | null>(null);
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([api!.taskTypeAliases(), api!.taskTypes()]);
      setAliases(a.sort((x, y) => x.alias.localeCompare(y.alias, "he")));
      setTasks(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!aliases) return <Loading />;
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        השמות שהבסיס משתמש בהם בקובץ המשבצות, ולאיזה סוג תורנות כל שם מותאם. שם שלא מופיע כאן ולא זהה לשם של סוג תורנות יופיע בקליטה לבחירה. משבצת שמתחילה
        בסוף שבוע עוברת לבד לסוג השבת של אותה תורנות.
      </Typography>
      {aliases.length === 0 ? (
        <Alert severity="info">עוד אין התאמות שמורות.</Alert>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>שם בקובץ הבסיס</TableCell>
                <TableCell>סוג תורנות</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {aliases.map((a) => (
                <TableRow key={a.alias}>
                  <TableCell>{a.alias}</TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={a.task_type_id}
                      onChange={async (e) => {
                        await api!.saveTaskTypeAliases([{ alias: a.alias, task_type_id: e.target.value }]);
                        void load();
                      }}
                      sx={{ minWidth: 220 }}
                    >
                      {tasks.map((t) => (
                        <MenuItem key={t.id} value={t.id}>
                          {t.name}
                          {!t.is_active && " (לא פעילה)"}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      aria-label="מחיקה"
                      onClick={async () => {
                        await api!.deleteTaskTypeAlias(a.alias);
                        void load();
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}

const TABS = [
  { key: "catalog", label: "קטלוג תורנויות" },
  { key: "aliases", label: "שמות מהבסיס" },
  { key: "scoring", label: "מקדמי ניקוד" },
  { key: "calendar", label: "לוח חגים" },
  { key: "users", label: "משתמשים" },
] as const;

export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "catalog";
  return (
    <Stack spacing={2}>
      <Typography variant="h1">הגדרות</Typography>
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v }, { replace: true })} variant="scrollable" allowScrollButtonsMobile>
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>
      {tab === "catalog" && <CatalogTab />}
      {tab === "scoring" && <ScoringTab />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "aliases" && <AliasesTab />}
      {tab === "users" && <UsersTab />}
    </Stack>
  );
}

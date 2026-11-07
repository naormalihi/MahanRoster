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
import {
  DAY_TYPE_LABEL,
  ISO_DAY_LABEL,
  SERVICE_LABEL,
  israeliHolidays,
  mergeHolidays,
  scoringProblems,
  taskTypeProblems,
  type CalendarDay,
  type DayType,
  type Population,
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
  shachar_compatible: false,
  qualifying_duty: false,
  eligible_populations: [],
  rank_min_id: null,
  rank_max_id: null,
  gender: null,
  default_start_time: "08:00",
  default_end_time: "08:00",
  color: "#3b6ea8",
  is_active: true,
};

function TaskDialog(props: {
  task: TaskType | null;
  all: TaskType[];
  categories: NamedRef[];
  populations: Population[];
  ranks: NamedRef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAuth();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [t, setT] = useState<TaskTypeInput>(() => {
    if (!props.task) return EMPTY_TASK;
    const { id: _id, ...rest } = props.task;
    return rest;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TaskTypeInput>(k: K, v: TaskTypeInput[K]) => setT((x) => ({ ...x, [k]: v }));
  const problems = taskTypeProblems(t, props.all, props.task?.id);
  const weightChanged = props.task && props.task.weight !== t.weight;

  async function save() {
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    setError(null);
    try {
      await api!.saveTaskType(props.task?.id ?? null, { ...t, name: t.name.trim() });
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const rankSelect = (label: string, key: "rank_min_id" | "rank_max_id") => (
    <TextField select label={label} value={t[key] ?? ""} onChange={(e) => set(key, e.target.value || null)} fullWidth slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
      <MenuItem value="">ללא הגבלה</MenuItem>
      {props.ranks.map((r) => (
        <MenuItem key={r.id} value={r.id}>
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
            <TextField
              label="קוד (לטינית)"
              value={t.code}
              onChange={(e) => set("code", e.target.value.trim().toLowerCase())}
              disabled={!!props.task}
              helperText={props.task ? "הקוד קבוע אחרי היצירה" : "למשל katzin_toran"}
              fullWidth
              slotProps={{ htmlInput: { dir: "ltr" } }}
            />
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
            <TextField
              type="number"
              label="מנוחה אחרי (שעות)"
              value={t.min_rest_hours}
              onChange={(e) => set("min_rest_hours", Math.round(Number(e.target.value)))}
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
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
            {rankSelect("מדרגה", "rank_min_id")}
            {rankSelect("עד דרגה", "rank_max_id")}
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
          </Stack>
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              אוכלוסיות (אם לא נבחרה אף אחת, התורנות פתוחה לכל מי שעומד בשאר התנאים)
            </Typography>
            <FormGroup row>
              {props.populations.map((p) => (
                <FormControlLabel
                  key={p.code}
                  label={p.name}
                  control={
                    <Checkbox
                      checked={t.eligible_populations.includes(p.code)}
                      onChange={(e) =>
                        set(
                          "eligible_populations",
                          e.target.checked ? [...t.eligible_populations, p.code] : t.eligible_populations.filter((x) => x !== p.code),
                        )
                      }
                    />
                  }
                />
              ))}
            </FormGroup>
          </Box>
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
              control={<Switch checked={t.qualifying_duty} onChange={(e) => set("qualifying_duty", e.target.checked)} />}
              label="תורנות מזכה (פתוחה גם למשרתי הורה ולבעלי פטור מזכה)"
            />
            <FormControlLabel
              control={<Switch checked={t.shachar_compatible} onChange={(e) => set("shachar_compatible", e.target.checked)} />}
              label='מתאימה לשח"ר'
            />
            <FormControlLabel
              control={<Switch checked={t.is_active} onChange={(e) => set("is_active", e.target.checked)} />}
              label="פעילה (תורנות לא פעילה לא תשובץ)"
            />
          </FormGroup>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CatalogTab() {
  const { api } = useAuth();
  const [tasks, setTasks] = useState<TaskType[] | null>(null);
  const [categories, setCategories] = useState<NamedRef[]>([]);
  const [populations, setPopulations] = useState<Population[]>([]);
  const [ranks, setRanks] = useState<NamedRef[]>([]);
  const [editing, setEditing] = useState<TaskType | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c, p, r] = await Promise.all([api!.taskTypes(), api!.dutyCategories(), api!.populations(), api!.ranks()]);
      setTasks(t);
      setCategories(c);
      setPopulations(p);
      setRanks(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const rankName = useMemo(() => new Map(ranks.map((r) => [r.id, r.name])), [ranks]);
  const popName = useMemo(() => new Map(populations.map((p) => [p.code, p.name])), [populations]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!tasks) return <Loading />;
  const shown = tasks
    .filter((t) => showInactive || t.is_active)
    .sort((a, b) => (catName.get(a.category_id ?? "") ?? "").localeCompare(catName.get(b.category_id ?? "") ?? "", "he") || a.name.localeCompare(b.name, "he"));
  const inactive = tasks.filter((t) => !t.is_active).length;

  const who = (t: TaskType) => {
    const parts: string[] = [];
    if (t.service_restriction !== "any") parts.push(SERVICE_LABEL[t.service_restriction]);
    if (t.eligible_populations.length) parts.push(t.eligible_populations.map((p) => popName.get(p) ?? p).join(" / "));
    if (t.rank_min_id) parts.push(`מ${rankName.get(t.rank_min_id)}`);
    if (t.rank_max_id) parts.push(`עד ${rankName.get(t.rank_max_id)}`);
    if (t.gender) parts.push(t.gender === "male" ? "גברים" : "נשים");
    return parts.join(" · ") || "כולם";
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>
          תורנות חדשה
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
              <TableCell>מנוחה</TableCell>
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
                  {t.default_start_time ? `${t.default_start_time}–${t.default_end_time}` : "—"}
                </TableCell>
                <TableCell>{t.min_rest_hours ? `${t.min_rest_hours} ש׳` : "—"}</TableCell>
                <TableCell>{who(t)}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                    {t.is_weekend_type && <Chip size="small" label="שבת" />}
                    {t.qualifying_duty && <Chip size="small" color="primary" variant="outlined" label="מזכה" />}
                    {t.requires_weapon && <Chip size="small" variant="outlined" label="נשק" />}
                    {t.shachar_compatible && <Chip size="small" variant="outlined" label='שח"ר' />}
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
      {editing && (
        <TaskDialog
          task={editing === "new" ? null : editing}
          all={tasks}
          categories={categories}
          populations={populations}
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

// ---------------------------------------------------------------------------
// Scoring multipliers
// ---------------------------------------------------------------------------

function ScoringTab() {
  const { api } = useAuth();
  const [s, setS] = useState<ScoringSettings | null>(null);
  const [saved, setSaved] = useState<ScoringSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api!
      .scoringSettings()
      .then((v) => {
        setS(v);
        setSaved(v);
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [api]);

  if (!s) return msg ? <Alert severity="error">{msg.text}</Alert> : <Loading />;
  const [nightFrom, nightTo] = s.night_window.split("-");
  const problems = scoringProblems(s);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const num = (k: "weekend_multiplier" | "holiday_multiplier" | "night_multiplier", label: string, help: string) => (
    <TextField
      type="number"
      label={label}
      value={s[k]}
      onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
      slotProps={{ htmlInput: { step: 0.05, min: 1, max: 5 } }}
      helperText={help}
      fullWidth
    />
  );

  async function save() {
    if (problems.length) return setMsg({ ok: false, text: problems[0] });
    setBusy(true);
    try {
      await api!.saveScoringSettings(s!);
      setSaved(s);
      setMsg({ ok: true, text: "נשמר. המקדמים החדשים יחולו על השיבוץ הבא; ניקוד שכבר נצבר לא משתנה." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 760 }}>
      <Stack spacing={3}>
        <Typography variant="body2" color="text.secondary">
          הניקוד של תורנות הוא המשקל שלה לכל יחידת 24 שעות, כפול המקדם של היום. כשחג נופל בסוף שבוע נלקח המקדם הגבוה מבין השניים, הם לא
          מצטברים. תורנויות שבת לא מקבלות את מקדם סוף השבוע, כי המשקל שלהן כבר כולל אותו.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          {num("weekend_multiplier", "מקדם סוף שבוע", "ימים שמסומנים למטה")}
          {num("holiday_multiplier", "מקדם חג", "חג וערב חג לפי לוח החגים")}
          {num("night_multiplier", "מקדם לילה", "לשעות שבחלון הלילה")}
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            type="time"
            label="לילה – מ"
            value={nightFrom}
            onChange={(e) => setS({ ...s, night_window: `${e.target.value}-${nightTo}` })}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            type="time"
            label="לילה – עד"
            value={nightTo}
            onChange={(e) => setS({ ...s, night_window: `${nightFrom}-${e.target.value}` })}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        </Stack>
        <Box>
          <Typography variant="subtitle2">ימי סוף שבוע</Typography>
          <FormGroup row>
            {[7, 1, 2, 3, 4, 5, 6].map((d) => (
              <FormControlLabel
                key={d}
                label={ISO_DAY_LABEL[d]}
                control={
                  <Checkbox
                    checked={s.weekend_weekdays.includes(d)}
                    onChange={(e) =>
                      setS({
                        ...s,
                        weekend_weekdays: e.target.checked
                          ? [...s.weekend_weekdays, d].sort()
                          : s.weekend_weekdays.filter((x) => x !== d),
                      })
                    }
                  />
                }
              />
            ))}
          </FormGroup>
        </Box>
        {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
        <Box>
          <Button variant="contained" onClick={save} disabled={busy || !dirty}>
            שמירה
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

const CHIP_COLOR: Record<DayType, "error" | "warning" | "default" | "info"> = {
  holiday: "error",
  holiday_eve: "warning",
  memorial: "default",
  weekend: "info",
  weekday: "default",
};

function DayDialog(props: { day: CalendarDay | null; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const [d, setD] = useState<CalendarDay>(props.day ?? { day: "", day_type: "holiday", source: "manual", note: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!d.day) return setError("בחר תאריך");
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
          <TextField select label="סוג" value={d.day_type} onChange={(e) => setD({ ...d, day_type: e.target.value as DayType })}>
            {(["holiday", "holiday_eve", "memorial"] as DayType[]).map((k) => (
              <MenuItem key={k} value={k}>
                {DAY_TYPE_LABEL[k]}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="תיאור" value={d.note ?? ""} onChange={(e) => setD({ ...d, note: e.target.value })} />
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
          טעינת חגי ישראל
        </Button>
        <Button startIcon={<AddIcon />} onClick={() => setEditing("new")}>
          הוספת יום
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        חג וערב חג מקבלים את מקדם החג ונספרים כימי סוף שבוע באיזון. חול המועד לא מסומן; אפשר להוסיף אותו ידנית. יום זיכרון מסומן לידיעה בלבד.
      </Typography>
      {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
      {!days ? (
        <Loading />
      ) : days.length === 0 ? (
        <Alert severity="info">אין ימים מסומנים ל-{year}. לחץ על "טעינת חגי ישראל".</Alert>
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
                    <Chip size="small" color={CHIP_COLOR[d.day_type]} label={DAY_TYPE_LABEL[d.day_type]} />
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

const TABS = [
  { key: "catalog", label: "קטלוג תורנויות" },
  { key: "scoring", label: "מקדמי ניקוד" },
  { key: "calendar", label: "לוח חגים" },
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
    </Stack>
  );
}

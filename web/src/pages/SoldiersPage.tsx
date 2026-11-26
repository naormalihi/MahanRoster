import { FixRequestsDialog } from "../components/FixRequests";
import { DateTextField } from "../components/DateTextField";
import AddIcon from "@mui/icons-material/Add";
import { BulkRemoveDialog } from "../components/BulkRemoveDialog";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import SearchIcon from "@mui/icons-material/Search";
import UploadIcon from "@mui/icons-material/UploadFileOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { CardList, RowCard } from "../components/CardList";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDaysIso } from "../lib/cycles";
import { useNavigate, Link as RouterLink, useSearchParams } from "react-router-dom";
import type { NamedRef, ScoreCorrection } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isStaff } from "../lib/api";
import { accountLabel, type SoldierAccount } from "../lib/me";
import { InviteDialog } from "../components/InviteDialog";
import { NoAccountStrip } from "../components/NoAccountDialog";
import { AddSoldierDialog } from "../components/AddSoldierDialog";
import PersonAddIcon from "@mui/icons-material/PersonAddAlt1Outlined";
import { formatPhone, normalizePhone } from "../lib/phone";
import {
  activeLoadRole,
  activeLoadRoles,
  careerSwitch,
  todayIso,
  effectiveHomeNightly,
  effectiveParent,
  effectiveService,
  rangeState,
  tashHelp,
  TASH_LEVELS,
  type LoadRoleRef,
  type RangeState,
  type SoldierDetail,
  type SoldierLoadRole,
  type SoldierPatch,
} from "../lib/soldiers";
import type { Cycle, Exemption, ExemptionType } from "../lib/cycles";
import { currentCycle, currentScore, cycleScores, isPublished, nextCycle, summarize } from "../lib/lastCycle";
import { useLiveTick } from "../lib/live";

const SERVICE = { mandatory: "חובה", career: "קבע" } as const;
const RANGE_CHIP: Record<
  RangeState,
  { label: string; color: "default" | "error" | "warning" | "success" }
> = {
  missing: { label: "נחשב בתוקף", color: "default" },
  expired: { label: "פג", color: "error" },
  expiring: { label: "פג בקרוב", color: "warning" },
  valid: { label: "בתוקף", color: "success" },
};

const fmt = (iso: string | null) =>
  iso ? iso.split("-").reverse().join("/") : "—";
const ddmm = (iso: string) => iso.slice(5, 10).split("-").reverse().join("/");

/** A cell that stays at the start (right) while the table scrolls sideways. */
const stick = (offset: number) => ({ position: "sticky" as const, insetInlineStart: offset, zIndex: 2, bgcolor: "background.paper" });

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;

/** "ניקוד": the current score, its hand corrections (with who and why), and a new one – saved at once. */
function ScoreSection({ soldierId, score }: { soldierId: string; score: NonNullable<Parameters<typeof EditDialog>[0]["score"]> }) {
  const { api } = useAuth();
  const [form, setForm] = useState<{ how: "total" | "delta"; value: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = form ? Number(form.value.replace(",", ".")) : NaN;
  const delta = form && form.value.trim() !== "" && Number.isFinite(v) ? Math.round((form.how === "total" ? v - score.now : v) * 100) / 100 : null;

  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await f();
      score.onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", mb: 0.5 }}>
        <Typography variant="h3" sx={{ flex: 1 }}>
          ניקוד
        </Typography>
        {!form && (
          <Button size="small" startIcon={<EditIcon />} onClick={() => setForm({ how: "total", value: "", reason: "" })}>
            תיקון ניקוד
          </Button>
        )}
      </Stack>
      <Typography variant="body2">
        ניקוד נוכחי · {score.cycleName}: <b>{score.now.toFixed(1)}</b>
      </Typography>
      {score.corrections.map((c) => (
        <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
            <Box component="span" sx={{ fontWeight: 700, color: "warning.dark" }}>✎ {signed(c.points)}</Box> · {c.reason}
            <Typography component="span" variant="caption" color="text.secondary">
              {" "}· {c.cycle_name ?? ""} · {c.created_by_name ?? ""} · {new Date(c.created_at).toLocaleDateString("he-IL")}
            </Typography>
          </Typography>
          <Tooltip title="ביטול התיקון">
            <IconButton size="small" disabled={busy} aria-label="ביטול התיקון" onClick={() => void run(() => api!.deleteScoreCorrection(c.id))}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ))}
      {form && (
        <Stack spacing={1.5} sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
          <ToggleButtonGroup size="small" exclusive value={form.how} onChange={(_, h) => h && setForm({ ...form, how: h })}>
            <ToggleButton value="total">ניקוד נוכחי חדש</ToggleButton>
            <ToggleButton value="delta">תוספת / הפחתה</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            size="small"
            label={form.how === "total" ? "הניקוד הנוכחי יהיה" : "כמה להוסיף (מינוס להפחתה)"}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            slotProps={{ htmlInput: { inputMode: "decimal", dir: "ltr" } }}
            helperText={delta !== null ? (delta === 0 ? "בלי שינוי" : `תיקון של ${signed(delta)} · ${score.cycleName}`) : " "}
          />
          <TextField size="small" label="סיבה" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value.slice(0, 200) })} required />
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              disabled={busy || !delta || !form.reason.trim()}
              onClick={() =>
                void run(async () => {
                  await api!.addScoreCorrection(soldierId, score.cycleId, delta!, form.reason);
                  setForm(null);
                })
              }
            >
              שמירת התיקון
            </Button>
            <Button size="small" onClick={() => setForm(null)}>
              ביטול
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            נשמר מיד ונרשם ביומן. נספר בניקוד של המחזור, באיזון ובשיבוץ הבא, ובניקוד המצטבר של המחזורים הבאים.
          </Typography>
        </Stack>
      )}
      {!form && error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>
  );
}

function RangeChip({ until }: { until: string | null }) {
  const st = rangeState(until);
  const c = RANGE_CHIP[st];
  return (
    <Chip
      size="small"
      color={c.color}
      variant={st === "valid" ? "outlined" : "filled"}
      label={st === "missing" ? c.label : `${c.label} · ${fmt(until)}`}
    />
  );
}

function DateField(props: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  helperText?: string;
  disabled?: boolean;
}) {
  return (
    <DateTextField
      disabled={props.disabled}
      label={props.label}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value || null)}
      helperText={props.helperText}
      slotProps={{ inputLabel: { shrink: true } }}
      fullWidth
    />
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

function EditDialog(props: {
  soldier: SoldierDetail;
  ranks: NamedRef[];
  loadRoles: LoadRoleRef[];
  /** full – אחראי השיבוצים; admin – a gaf commander, his own people: phone, range and relief roles; view – read */
  mode: "full" | "admin" | "view";
  /** staff: the current score and its hand corrections */
  score?: { cycleId: string; cycleName: string; now: number; corrections: ScoreCorrection[]; onChanged: () => void };
  /** "צפייה כעובד": see the app as this employee (staff; a gaf commander – his own people) */
  onViewAs?: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAuth();
  const s = props.soldier;
  const full = props.mode === "full";
  const ro = props.mode === "view";
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  // taking him out of the unit: the day, and how many of his duties that drops
  const [leaving, setLeaving] = useState<{ from: string; duties: number } | null>(null);
  async function startLeaving(from = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" })) {
    const duties = await api!.futureDuties(s.id, from).catch(() => 0);
    setLeaving({ from, duties });
  }
  async function leave() {
    if (!leaving) return;
    setBusy(true);
    try {
      await api!.removeFromUnit(s.id, leaving.from);
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [p, setP] = useState<Required<SoldierPatch>>({
    range_valid_until: s.range_valid_until,
    appointment_rank_id: s.appointment_rank_id,
    appointment_rank_until: s.appointment_rank_until,
    is_shachar: s.is_shachar,
    shachar_start_date: s.shachar_start_date,
    parent_override: s.parent_override,
    parent_override_reason: s.parent_override_reason,
    parent_override_until: s.parent_override_until,
    second_role_signed_at: s.second_role_signed_at,
    career_start_date: s.career_start_date,
    home_nightly_override: s.home_nightly_override,
    home_nightly_override_reason: s.home_nightly_override_reason,
    home_nightly_override_until: s.home_nightly_override_until,
    tash_level: s.tash_level,
    phone: s.phone ?? null,
    unit_join_date: s.unit_join_date ?? null,
    is_active: s.is_active,
  });
  const [phoneText, setPhoneText] = useState(formatPhone(s.phone));
  const phone = normalizePhone(phoneText);
  const [roles, setRoles] = useState<
    Omit<SoldierLoadRole, "name" | "factor">[]
  >(
    s.load_roles.map(({ load_role_id, valid_from, valid_to }) => ({
      load_role_id,
      valid_from,
      valid_to,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SoldierPatch>(k: K, v: SoldierPatch[K]) =>
    setP((x) => ({ ...x, [k]: v }));

  const problems: string[] = [];
  if (phone === "invalid") problems.push("מספר הטלפון לא תקין – נייד ישראלי, למשל 050-1234567");
  if (p.parent_override !== null && !p.parent_override_reason?.trim())
    problems.push("שינוי ידני של משרת הורה מחייב סיבה");
  if (roles.some((r) => !r.load_role_id || !r.valid_from))
    problems.push("לכל תפקיד הקלה צריך סוג ותאריך התחלה");

  async function save() {
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    setError(null);
    try {
      const patch = {
        ...p,
        phone: phone === "invalid" ? p.phone : phone,
        parent_override_reason:
          p.parent_override === null ? null : p.parent_override_reason,
        home_nightly_override_reason:
          p.home_nightly_override === null
            ? null
            : p.home_nightly_override_reason,
      };
      if (full) {
        await api!.updateSoldiers([s.id], patch);
        await api!.setSoldierLoadRoles(s.id, roles);
      } else {
        await api!.updateSoldiersAdmin([s.id], { phone: patch.phone, range_valid_until: patch.range_valid_until });
        await api!.setSoldierLoadRolesAdmin(s.id, roles);
      }
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const parentChoice =
    p.parent_override === null ? "file" : p.parent_override ? "yes" : "no";

  return (
    <Dialog
      open
      onClose={props.onClose}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {s.full_name}
        <Typography variant="body2" color="text.secondary">
          {s.rank_name} · {s.gaf_name} · {SERVICE[effectiveService(s)]}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {!full && (
            <Alert severity="info" icon={false}>
              {ro
                ? "צפייה בלבד."
                : "כאן מעדכנים טלפון, מטווח ותפקידי הקלה. פטורים, ת\"ש, הקלות ושאר הפרטים – אצל אחראי השיבוצים."}
            </Alert>
          )}
          <TextField
            disabled={ro}
            label="טלפון נייד"
            value={phoneText}
            onChange={(e) => setPhoneText(e.target.value)}
            error={phone === "invalid"}
            helperText={phone === "invalid" ? "נייד ישראלי, למשל 050-1234567" : "כפתור הוואטסאפ בקודי ההצטרפות יפתח ישר את הצ׳אט שלו"}
            slotProps={{ htmlInput: { inputMode: "tel", dir: "ltr", autoComplete: "off" } }}
            fullWidth
          />
          <Divider />
          <Box>
            <Typography variant="h3" gutterBottom>
              מטווח
            </Typography>
            <DateField
              label="תוקף מטווח עד"
              disabled={ro}
              value={p.range_valid_until}
              onChange={(v) => set("range_valid_until", v)}
              helperText="ריק = בתוקף כברירת מחדל, כל עוד ההנחה מופעלת בהגדרות"
            />
          </Box>
          <Divider />
          {full && (
          <>
          <Box>
            <Typography variant="h3" gutterBottom>
              תאריך קליטה
            </Typography>
            <DateField
              label="תאריך קליטה"
              value={p.unit_join_date}
              onChange={(v) => set("unit_join_date", v)}
              helperText="עובד חדש: לא משובץ אוטומטית בתקופת החסד מתאריך הקליטה, ונכנס עם הניקוד הממוצע של הקבוצה שלו. ריק = לא חדש"
            />
          </Box>
          <Divider />
          <Box>
            <Typography variant="h3" gutterBottom>
              דרגת מינוי
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              במקום הדרגה המחושבת ({s.rank_name || "—"}), למשל מוביל 3 במינוי בכיר 1.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                select
                label="דרגת מינוי"
                value={p.appointment_rank_id ?? ""}
                onChange={(e) =>
                  set("appointment_rank_id", e.target.value || null)
                }
                fullWidth
              >
                <MenuItem value="">— ללא —</MenuItem>
                {props.ranks.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </TextField>
              <DateField
                label="בתוקף עד"
                value={p.appointment_rank_until}
                onChange={(v) => set("appointment_rank_until", v)}
              />
            </Stack>
          </Box>
          <Divider />
          <Box>
            <Typography variant="h3" gutterBottom>
              משרת הורה
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              לפי הקובץ: {s.parent_status ? "כן" : "לא"}. שינוי ידני גובר על
              הקובץ עד התאריך שנקבע.
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                select
                label="מקור"
                value={parentChoice}
                onChange={(e) =>
                  set(
                    "parent_override",
                    e.target.value === "file" ? null : e.target.value === "yes",
                  )
                }
              >
                <MenuItem value="file">לפי הקובץ</MenuItem>
                <MenuItem value="yes">משרת הורה – ידני</MenuItem>
                <MenuItem value="no">לא משרת הורה – ידני</MenuItem>
              </TextField>
              {p.parent_override !== null && (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <TextField
                    label="סיבה"
                    value={p.parent_override_reason ?? ""}
                    onChange={(e) =>
                      set("parent_override_reason", e.target.value)
                    }
                    fullWidth
                  />
                  <DateField
                    label="עד תאריך"
                    value={p.parent_override_until}
                    onChange={(v) => set("parent_override_until", v)}
                  />
                </Stack>
              )}
            </Stack>
          </Box>
          <Divider />
          <Box>
            <Typography variant="h3" gutterBottom>
              קבע ותפקיד שני
            </Typography>
            <Stack spacing={1.5}>
              <DateField
                label="תאריך כניסה לקבע"
                value={p.career_start_date}
                onChange={(v) => set("career_start_date", v)}
                helperText="נכנס לקבע באמצע מחזור: המחזור נחשב לפי רוב הימים (חובה או קבע), והוא משובץ רק בחלק הזה"
              />
              <DateField
                label="תאריך חתימה על המשך שירות קבע (תפקיד שני)"
                value={p.second_role_signed_at}
                onChange={(v) => set("second_role_signed_at", v)}
              />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ alignItems: { sm: "center" } }}
              >
                <FormControlLabel
                  control={
                    <Switch
                      checked={p.is_shachar}
                      onChange={(e) => set("is_shachar", e.target.checked)}
                    />
                  }
                  label="שח״ר"
                />
                <TextField
                  select
                  size="small"
                  label='זכאות הת"ש'
                  value={p.tash_level ?? ""}
                  onChange={(e) =>
                    set(
                      "tash_level",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                  helperText={tashHelp(p.tash_level)}
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value="">אין</MenuItem>
                  {TASH_LEVELS.map((n) => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Stack>
          </Box>
          <Divider />
          </>
          )}
          {props.score && <ScoreSection soldierId={s.id} score={props.score} />}
          <Box>
            <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
              <Typography variant="h3" sx={{ flex: 1 }}>
                תפקידי הקלה
              </Typography>
              <Button
                size="small"
                disabled={ro}
                startIcon={<AddIcon />}
                onClick={() =>
                  setRoles([
                    ...roles,
                    {
                      load_role_id: props.loadRoles[0]?.id ?? "",
                      valid_from: new Date().toISOString().slice(0, 10),
                      valid_to: null,
                    },
                  ])
                }
              >
                הוספה
              </Button>
            </Stack>
            {roles.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                אין. מקדם 1.0
              </Typography>
            )}
            <Stack spacing={1.5}>
              {roles.map((r, i) => (
                <Stack
                  key={i}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  sx={{ alignItems: { sm: "center" } }}
                >
                  <TextField
                    select
                    disabled={ro}
                    label="תפקיד"
                    value={r.load_role_id}
                    onChange={(e) =>
                      setRoles(
                        roles.map((x, j) =>
                          j === i ? { ...x, load_role_id: e.target.value } : x,
                        ),
                      )
                    }
                    sx={{ minWidth: 160 }}
                  >
                    {props.loadRoles.map((lr) => (
                      <MenuItem key={lr.id} value={lr.id}>
                        {lr.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <DateField
                    label="מתאריך"
                    disabled={ro}
                    value={r.valid_from}
                    onChange={(v) =>
                      setRoles(
                        roles.map((x, j) =>
                          j === i ? { ...x, valid_from: v ?? "" } : x,
                        ),
                      )
                    }
                  />
                  <IconButton
                    aria-label="מחיקה"
                    disabled={ro}
                    onClick={() => setRoles(roles.filter((_, j) => j !== i))}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          </Box>
          {full && (
          <>
          <Divider />
          {s.is_active ? (
            <Box>
              {!leaving ? (
                <Button color="error" variant="outlined" size="small" onClick={() => void startLeaving()}>
                  הוצאה מהיחידה
                </Button>
              ) : (
                <Alert severity="warning" icon={false}>
                  <Stack spacing={1.5}>
                    <Typography variant="body2">
                      מתאריך היציאה העובד לא פעיל.
                      {leaving.duties > 0
                        ? ` יש לו ${leaving.duties} משימות מאותו יום – הן יורדות ממנו ויסומנו כמשבצות שצריך לאייש (הוא יקבל עדכון).`
                        : " אין לו משימות מאותו יום."}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                      <DateTextField
                        size="small"
                        label="תאריך יציאה"
                        value={leaving.from}
                        onChange={(e) => void startLeaving(e.target.value)}
                        slotProps={{ inputLabel: { shrink: true } }}
                      />
                      <Button color="error" variant="contained" size="small" disabled={busy} onClick={() => void leave()}>
                        הוצאה
                      </Button>
                      <Button size="small" onClick={() => setLeaving(null)}>
                        ביטול
                      </Button>
                    </Stack>
                  </Stack>
                </Alert>
              )}
            </Box>
          ) : (
            <FormControlLabel control={<Switch checked={p.is_active} onChange={(e) => set("is_active", e.target.checked)} />} label="להחזיר ליחידה" />
          )}
          </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {props.onViewAs && (
          <Button data-read startIcon={<VisibilityIcon />} onClick={props.onViewAs} sx={{ me: "auto" }}>
            צפייה כעובד
          </Button>
        )}
        <Button onClick={props.onClose}>{ro ? "סגירה" : "ביטול"}</Button>
        {!ro && (
          <Button variant="contained" onClick={save} disabled={busy}>
            שמירה
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk range dialog
// ---------------------------------------------------------------------------

function BulkRangeDialog(props: {
  count: number;
  onClose: () => void;
  onApply: (date: string | null) => Promise<void>;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>עדכון תוקף מטווח ל-{props.count} עובדים</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <DateField
            label="תוקף מטווח עד"
            value={date}
            onChange={setDate}
            helperText="ריק = מחיקת התאריך"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await props.onApply(date);
          }}
        >
          עדכון
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SoldiersPage() {
  const live = useLiveTick();
  const { api, me, refresh } = useAuth();
  const navigate = useNavigate();
  // "צפייה כעובד": the app turns into his screens, read only, until "חזרה לחשבון שלי"
  const viewAs = async (id: string) => {
    try {
      await api!.viewAsStart(id);
      await refresh();
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const staffUser = isStaff(me);
  // a gaf commander updates phone, range, relief roles and join codes of his own framework's people
  const [commanded, setCommanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (staffUser) return;
    api!.myCommandedGafs().then((g) => setCommanded(new Set(g)), () => setCommanded(new Set()));
  }, [api, staffUser, live]);
  const manages = (s: { gaf_id: string }) => staffUser || commanded.has(s.gaf_id);
  const canManage = staffUser || commanded.size > 0;
  const [accounts, setAccounts] = useState<Map<string, SoldierAccount>>(new Map());
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  const loadAccounts = useCallback(async () => {
    if (!canManage) return;
    const a = await api!.soldierAccounts().catch(() => [] as SoldierAccount[]);
    setAccounts(new Map(a.map((x) => [x.soldier_id, x])));
  }, [api, canManage]);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts, live]);
  const [rows, setRows] = useState<SoldierDetail[] | null>(null);
  const [ranks, setRanks] = useState<NamedRef[]>([]);
  const [loadRoles, setLoadRoles] = useState<LoadRoleRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [gaf, setGaf] = useState("");
  // a link from "נתוני היחידה" opens a filter: ?service=career, ?range=expired, ?new=1
  const startParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [service, setService] = useState(startParams.get("service") ?? "");
  const [range, setRange] = useState(startParams.get("range") ?? "");
  // תאריך קליטה: new in the unit while the grace period runs
  const [graceDays, setGraceDays] = useState(90);
  const [onlyNew, setOnlyNew] = useState(startParams.get("new") === "1");
  useEffect(() => {
    api?.scoringSettings().then((x) => setGraceDays(x.grace_days), () => undefined);
  }, [api, live]);
  const newUntil = (s: SoldierDetail) => {
    if (!s.unit_join_date || !graceDays) return null;
    const last = addDaysIso(s.unit_join_date, graceDays - 1);
    return last >= todayIso() ? last : null;
  };
  const [rank, setRank] = useState("");
  const [relief, setRelief] = useState(""); // "" all · "any" · "none" · a load role id
  // exemptions from today on (approved and pending), shown like the relief roles
  const [exemptions, setExemptions] = useState<Exemption[]>([]);
  const [exTypes, setExTypes] = useState<ExemptionType[]>([]);
  const [exFilter, setExFilter] = useState(""); // "" all · "now" · "any" · "pending" · "none"
  const [showInactive, setShowInactive] = useState(false);
  // on a phone the filters and the score summary fold away, and the table becomes cards
  const narrow = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const activeFilters = [gaf, rank, relief, exFilter, service, range].filter(Boolean).length;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SoldierDetail | null>(null);
  // "?edit=<id>" (from "הוספת טלפון" elsewhere): open that soldier's card once the list is in
  const [params, setParams] = useSearchParams();
  // "לא נכון?" requests from employees: a chip by the name, and the dialog to handle them
  const [fixCount, setFixCount] = useState<Map<string, number>>(new Map());
  const [fixFor, setFixFor] = useState<string | null>(null);
  const loadFixes = useCallback(() => {
    if (!staffUser) return;
    api!
      .profileFixes()
      .then((l) => setFixCount(l.reduce((m, f) => m.set(f.soldier_id, (m.get(f.soldier_id) ?? 0) + 1), new Map<string, number>())))
      .catch(() => undefined);
  }, [api, staffUser]);
  useEffect(loadFixes, [loadFixes]);
  const fixParam = params.get("fix");
  useEffect(() => {
    if (!fixParam) return;
    setFixFor(fixParam);
    setParams((p) => (p.delete("fix"), p), { replace: true });
  }, [fixParam, setParams]);
  const editParam = params.get("edit");
  useEffect(() => {
    if (!editParam || !rows) return;
    const s = rows.find((x) => x.id === editParam);
    if (s) setEditing(s);
    setParams((p) => (p.delete("edit"), p), { replace: true });
  }, [editParam, rows, setParams]);
  const [bulk, setBulk] = useState(false);
  const [removing, setRemoving] = useState(false);
  // by today's date: the cycle today falls in (current) and the first one after it (next) –
  // points per soldier and who is in it
  type Ref = {
    cycle: Cycle;
    scores: Map<string, { points: number; duties: number }>;
    members: { soldier_id: string; group: string }[];
    ids: Set<string>;
  };
  const [cur, setCur] = useState<Ref | null>(null);
  const [nxt, setNxt] = useState<Ref | null>(null);
  // enters career inside the current or the next cycle
  const switchTag = (s: SoldierDetail) => {
    const sw = [cur?.cycle, nxt?.cycle].map((c) => (c ? careerSwitch(s.career_start_date, c.start_date, c.end_date) : null)).find(Boolean);
    return sw ? (
      <Chip size="small" variant="outlined" color="secondary" label={`עובר לקבע ${fmt(s.career_start_date)}`}
        title={sw.service === "career" ? "רוב המחזור בקבע – משובץ רק מהתאריך" : "רוב המחזור בחובה – משובץ רק עד התאריך"} />
    ) : null;
  };

  const load = useCallback(async () => {
    try {
      const horizon = new Date(Date.now() + 365 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const [s, r, lr, ex, et] = await Promise.all([
        api!.soldierDetails(),
        api!.ranks(),
        api!.loadRoles(),
        api!.exemptions(todayIso(), horizon),
        api!.exemptionTypes(),
      ]);
      setRows(s);
      setRanks(r);
      setLoadRoles(lr);
      setExemptions(
        ex.filter((e) => e.status === "approved" || e.status === "pending"),
      );
      setExTypes(et);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load, live]);

  useEffect(() => {
    const loadRef = async (c: Cycle | undefined): Promise<Ref | null> => {
      if (!c) return null;
      const [as, sn] = await Promise.all([api!.draftAssignments(c.id), api!.snapshotSoldiers(c.id)]);
      const scores = cycleScores(as);
      const members = sn.map((x) => ({ soldier_id: x.soldier_id, group: x.service_type === "career" ? "קבע" : "חובה" }));
      return { cycle: c, scores, members, ids: new Set([...members.map((m) => m.soldier_id), ...scores.keys()]) };
    };
    (async () => {
      const cycles = await api!.cycles();
      const today = todayIso();
      const [c, n] = await Promise.all([loadRef(currentCycle(cycles, today)), loadRef(nextCycle(cycles, today))]);
      setCur(c);
      setNxt(n);
    })().catch(() => {
      setCur(null);
      setNxt(null);
    });
  }, [api, live]);
  // hand corrections (staff): counted in the current score of the cycle they were given for
  const [corrections, setCorrections] = useState<ScoreCorrection[]>([]);
  const loadCorrections = useCallback(() => {
    if (!staffUser) return;
    api!.scoreCorrections().then(setCorrections, () => setCorrections([]));
  }, [api, staffUser]);
  useEffect(loadCorrections, [loadCorrections, live]);
  const correctionOf = (id: string, cycleId?: string) =>
    cycleId ? corrections.filter((c) => c.soldier_id === id && c.cycle_id === cycleId).reduce((t, c) => t + c.points, 0) : 0;
  // between cycles there is no current one: a correction given for the next cycle is the score to start from
  const nowScore = (s: SoldierDetail) =>
    cur
      ? currentScore(s.opening_score, cur.scores.get(s.id), cur.ids.has(s.id), correctionOf(s.id, cur.cycle.id))
      : currentScore(s.opening_score, undefined, false, correctionOf(s.id, nxt?.cycle.id));
  /** the next cycle: its duties, and the corrections given for it */
  const nextScore = (s: SoldierDetail) => {
    if (!nxt) return null;
    const correction = correctionOf(s.id, nxt.cycle.id);
    if (!nxt.ids.has(s.id) && !correction) return null;
    const d = nxt.scores.get(s.id);
    return { points: (d?.points ?? 0) + correction, duties: d?.duties ?? 0, correction };
  };
  const groupOf = (s: SoldierDetail) => (s.service_type === "career" ? "קבע" : "חובה");
  // a duty on a holiday or its eve, from a year back to a year ahead (published cycles)
  const [holidayDuty, setHolidayDuty] = useState<
    Map<string, { day: string; task_name: string }>
  >(new Map());
  useEffect(() => {
    const since = new Date(Date.now() - 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    api!
      .recentHolidayDuties(since)
      .then((l) => setHolidayDuty(new Map(l.map((h) => [h.soldier_id, h]))))
      .catch(() => setHolidayDuty(new Map()));
  }, [api]);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null,
  );

  const gafim = useMemo(
    () => [...new Set((rows ?? []).map((s) => s.gaf_name))].sort(),
    [rows],
  );
  const rankName = useMemo(
    () => new Map(ranks.map((r) => [r.id, r.name])),
    [ranks],
  );
  // a rank appointment in force counts as the soldier's rank too (סרן במינוי רס"ן appears under both)
  const today = todayIso();
  const exTypeName = useMemo(
    () => new Map(exTypes.map((t) => [t.id, t.name])),
    [exTypes],
  );
  const exBySoldier = useMemo(() => {
    const m = new Map<string, Exemption[]>();
    for (const e of exemptions)
      m.set(e.soldier_id, [...(m.get(e.soldier_id) ?? []), e]);
    return m;
  }, [exemptions]);
  const homeNightlyType = useMemo(
    () => new Set(exTypes.filter((t) => t.home_nightly).map((t) => t.id)),
    [exTypes],
  );
  const tashBy = (s: SoldierDetail) =>
    s.tash_level === 7 ||
    effectiveHomeNightly(s) ||
    (exBySoldier.get(s.id) ?? []).some(
      (e) =>
        e.status === "approved" &&
        homeNightlyType.has(e.exemption_type_id) &&
        e.start_date <= today &&
        e.end_date >= today,
    );
  const exMatch = (id: string) => {
    const l = exBySoldier.get(id) ?? [];
    if (exFilter === "now")
      return l.some((e) => e.status === "approved" && e.start_date <= today);
    if (exFilter === "any") return l.length > 0;
    if (exFilter === "pending") return l.some((e) => e.status === "pending");
    if (exFilter === "none") return l.length === 0;
    return true;
  };
  const appointedNow = (s: SoldierDetail) =>
    !!s.appointment_rank_id &&
    (!s.appointment_rank_until || s.appointment_rank_until >= todayIso());
  // ranks present among the soldiers, in the catalog's order
  const rankOptions = useMemo(() => {
    const present = new Set(
      (rows ?? []).flatMap((s) => [
        s.rank_name,
        appointedNow(s) ? rankName.get(s.appointment_rank_id!) : undefined,
      ]),
    );
    return ranks.map((r) => r.name).filter((n) => present.has(n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ranks, rankName]);

  const shown = (rows ?? []).filter(
    (s) =>
      (showInactive || s.is_active) &&
      (!q || s.full_name.includes(q.trim())) &&
      (!gaf || s.gaf_name === gaf) &&
      (!service || effectiveService(s) === service) &&
      (!rank ||
        s.rank_name === rank ||
        (appointedNow(s) && rankName.get(s.appointment_rank_id!) === rank)) &&
      exMatch(s.id) &&
      (!relief ||
        (relief === "any"
          ? activeLoadRoles(s).length > 0
          : relief === "none"
            ? activeLoadRoles(s).length === 0
            : activeLoadRoles(s).some((r) => r.load_role_id === relief))) &&
      (!onlyNew || newUntil(s) !== null) &&
      (!range ||
        (range === "issues"
          ? ["expired", "expiring"].includes(rangeState(s.range_valid_until))
          : rangeState(s.range_valid_until) === range)),
  );
  // sortable columns: what each sorts by, and which way the first click goes
  const rankOrder = new Map(ranks.map((r, i) => [r.name, i]));
  const columns: {
    label: string;
    key?: string;
    by?: (s: SoldierDetail) => string | number;
    first?: "asc" | "desc";
  }[] = [
    { label: "שם", key: "name", by: (s) => s.full_name },
    {
      label: "דרגה",
      key: "rank",
      by: (s) => rankOrder.get(s.rank_name) ?? -1,
      first: "desc",
    },
    { label: "מסגרת", key: "gaf", by: (s) => s.gaf_name },
    { label: "שירות", key: "service", by: (s) => effectiveService(s) },
    { label: "תום שירות", key: "release", by: (s) => s.release_date ?? "9999" },
    { label: "תאריך קליטה", key: "join", by: (s) => s.unit_join_date ?? "" },
    { label: "כניסה לקבע", key: "career", by: (s) => s.career_start_date ?? "" },
    {
      label: "ת״ש",
      key: "tash",
      by: (s) => (tashBy(s) ? 7 : (s.tash_level ?? 0)),
      first: "desc",
    },
    {
      label: `ניקוד נוכחי${cur ? ` · ${cur.cycle.name}` : " · אין מחזור פעיל"}`,
      key: "score_now",
      by: (s) => nowScore(s)?.points ?? -1,
      first: "desc",
    },
    {
      label: nxt ? `ניקוד עתידי · ${nxt.cycle.name}${isPublished(nxt.cycle) ? "" : " (טיוטה)"}` : "ניקוד עתידי",
      key: "score_next",
      by: (s) => nextScore(s)?.points ?? -1,
      first: "desc",
    },
    {
      label: "משימת חג",
      key: "holiday",
      by: (s) => holidayDuty.get(s.id)?.day ?? "",
      first: "desc",
    },
    { label: "מטווח", key: "range", by: (s) => s.range_valid_until ?? "" },
    {
      label: "הורה",
      key: "parent",
      by: (s) => (effectiveParent(s) ? 1 : 0),
      first: "desc",
    },
    { label: "הקלה", key: "relief", by: (s) => activeLoadRole(s)?.factor ?? 2 },
    {
      label: "פטורים",
      key: "exemptions",
      by: (s) => (exBySoldier.get(s.id) ?? []).length,
      first: "desc",
    },
    {
      label: "תפקיד שני",
      key: "second",
      by: (s) => s.second_role_signed_at ?? "",
    },
    ...(canManage
      ? [
          {
            label: "חשבון",
            key: "account",
            by: (s: SoldierDetail) => (accounts.get(s.id)?.username ? 2 : accounts.get(s.id)?.invite_state === "open" ? 1 : 0),
            first: "desc" as const,
          },
        ]
      : []),
  ];
  const sortCol = sort && columns.find((c) => c.key === sort.key);
  if (sortCol?.by) {
    const by = sortCol.by;
    const sign = sort!.dir === "asc" ? 1 : -1;
    shown.sort((a, b) => {
      const x = by(a),
        y = by(b);
      const c =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "he");
      return sign * c || a.full_name.localeCompare(b.full_name, "he");
    });
  }
  const selectable = shown.filter(manages);
  const allSelected =
    selectable.length > 0 && selectable.every((s) => selected.has(s.id));
  const counts = useMemo(() => {
    const active = (rows ?? []).filter((s) => s.is_active);
    return {
      active: active.length,
      mandatory: active.filter((s) => effectiveService(s) === "mandatory")
        .length,
      career: active.filter((s) => effectiveService(s) === "career").length,
      rangeIssues: active.filter((s) =>
        ["expired", "expiring"].includes(rangeState(s.range_valid_until)),
      ).length,
      newcomers: active.filter((s) => newUntil(s) !== null).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, graceDays]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}
      >
        {/* on a phone the title has its own line and the buttons go under it */}
        <Typography variant="h1" sx={{ flex: { xs: "1 0 100%", sm: 1 }, whiteSpace: "nowrap" }}>
          כוח אדם
        </Typography>
        {staffUser && (
          <Button variant="outlined" startIcon={<PersonAddIcon />} onClick={() => setAdding(true)}>
            הוספת עובד
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={<UploadIcon />}
          component={RouterLink}
          to="/soldiers/import"
        >
          טעינת כוח אדם
        </Button>
      </Stack>
      {added && (
        <Alert
          severity="success"
          onClose={() => setAdded(null)}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setSelected(new Set([added.id]));
                setInviting(true);
              }}
            >
              קוד הצטרפות
            </Button>
          }
        >
          {added.name} נוסף לכוח האדם.
        </Alert>
      )}
      {rows && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          {/* each count is a filter; a second click (or "פעילים") clears it */}
          <Chip
            label={`פעילים: ${counts.active}`}
            color={!service && !range ? "primary" : "default"}
            onClick={() => {
              setService("");
              setRange("");
              setShowInactive(false);
            }}
          />
          <Chip
            label={`חובה: ${counts.mandatory}`}
            color={service === "mandatory" ? "primary" : "default"}
            onClick={() =>
              setService(service === "mandatory" ? "" : "mandatory")
            }
          />
          <Chip
            label={`קבע: ${counts.career}`}
            color={service === "career" ? "primary" : "default"}
            onClick={() => setService(service === "career" ? "" : "career")}
          />
          {counts.rangeIssues > 0 && (
            <Chip
              color="warning"
              variant={range === "issues" ? "filled" : "outlined"}
              label={`מטווח פג או עומד לפוג: ${counts.rangeIssues}`}
              onClick={() => setRange(range === "issues" ? "" : "issues")}
            />
          )}
          {counts.newcomers > 0 && (
            <Chip
              color="info"
              variant={onlyNew ? "filled" : "outlined"}
              label={`חדשים ביחידה: ${counts.newcomers}`}
              onClick={() => setOnlyNew(!onlyNew)}
            />
          )}
        </Stack>
      )}

      <Paper sx={{ p: 2 }}>
        {narrow && (
          <Stack direction="row" spacing={1} sx={{ mb: filtersOpen ? 1.5 : 0, alignItems: "center" }}>
            <TextField
              sx={{ flex: 1 }}
              size="small"
              placeholder="חיפוש לפי שם"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button data-read variant={activeFilters ? "contained" : "outlined"} startIcon={<TuneIcon />} onClick={() => setFiltersOpen(!filtersOpen)}>
              סינון{activeFilters ? ` (${activeFilters})` : ""}
            </Button>
          </Stack>
        )}
        <Collapse in={!narrow || filtersOpen} unmountOnExit={false}>
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: {
              xs: "1fr 1fr",
              sm: "repeat(3, 1fr)",
              md: "2fr repeat(6, 1fr)",
            },
          }}
        >
          <TextField
            sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, display: narrow ? "none" : undefined }}
            placeholder="חיפוש לפי שם"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            select
            label="מסגרת"
            value={gaf}
            onChange={(e) => setGaf(e.target.value)}
          >
            <MenuItem value="">כל המסגרות</MenuItem>
            {gafim.map((g) => (
              <MenuItem key={g} value={g}>
                {g}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="דרגה"
            value={rank}
            onChange={(e) => setRank(e.target.value)}
          >
            <MenuItem value="">כל הדרגות</MenuItem>
            {rankOptions.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="הקלה"
            value={relief}
            onChange={(e) => setRelief(e.target.value)}
          >
            <MenuItem value="">הכול</MenuItem>
            <MenuItem value="any">עם הקלה</MenuItem>
            <MenuItem value="none">בלי הקלה</MenuItem>
            {loadRoles.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="פטור"
            value={exFilter}
            onChange={(e) => setExFilter(e.target.value)}
          >
            <MenuItem value="">הכול</MenuItem>
            <MenuItem value="now">בפטור היום</MenuItem>
            <MenuItem value="any">עם פטור</MenuItem>
            <MenuItem value="pending">ממתין לאישור</MenuItem>
            <MenuItem value="none">בלי פטור</MenuItem>
          </TextField>
          <TextField
            select
            label="שירות"
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            <MenuItem value="">הכול</MenuItem>
            <MenuItem value="mandatory">חובה</MenuItem>
            <MenuItem value="career">קבע</MenuItem>
          </TextField>
          <TextField
            select
            label="מטווח"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <MenuItem value="">הכול</MenuItem>
            <MenuItem value="missing">לא הוזן</MenuItem>
            <MenuItem value="expired">פג</MenuItem>
            <MenuItem value="expiring">פג בקרוב</MenuItem>
            <MenuItem value="issues">פג או פג בקרוב</MenuItem>
            <MenuItem value="valid">בתוקף</MenuItem>
          </TextField>
        </Box>
        </Collapse>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ mt: 1.5, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        >
          <FormControlLabel
            data-read
            control={
              <Switch
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
            }
            label="הצגת לא פעילים"
          />
          <Box sx={{ flex: 1 }} />
          {selected.size > 0 && !narrow && (
            <>
              <Typography variant="body2">נבחרו {selected.size}</Typography>
              <Button data-read variant="contained" onClick={() => setBulk(true)}>
                עדכון מטווח לנבחרים
              </Button>
              <Button data-read variant="outlined" onClick={() => setInviting(true)}>
                קודי הצטרפות
              </Button>
              {staffUser && (
                <Button data-read color="error" variant="outlined" onClick={() => setRemoving(true)}>
                  מחיקת הנבחרים
                </Button>
              )}
              <Button data-read onClick={() => setSelected(new Set())}>
                ניקוי בחירה
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      {narrow && selected.size > 0 && (
        // on a phone the bar stays at the bottom while scrolling – the choice is seen
        <Paper
          elevation={8}
          sx={{ position: "fixed", insetInline: 0, bottom: 0, zIndex: (t) => t.zIndex.appBar, px: 1.5, pt: 1, pb: "calc(8px + env(safe-area-inset-bottom))", borderRadius: 0 }}
        >
          {/* two lines: how many and "ניקוי", then the actions in even widths – they do not fit one line */}
          <Stack direction="row" sx={{ alignItems: "center", mb: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
              נבחרו {selected.size}
            </Typography>
            <Button data-read size="small" onClick={() => setSelected(new Set())}>
              ניקוי הבחירה
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ "& > *": { flex: 1, whiteSpace: "nowrap", minWidth: 0 } }}>
            <Button data-read size="small" variant="contained" onClick={() => setBulk(true)}>
              עדכון מטווח
            </Button>
            <Button data-read size="small" variant="outlined" onClick={() => setInviting(true)}>
              קודי הצטרפות
            </Button>
            {staffUser && (
              <Button data-read size="small" color="error" variant="outlined" onClick={() => setRemoving(true)}>
                מחיקה
              </Button>
            )}
          </Stack>
        </Paper>
      )}
      {/* a gaf commander: his people with duties and no account – a WhatsApp each (אחראי השיבוצים has it in operations) */}
      {!staffUser && canManage && (() => {
        const pub = [cur?.cycle, nxt?.cycle].find((c) => c && isPublished(c));
        return pub ? <NoAccountStrip cycleId={pub.id} /> : null;
      })()}
      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {rows && rows.length === 0 && (
        <Alert severity="info">
          אין עדיין עובדים. טען קובץ כוח אדם במסך "כוח אדם".
        </Alert>
      )}

      {rows && rows.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          {narrow && (
            <Box
              data-read
              component="button"
              type="button"
              onClick={() => setSummaryOpen(!summaryOpen)}
              sx={{ all: "unset", display: "flex", width: "100%", alignItems: "center", cursor: "pointer" }}
            >
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                ניקוד לפי אוכלוסייה – נוכחי ועתידי
              </Typography>
              <ExpandMoreIcon sx={{ transform: summaryOpen ? "rotate(180deg)" : "none", transition: "transform .2s", color: "text.secondary" }} />
            </Box>
          )}
          <Collapse in={!narrow || summaryOpen}>
          <Typography variant="subtitle2" sx={{ mt: narrow ? 1 : 0 }}>
            ניקוד נוכחי – {cur ? cur.cycle.name : "אין מחזור פעיל"}
          </Typography>
          {cur ? (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 2, mt: 0.5 }}>
              {summarize(
                rows.filter((s) => s.is_active && cur.ids.has(s.id)).map((s) => ({ soldier_id: s.id, group: groupOf(s) })),
                new Map(rows.map((s) => [s.id, { points: nowScore(s)?.points ?? 0 }])),
              ).map((g) => (
                <Typography key={g.key} variant="body2">
                  <b>{g.key}</b> ({g.n}): ממוצע <b>{g.mean.toFixed(1)}</b> נק׳ · טווח {g.min.toFixed(1)}–{g.max.toFixed(1)}
                  {g.zero ? ` · ${g.zero} בלי משימה` : ""}
                </Typography>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              היום לא נופל באף מחזור – בעמודה מופיע רק ניקוד הפתיחה של עובדים חדשים.
            </Typography>
          )}
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            ניקוד עתידי – {nxt ? `${nxt.cycle.name}${isPublished(nxt.cycle) ? "" : " (טיוטה)"}` : "אין מחזור הבא"}
          </Typography>
          {nxt && (
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 2, mt: 0.5 }}>
              {summarize(
                nxt.members.length ? nxt.members : rows.filter((s) => s.is_active && nxt.ids.has(s.id)).map((s) => ({ soldier_id: s.id, group: groupOf(s) })),
                new Map(rows.map((s) => [s.id, { points: nextScore(s)?.points ?? 0 }])),
              ).map((g) => (
                <Typography key={g.key} variant="body2">
                  <b>{g.key}</b> ({g.n}): ממוצע <b>{g.mean.toFixed(1)}</b> נק׳ · טווח {g.min.toFixed(1)}–{g.max.toFixed(1)}
                  {g.zero ? ` · ${g.zero} בלי משימה` : ""}
                </Typography>
              ))}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            לפי התאריך של היום. נוכחי = ניקוד פתיחה (לעובדים חדשים) ועוד המשימות במחזור שהיום בתוכו; עתידי = המחזור הבא. ניקוד = סכום
            הנקודות של המשימות שבלוח (בלי עתודות). פירוט לפי קבוצות הוגנות – במסך הטיוטה של המחזור.
          </Typography>
          </Collapse>
        </Paper>
      )}

      {rows && rows.length > 0 && narrow && (
        <>
          {/* the phone's "select all" – as the table's header box: every one shown that can be updated */}
          {canManage && selectable.length > 0 && (
            <Box data-read sx={{ display: "flex", alignItems: "center", px: 0.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={!allSelected && selectable.some((s) => selected.has(s.id))}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((s) => s.id)))}
                  />
                }
                label={<Typography variant="body2">{allSelected ? `נבחרו כל ${selectable.length}` : `בחירת כל ${selectable.length} המוצגים`}</Typography>}
              />
            </Box>
          )}
          <CardList>
            {shown.map((s) => {
              const lr = activeLoadRole(s);
              const appointed = s.appointment_rank_id && (!s.appointment_rank_until || s.appointment_rank_until >= today);
              const n = nowScore(s);
              const a = manages(s) ? accountLabel(accounts.get(s.id), todayIso()) : null;
              const h = holidayDuty.get(s.id);
              return (
                <RowCard
                  key={s.id}
                  dim={!s.is_active}
                  onClick={() => setEditing(s)}
                  lead={
                    !manages(s) ? undefined : (
                    // the whole strip beside the card selects (a finger is wider than the box); the rest opens
                    <Box
                      data-read
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(s.id);
                      }}
                      sx={{ alignSelf: "stretch", minWidth: 44, my: -1.25, ms: -1.5, display: "flex", justifyContent: "center", pt: 1, cursor: "pointer" }}
                    >
                      <Checkbox
                        size="small"
                        sx={{ p: 0.25, height: "fit-content" }}
                        checked={selected.has(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(s.id)}
                        slotProps={{ input: { "aria-label": `בחירת ${s.full_name}` } }}
                      />
                    </Box>
                    )
                  }
                  title={s.full_name}
                  chips={
                    <>
                      {tashBy(s) ? <Chip size="small" variant="outlined" label="ת״ש 7" /> : s.tash_level ? <Chip size="small" variant="outlined" label={`הת״ש ${s.tash_level}`} /> : null}
                      {a && a.tone !== "default" && <Chip size="small" variant="outlined" color={a.tone} label={a.text} />}
                      {newUntil(s) && <Chip size="small" variant="outlined" color="info" label={`חדש עד ${fmt(newUntil(s))}`} />}
                      {fixCount.get(s.id) ? (
                        <Chip size="small" color="warning" label="בקשת תיקון" onClick={(e) => (e.stopPropagation(), setFixFor(s.id))} />
                      ) : null}
                      {s.service_switch_at && (
                        <Tooltip title={`מ-${fmt(s.service_switch_at)} הניקוד הקודם הוא ממוצע ה${s.service_switch_to === "career" ? "קבע" : "חובה"} (${Number(s.service_switch_score ?? 0).toFixed(1)}) – הניקוד מהשירות הקודם לא נספר`}>
                          <Chip size="small" variant="outlined" color="info" label={`עבר ל${s.service_switch_to === "career" ? "קבע" : "חובה"} – ניקוד הותאם`} />
                        </Tooltip>
                      )}
                      {switchTag(s)}
                    </>
                  }
                  sub={
                    <>
                      {s.rank_name}
                      {appointed ? ` (מינוי ${rankName.get(s.appointment_rank_id!)})` : ""} · {s.gaf_name} · {SERVICE[effectiveService(s)]}
                      {s.release_date ? ` · תום שירות ${fmt(s.release_date)}` : ""}
                      {s.unit_join_date ? ` · נקלט ${fmt(s.unit_join_date)}` : ""}
                      {s.career_start_date ? ` · קבע מ-${fmt(s.career_start_date)}` : ""}
                    </>
                  }
                  lines={[
                    <>
                      ניקוד <b>{n ? n.points.toFixed(1) : "—"}</b>
                      {n ? ` (${n.opening ? (n.duties ? `פתיחה + ${n.duties} משימות` : "פתיחה") : `${n.duties} משימות`}${n.correction ? ` · ✎ ${signed(n.correction)}` : ""})` : ""}
                      {nextScore(s) ? ` · הבא ${nextScore(s)!.points.toFixed(1)}` : ""}
                      {h ? ` · ${h.day <= today ? "ביצע" : "משובץ"} משימת חג` : ""}
                    </>,
                    (
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.25 }} component="span">
                        <RangeChip until={s.range_valid_until} />
                        {s.range_self_updated_at && (
                          <Tooltip title={`העובד עדכן בעצמו ב-${fmt(s.range_self_updated_at.slice(0, 10))}`}>
                            <Chip size="small" variant="outlined" label='עודכן ע"י העובד' sx={{ ms: 0.5 }} />
                          </Tooltip>
                        )}
                        {activeLoadRoles(s).map((r) => (
                          <Chip key={r.load_role_id + r.valid_from} size="small" label={`${r.name} ×${r.factor}`} color={r.load_role_id === lr?.load_role_id ? "primary" : "default"} variant={r.load_role_id === lr?.load_role_id ? "filled" : "outlined"} />
                        ))}
                        {(exBySoldier.get(s.id) ?? []).map((e) => {
                          const now = e.start_date <= today;
                          const pending = e.status === "pending";
                          const type = exTypeName.get(e.exemption_type_id) ?? "פטור";
                          return (
                            <Chip
                              key={e.id}
                              size="small"
                              label={`${type}${e.kind === "partial" ? " (חלקי)" : ""} · ${now ? `עד ${ddmm(e.end_date)}` : `מ-${ddmm(e.start_date)}`}${pending ? " · ממתין" : ""}`}
                              color={pending ? "warning" : now ? "info" : "default"}
                              variant={now && !pending ? "filled" : "outlined"}
                            />
                          );
                        })}
                      </Stack>
                    ),
                  ]}
                />
              );
            })}
          </CardList>
          {selected.size > 0 && <Box sx={{ height: 110 }} />}
          <Typography variant="caption" color="text.secondary">
            מוצגים {shown.length} מתוך {rows.length}. לחיצה על עובד פותחת עריכה; סימון בתיבה – לפעולות על כמה עובדים.
          </Typography>
        </>
      )}

      {rows && rows.length > 0 && !narrow && (
        <Paper sx={{ overflow: "hidden" }}>
          <Box sx={{ overflowX: "auto", maxHeight: "70vh" }}>
            <Table size="small" stickyHeader sx={{ minWidth: 1180 }}>
              <TableHead>
                <TableRow>
                  {canManage && (
                  <TableCell padding="checkbox" data-read sx={{ ...stick(0), zIndex: 4 }}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={
                        !allSelected && selectable.some((s) => selected.has(s.id))
                      }
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(selectable.map((s) => s.id)),
                        )
                      }
                      slotProps={{
                        input: { "aria-label": "בחירת כל המוצגים" },
                      }}
                    />
                  </TableCell>
                  )}
                  {columns.map((c, i) => {
                    const on = !!c.key && sort?.key === c.key;
                    return (
                      <TableCell
                        key={i}
                        sortDirection={on ? sort!.dir : false}
                        sx={{ whiteSpace: "nowrap", ...(i === 0 && { ...stick(canManage ? 48 : 0), zIndex: 4, borderInlineEnd: 1, borderInlineEndColor: "divider" }) }}
                      >
                        {c.key ? (
                          <TableSortLabel
                            active={on}
                            direction={on ? sort!.dir : (c.first ?? "asc")}
                            onClick={() =>
                              setSort(
                                sort && sort.key === c.key
                                  ? sort.dir === (c.first ?? "asc")
                                    ? {
                                        key: c.key!,
                                        dir:
                                          sort.dir === "asc" ? "desc" : "asc",
                                      }
                                    : null // third click: back to the default order
                                  : { key: c.key!, dir: c.first ?? "asc" },
                              )
                            }
                          >
                            {c.label}
                          </TableSortLabel>
                        ) : (
                          c.label
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((s) => {
                  const lr = activeLoadRole(s);
                  const appointed =
                    s.appointment_rank_id &&
                    (!s.appointment_rank_until ||
                      s.appointment_rank_until >=
                        new Date().toISOString().slice(0, 10));
                  return (
                    <TableRow
                      key={s.id}
                      hover
                      selected={selected.has(s.id)}
                      onClick={() => setEditing(s)}
                      sx={{ opacity: s.is_active ? 1 : 0.5, cursor: "pointer" }}
                    >
                      {canManage && (
                      <TableCell padding="checkbox" data-read onClick={(e) => e.stopPropagation()} sx={stick(0)}>
                        {manages(s) && (
                        <Checkbox
                          checked={selected.has(s.id)}
                          onChange={() => toggle(s.id)}
                          slotProps={{
                            input: { "aria-label": `בחירת ${s.full_name}` },
                          }}
                        />
                        )}
                      </TableCell>
                      )}
                      <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap", ...stick(canManage ? 48 : 0), borderInlineEnd: 1, borderInlineEndColor: "divider" }}>
                        {/* the name stays in sight when the table scrolls sideways; the pencil with it */}
                        <IconButton
                          data-read
                          size="small"
                          aria-label={`עריכת ${s.full_name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(s);
                          }}
                          sx={{ ml: 0.5, p: 0.25 }}
                        >
                          <EditIcon sx={{ fontSize: 17 }} />
                        </IconButton>
                        {manages(s) && (
                          <IconButton
                            data-read
                            size="small"
                            aria-label={`צפייה כ${s.full_name}`}
                            title="צפייה כעובד – מה הוא רואה באפליקציה"
                            onClick={(e) => {
                              e.stopPropagation();
                              void viewAs(s.id);
                            }}
                            sx={{ ml: 0.5, p: 0.25 }}
                          >
                            <VisibilityIcon sx={{ fontSize: 17 }} />
                          </IconButton>
                        )}
                        {s.full_name}
                        {fixCount.get(s.id) ? (
                          <Chip size="small" color="warning" label="בקשת תיקון" onClick={() => setFixFor(s.id)} sx={{ ml: 0.5 }} />
                        ) : null}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {s.rank_name}
                        {appointed && (
                          <Typography
                            component="span"
                            variant="caption"
                            color="secondary.main"
                          >
                            {" "}
                            (מינוי {rankName.get(s.appointment_rank_id!)})
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {s.gaf_name}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {SERVICE[effectiveService(s)]} {switchTag(s)}
                      </TableCell>
                      <TableCell
                        sx={{
                          whiteSpace: "nowrap",
                          color:
                            s.release_date && s.release_date < today
                              ? "text.disabled"
                              : undefined,
                        }}
                      >
                        {fmt(s.release_date)}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {fmt(s.unit_join_date ?? null)}
                        {newUntil(s) && (
                          <Chip size="small" color="info" variant="outlined" label={`חדש עד ${fmt(newUntil(s))}`} sx={{ ml: 0.5 }} />
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{fmt(s.career_start_date ?? null)}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {tashBy(s) ? (
                          <Chip size="small" variant="outlined" label="ת״ש 7" />
                        ) : s.tash_level ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`הת״ש ${s.tash_level}`}
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {(() => {
                          const n = nowScore(s);
                          if (!n) return "—";
                          const note = n.opening
                            ? n.duties
                              ? `פתיחה ${n.opening.toFixed(1)} + ${n.duties} משימות`
                              : "ניקוד פתיחה"
                            : `${n.duties} משימות`;
                          return (
                            <>
                              <b>{n.points.toFixed(1)}</b>
                              <Typography component="span" variant="caption" color="text.secondary">
                                {" "}· {note}
                              </Typography>
                              {n.correction !== 0 && (
                                <Typography component="span" variant="caption" sx={{ color: "warning.dark", fontWeight: 600 }} title="כולל תיקון ידני">
                                  {" "}· ✎ {signed(n.correction)}
                                </Typography>
                              )}
                            </>
                          );
                        })()}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {(() => {
                          const x = nextScore(s);
                          if (!x) return "—";
                          return (
                            <>
                              <b>{x.points.toFixed(1)}</b>
                              <Typography component="span" variant="caption" color="text.secondary">
                                {" "}· {x.duties} משימות
                              </Typography>
                              {x.correction !== 0 && (
                                <Typography component="span" variant="caption" sx={{ color: "warning.dark", fontWeight: 600 }} title="כולל תיקון ידני">
                                  {" "}· ✎ {signed(x.correction)}
                                </Typography>
                              )}
                            </>
                          );
                        })()}
                      </TableCell>
                      <TableCell align="center">
                        {holidayDuty.has(s.id) &&
                          (() => {
                            const h = holidayDuty.get(s.id)!;
                            const done = h.day <= today;
                            return (
                              <Tooltip title={`${done ? "ביצע" : "משובץ"}: ${h.task_name} · ${fmt(h.day)}`}>
                                <CheckIcon
                                  color={done ? "success" : "primary"}
                                  fontSize="small"
                                  aria-label={done ? "ביצע משימת חג" : "משובץ למשימת חג"}
                                />
                              </Tooltip>
                            );
                          })()}
                      </TableCell>
                      <TableCell>
                        <RangeChip until={s.range_valid_until} />
                        {s.range_self_updated_at && (
                          <Tooltip title={`העובד עדכן בעצמו ב-${fmt(s.range_self_updated_at.slice(0, 10))}`}>
                            <Chip size="small" variant="outlined" label='עודכן ע"י העובד' sx={{ ms: 0.5 }} />
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        {effectiveParent(s) ? "כן" : "—"}
                        {s.parent_override !== null && (
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {" "}
                            (ידני)
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {activeLoadRoles(s).length === 0
                          ? "—"
                          : activeLoadRoles(s).map((r) => (
                              <Chip
                                key={r.load_role_id + r.valid_from}
                                size="small"
                                label={`${r.name} ×${r.factor}`}
                                color={
                                  r.load_role_id === lr?.load_role_id
                                    ? "primary"
                                    : "default"
                                }
                                variant={
                                  r.load_role_id === lr?.load_role_id
                                    ? "filled"
                                    : "outlined"
                                }
                                title={
                                  r.load_role_id === lr?.load_role_id
                                    ? "ההקלה שחלה (הגדולה מביניהן)"
                                    : "לא חלה – יש הקלה גדולה יותר"
                                }
                                sx={{ ml: 0.5 }}
                              />
                            ))}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {(exBySoldier.get(s.id) ?? []).length === 0
                          ? "—"
                          : (exBySoldier.get(s.id) ?? []).map((e) => {
                              const now = e.start_date <= today;
                              const pending = e.status === "pending";
                              const type =
                                exTypeName.get(e.exemption_type_id) ?? "פטור";
                              return (
                                <Chip
                                  key={e.id}
                                  size="small"
                                  label={`${type}${e.kind === "partial" ? " (חלקי)" : ""} · ${now ? `עד ${ddmm(e.end_date)}` : `מ-${ddmm(e.start_date)}`}${pending ? " · ממתין" : ""}`}
                                  color={
                                    pending
                                      ? "warning"
                                      : now
                                        ? "info"
                                        : "default"
                                  }
                                  variant={
                                    now && !pending ? "filled" : "outlined"
                                  }
                                  title={`${type}: ${fmt(e.start_date)} – ${fmt(e.end_date)}${pending ? " · ממתין לאישור" : ""}`}
                                  sx={{ ml: 0.5 }}
                                />
                              );
                            })}
                      </TableCell>
                      <TableCell>{fmt(s.second_role_signed_at)}</TableCell>
                      {canManage &&
                        (() => {
                          const a = accountLabel(accounts.get(s.id), todayIso());
                          return (
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              {a.tone === "default" ? "—" : <Chip size="small" variant="outlined" color={a.tone} label={a.text} />}
                            </TableCell>
                          );
                        })()}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", p: 1 }}
          >
            מוצגים {shown.length} מתוך {rows.length}. סוג השירות מוצג לפי היום;
            במחזור הוא נקבע לפי תאריך תחילת המחזור.
          </Typography>
        </Paper>
      )}

      {fixFor && (
        <FixRequestsDialog
          soldierId={fixFor}
          names={new Map((rows ?? []).map((r) => [r.id, r.full_name]))}
          onClose={() => setFixFor(null)}
          onChanged={loadFixes}
        />
      )}
      {editing && (
        <EditDialog
          soldier={editing}
          ranks={ranks}
          loadRoles={loadRoles}
          mode={staffUser ? "full" : manages(editing) ? "admin" : "view"}
          onViewAs={manages(editing) ? () => void viewAs(editing.id) : undefined}
          score={
            staffUser && (cur ?? nxt)
              ? {
                  cycleId: (cur ?? nxt)!.cycle.id,
                  cycleName: (cur ?? nxt)!.cycle.name,
                  now: nowScore(editing)?.points ?? 0,
                  corrections: corrections.filter((c) => c.soldier_id === editing.id),
                  onChanged: loadCorrections,
                }
              : undefined
          }
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {adding && (
        <AddSoldierDialog
          onClose={() => setAdding(false)}
          onAdded={async (id, name) => {
            setAdding(false);
            setAdded({ id, name });
            await load();
          }}
        />
      )}
      {inviting && (
        <InviteDialog
          soldiers={(rows ?? []).filter((x) => selected.has(x.id) && x.is_active)}
          hasAccount={(id) => !!accounts.get(id)?.username}
          onClose={() => setInviting(false)}
          onDone={() => void loadAccounts()}
        />
      )}
      {removing && (
        <BulkRemoveDialog
          count={selected.size}
          onClose={(changed) => {
            setRemoving(false);
            if (!changed) return;
            setSelected(new Set());
            void load();
          }}
          onRemove={async (from) => ({ kind: "remove", ...(await api!.removeFromUnitMany([...selected], from)) })}
          onDelete={async () => ({ kind: "delete", ...(await api!.deleteSoldiers([...selected])) })}
        />
      )}
      {bulk && (
        <BulkRangeDialog
          count={selected.size}
          onClose={() => setBulk(false)}
          onApply={async (date) => {
            await api!.updateSoldiersAdmin([...selected], {
              range_valid_until: date,
            });
            setBulk(false);
            setSelected(new Set());
            await load();
          }}
        />
      )}
    </Stack>
  );
}

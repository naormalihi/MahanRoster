import { EvenBar } from "../components/EvenBar";
import { DateTextField } from "../components/DateTextField";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditNoteIcon from "@mui/icons-material/EditNote";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import {
  Alert,
  Autocomplete,
  IconButton,
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
  InputAdornment,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
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
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import type { TaskType } from "../lib/catalog";
import {
  STATUS_LABEL,
  VIA_LABEL,
  absenceDays,
  blockQuotaProblems,
  exemptionProblems,
  missingDutyList,
  type Absence,
  type AbsenceInput,
  type AbsenceType,
  type Cycle,
  type DateBlock,
  type Exemption,
  type ExemptionInput,
  type ExemptionType,
  type ReceivedVia,
  type RequestStatus,
} from "../lib/cycles";
import type { ExistingSoldier } from "../lib/roster";
import { DeadlineEditor } from "../components/DeadlineEditor";
import { EmptyState } from "../components/EmptyState";
import { CardList, RowCard, useNarrow } from "../components/CardList";
import { IconBadge } from "../components/IconBadge";
import { KIND_LOOK } from "../components/RequestIcons";
import { useLiveTick } from "../lib/live";
import { readDashboardSet } from "../lib/dashboardSet";

const fmt = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

interface Ctx {
  cycle: Cycle;
  soldiers: ExistingSoldier[];
  byId: Map<string, ExistingSoldier>;
  reload: () => void;
}

function Loading() {
  return (
    <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function SoldierPicker(props: { soldiers: ExistingSoldier[]; value: string; onChange: (id: string) => void; autoFocus?: boolean }) {
  const options = useMemo(
    () => props.soldiers.filter((s) => s.is_active).sort((a, b) => a.full_name.localeCompare(b.full_name, "he")),
    [props.soldiers],
  );
  return (
    <Autocomplete
      options={options}
      value={options.find((s) => s.id === props.value) ?? null}
      onChange={(_, v) => props.onChange(v?.id ?? "")}
      getOptionLabel={(s) => `${s.full_name} · ${s.gaf_name}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderInput={(p) => <TextField {...p} label="עובד" autoFocus={props.autoFocus} />}
      noOptionsText="לא נמצא"
    />
  );
}

function ViaSelect(props: { value: ReceivedVia | null; onChange: (v: ReceivedVia) => void }) {
  return (
    <TextField select label="התקבל ב" value={props.value ?? ""} onChange={(e) => props.onChange(e.target.value as ReceivedVia)} fullWidth>
      {(["in_person", "phone", "message", "excel"] as ReceivedVia[]).map((v) => (
        <MenuItem key={v} value={v}>
          {VIA_LABEL[v]}
        </MenuItem>
      ))}
    </TextField>
  );
}

function DateInput(props: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <DateTextField
      label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: props.min, max: props.max } }}
      fullWidth
    />
  );
}

function FormDialog(props: { title: string; children: ReactNode; error: string | null; busy: boolean; onClose: () => void; onSave: () => void; saveLabel?: string }) {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
  return (
    <Dialog open onClose={props.onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {props.children}
          {props.error && <Alert severity="error">{props.error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" onClick={props.onSave} disabled={props.busy}>
          {props.saveLabel ?? "שמירה"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ReasonDialog(props: { title: string; label: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!reason.trim()) return setError("חובה לכתוב נימוק");
    setBusy(true);
    try {
      await props.onConfirm(reason.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <FormDialog title={props.title} error={error} busy={busy} onClose={props.onClose} onSave={save} saveLabel="אישור">
      <TextField label={props.label} value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} autoFocus fullWidth />
    </FormDialog>
  );
}

/** Delete a row outright (staff) – with a confirmation; the audit log keeps it. */
function DeleteRowButton(props: { what: string; onDelete: () => Promise<void>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    try {
      await props.onDelete();
      setOpen(false);
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <>
      <Tooltip title="מחיקה">
        <IconButton size="small" color="error" aria-label="מחיקה" onClick={() => setOpen(true)}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {open && (
        <FormDialog title="מחיקת שורה" error={error} busy={busy} onClose={() => setOpen(false)} onSave={confirm} saveLabel="מחיקה">
          <Typography>{props.what}</Typography>
          <Typography variant="body2" color="text.secondary">
            השורה תימחק לגמרי ולא תישאר בהיסטוריה (המחיקה נרשמת ביומן הביקורת). כדי לשמור אותה בהיסטוריה – "ביטול".
          </Typography>
        </FormDialog>
      )}
    </>
  );
}

/** פטור חלקי: the duties the employee can't do, out of those they're eligible for. */
function DutyListPicker(props: { soldierId: string; tasks: TaskType[]; value: string[]; onChange: (ids: string[]) => void }) {
  const { api } = useAuth();
  const [ok, setOk] = useState<Set<string> | null>(null);
  useEffect(() => {
    setOk(null);
    if (!props.soldierId) return;
    let live = true;
    api!
      .eligibleTaskTypes(props.soldierId)
      .then((ids) => live && setOk(new Set(ids)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, props.soldierId]);
  const options = props.tasks.filter((t) => t.is_active && (!ok || ok.has(t.id)));
  return (
    <Autocomplete
      multiple
      disabled={!props.soldierId}
      options={options}
      value={props.tasks.filter((t) => props.value.includes(t.id))}
      onChange={(_, v) => props.onChange(v.map((t) => t.id))}
      getOptionLabel={(t) => t.name}
      noOptionsText="אין משימות שהעובד זכאי להן"
      renderInput={(p) => (
        <TextField {...p} required label="לא יכול לבצע" helperText={props.soldierId ? "מתוך המשימות שהעובד זכאי להן" : "קודם בוחרים עובד"} />
      )}
    />
  );
}

/** The staff-only note on an exemption. */
function NoteField(props: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <TextField
      label="הערה פנימית"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value.slice(0, 200))}
      multiline
      minRows={2}
      fullWidth
      autoFocus={props.autoFocus}
      helperText={`לסגל בלבד – העובד לא רואה אותה. בלי פרטים רפואיים. ${props.value.length}/200`}
    />
  );
}

/** Name search + gaf filter shared by the lists. */
function useFilter(ctx: Ctx) {
  const [q, setQ] = useState("");
  const [gaf, setGaf] = useState("");
  const gafim = useMemo(() => [...new Set(ctx.soldiers.map((s) => s.gaf_name))].sort((a, b) => a.localeCompare(b, "he")), [ctx.soldiers]);
  const match = (soldierId: string) => {
    const s = ctx.byId.get(soldierId);
    if (!s) return !q && !gaf;
    return (!q || s.full_name.includes(q.trim())) && (!gaf || s.gaf_name === gaf);
  };
  const search = (
    <TextField
      size="small"
      placeholder="חיפוש לפי שם"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
      sx={{ minWidth: 180 }}
    />
  );
  const gafSelect = (
    <TextField select size="small" label="מסגרת" value={gaf} onChange={(e) => setGaf(e.target.value)} sx={{ minWidth: 140 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
      <MenuItem value="">כל המסגרות</MenuItem>
      {gafim.map((g) => (
        <MenuItem key={g} value={g}>
          {g}
        </MenuItem>
      ))}
    </TextField>
  );
  return { match, search, gafSelect, gafim };
}

/** The lists' toolbar: search; gaf | the tab's own filter; "new" (| pending count). */
function FilterBar(p: { narrow: boolean; add: ReactNode; search: ReactNode; gaf: ReactNode; third: ReactNode; extra?: ReactNode }) {
  return p.narrow ? (
    <EvenBar narrow items={[{ node: p.search, wide: true }, p.gaf, p.third, p.extra ? p.add : { node: p.add, wide: true }, p.extra]} />
  ) : (
    <EvenBar narrow={false} items={[p.add, p.search, p.gaf, p.third, p.extra]} />
  );
}

const nameOf = (ctx: Ctx, id: string) => ctx.byId.get(id)?.full_name ?? "עובד לא מוכר";
const gafOf = (ctx: Ctx, id: string) => ctx.byId.get(id)?.gaf_name ?? "";

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<RequestStatus, "warning" | "success" | "error" | "default"> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  expired: "default",
  cancelled: "default",
};

/** A new exemption, or (edit) changing one that is pending or approved. */
function ExemptionDialog(props: { ctx: Ctx; types: ExemptionType[]; tasks: TaskType[]; edit?: Exemption; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const { cycle } = props.ctx;
  const ed = props.edit;
  const deadlinePassed = !!cycle.exemption_deadline && Date.parse(cycle.exemption_deadline) < Date.now();
  const [e, setE] = useState<ExemptionInput>(
    ed
      ? {
          soldier_id: ed.soldier_id,
          exemption_type_id: ed.exemption_type_id,
          kind: ed.kind,
          start_date: ed.start_date,
          end_date: ed.end_date,
          excluded_task_type_ids: ed.excluded_task_type_ids ?? [],
          restricted_hours: ed.restricted_hours,
          is_urgent: ed.is_urgent,
          received_via: ed.received_via,
        }
      : {
          soldier_id: "",
          exemption_type_id: "",
          kind: "full",
          start_date: cycle.start_date,
          end_date: cycle.end_date,
          excluded_task_type_ids: [],
          restricted_hours: null,
          is_urgent: deadlinePassed,
          received_via: "in_person",
        },
  );
  const [from0, to0] = (ed?.restricted_hours ?? "").split("-");
  const [hours, setHours] = useState({ on: !!ed?.restricted_hours, from: from0 || "22:00", to: to0 || "06:00" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeTasks = props.tasks.filter((t) => t.is_active);
  const needsList = !!props.types.find((t) => t.id === e.exemption_type_id)?.requires_duty_list;
  const [note, setNote] = useState(ed?.internal_note ?? "");
  // a new type on an approved exemption: its proof is checked again
  const typeChanged = !!ed && ed.status === "approved" && ed.source !== "computed" && e.exemption_type_id !== ed.exemption_type_id;
  const [rechecked, setRechecked] = useState(false);

  async function save() {
    const kind = needsList ? "partial" : e.kind;
    const input = { ...e, kind, restricted_hours: kind === "partial" && hours.on ? `${hours.from}-${hours.to}` : null } as ExemptionInput;
    if (needsList && !input.excluded_task_type_ids?.length) return setError("בפטור חלקי צריך לבחור לפחות משימה אחת שהעובד לא יכול לבצע");
    const p = exemptionProblems(input);
    if (p.length) return setError(p[0]);
    if (typeChanged && !rechecked) return setError("סוג הפטור השתנה – סמן שבדקת את האסמכתא לסוג החדש");
    setBusy(true);
    try {
      if (ed)
        await api!.updateExemption({
          id: ed.id,
          exemption_type_id: input.exemption_type_id,
          start_date: input.start_date,
          end_date: input.end_date,
          kind: input.kind,
          excluded_task_type_ids: input.kind === "partial" && input.excluded_task_type_ids?.length ? input.excluded_task_type_ids : null,
          restricted_hours: input.restricted_hours,
          internal_note: note.trim() || null,
          proof_rechecked: typeChanged && rechecked,
        });
      else await api!.addExemption({ ...input, internal_note: note.trim() || null });
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <FormDialog title={ed ? `עריכת פטור – ${nameOf(props.ctx, ed.soldier_id)}` : "פטור חדש"} error={error} busy={busy} onClose={props.onClose} onSave={save}>
      {!ed && <SoldierPicker soldiers={props.ctx.soldiers} value={e.soldier_id} onChange={(v) => setE({ ...e, soldier_id: v })} autoFocus />}
      <TextField select label="סוג פטור" value={e.exemption_type_id} onChange={(ev) => setE({ ...e, exemption_type_id: ev.target.value })} fullWidth>
        {props.types.filter((t) => t.is_active !== false || t.id === ed?.exemption_type_id).map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.name}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <DateInput label="מתאריך" value={e.start_date} onChange={(v) => setE({ ...e, start_date: v })} />
        <DateInput label="עד תאריך" value={e.end_date} onChange={(v) => setE({ ...e, end_date: v })} />
      </Stack>
      {props.types.find((t) => t.id === e.exemption_type_id)?.home_nightly && (
        <Alert severity="info" icon={false}>
          ת״ש 7: העובד לן בבית ולא ישובץ בתאריכים האלה למשימה שכוללת שעות לילה. במשבצות שהבסיס סימן "ת״ש 7" הוא מקבל עדיפות.
        </Alert>
      )}
      {!props.types.find((t) => t.id === e.exemption_type_id)?.home_nightly && !needsList && (
      <RadioGroup row value={e.kind} onChange={(ev) => setE({ ...e, kind: ev.target.value as "full" | "partial" })}>
        <FormControlLabel value="full" control={<Radio />} label="לפי סוג הפטור" />
        <FormControlLabel value="partial" control={<Radio />} label="מצומצם למשימות או לשעות" />
      </RadioGroup>
      )}
      {(e.kind === "partial" || needsList) && !props.types.find((t) => t.id === e.exemption_type_id)?.home_nightly && (
        <>
          {needsList ? (
            <DutyListPicker
              soldierId={e.soldier_id}
              tasks={props.tasks}
              value={e.excluded_task_type_ids ?? []}
              onChange={(v) => setE({ ...e, excluded_task_type_ids: v })}
            />
          ) : (
          <Autocomplete
            multiple
            options={activeTasks}
            value={activeTasks.filter((t) => e.excluded_task_type_ids?.includes(t.id))}
            onChange={(_, v) => setE({ ...e, excluded_task_type_ids: v.map((t) => t.id) })}
            getOptionLabel={(t) => t.name}
            renderInput={(p) => <TextField {...p} label="פטור מהמשימות" />}
          />
          )}
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <FormControlLabel control={<Switch checked={hours.on} onChange={(ev) => setHours({ ...hours, on: ev.target.checked })} />} label="פטור בשעות" />
            {hours.on && (
              <>
                <TextField type="time" size="small" label="מ" value={hours.from} onChange={(ev) => setHours({ ...hours, from: ev.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
                <TextField type="time" size="small" label="עד" value={hours.to} onChange={(ev) => setHours({ ...hours, to: ev.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
              </>
            )}
          </Stack>
        </>
      )}
      {typeChanged && (
        <FormControlLabel
          control={<Checkbox checked={rechecked} onChange={(ev) => setRechecked(ev.target.checked)} />}
          label="בדקתי את האסמכתא לסוג החדש (מחוץ למערכת)"
        />
      )}
      {!ed && (
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        <ViaSelect value={e.received_via} onChange={(v) => setE({ ...e, received_via: v })} />
        <FormControlLabel
          control={<Checkbox checked={e.is_urgent} onChange={(ev) => setE({ ...e, is_urgent: ev.target.checked })} />}
          label="דחוף (אחרי מועד הסגירה)"
          sx={{ flexShrink: 0 }}
        />
      </Stack>
      )}
      <NoteField value={note} onChange={setNote} />
      <Typography variant="caption" color="text.secondary">
        {ed?.status === "approved"
          ? "הפטור נשאר מאושר. הרחבה משחררת את המשימות של העובד בטווח החדש גם אחרי הפרסום; צמצום לא מחזיר משימות. בטיוטה – \"חישוב מחדש\" בפוטנציאל. העובד מקבל התראה (בלי ההערה)."
          : "בלי מסמכים ובלי פירוט רפואי: רק סוג הפטור ותאריכים. את האסמכתא בודקים מחוץ למערכת ומסמנים \"אסמכתא נבדקה\"."}
      </Typography>
    </FormDialog>
  );
}

function ApproveDialog(props: { ex: Exemption; who: string; types: ExemptionType[]; tasks: TaskType[]; onClose: () => void; onDone: () => void }) {
  const { api } = useAuth();
  const [proof, setProof] = useState(!!props.ex.proof_checked_at || props.ex.source === "computed");
  const [note, setNote] = useState(props.ex.internal_note ?? "");
  const needsList = !!props.types.find((t) => t.id === props.ex.exemption_type_id)?.requires_duty_list;
  const [duties, setDuties] = useState<string[]>(props.ex.excluded_task_type_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!proof) return setError("לפני אישור צריך לבדוק את האסמכתא");
    if (needsList && !duties.length) return setError("בפטור חלקי צריך לבחור לפחות משימה אחת שהעובד לא יכול לבצע");
    setBusy(true);
    try {
      if (!props.ex.proof_checked_at && props.ex.source !== "computed") await api!.markProofChecked(props.ex.id);
      if (needsList && duties.join() !== (props.ex.excluded_task_type_ids ?? []).join()) await api!.setExemptionDuties(props.ex.id, duties);
      if (note.trim() !== (props.ex.internal_note ?? "")) await api!.setExemptionNote(props.ex.id, note);
      await api!.decideExemption(props.ex.id, { action: "approve" });
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <FormDialog title={`אישור פטור – ${props.who}`} error={error} busy={busy} onClose={props.onClose} onSave={save} saveLabel="אישור הפטור">
      <Typography>
        {fmt(props.ex.start_date)} – {fmt(props.ex.end_date)}
      </Typography>
      <FormControlLabel
        control={<Checkbox checked={proof} disabled={!!props.ex.proof_checked_at} onChange={(e) => setProof(e.target.checked)} />}
        label="בדקתי את האסמכתא (מחוץ למערכת)"
      />
      {needsList && <DutyListPicker soldierId={props.ex.soldier_id} tasks={props.tasks} value={duties} onChange={setDuties} />}
      <NoteField value={note} onChange={setNote} />
    </FormDialog>
  );
}

/** פטור חלקי saved without its duties: name them (it excluded every duty until now). */
function DutiesDialog(props: { ex: Exemption; who: string; tasks: TaskType[]; onClose: () => void; onDone: () => void }) {
  const { api } = useAuth();
  const [duties, setDuties] = useState<string[]>(props.ex.excluded_task_type_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!duties.length) return setError("צריך לבחור לפחות משימה אחת שהעובד לא יכול לבצע");
    setBusy(true);
    try {
      await api!.setExemptionDuties(props.ex.id, duties);
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <FormDialog title={`פירוט משימות – ${props.who}`} error={error} busy={busy} onClose={props.onClose} onSave={save}>
      <Typography>
        {fmt(props.ex.start_date)} – {fmt(props.ex.end_date)}
      </Typography>
      <DutyListPicker soldierId={props.ex.soldier_id} tasks={props.tasks} value={duties} onChange={setDuties} />
      <Typography variant="caption" color="text.secondary">
        אחרי השמירה – "חישוב מחדש" בפוטנציאל, כדי שהעובד יחזור למשימות האחרות.
      </Typography>
    </FormDialog>
  );
}

function NoteDialog(props: { ex: Exemption; who: string; onClose: () => void; onDone: () => void }) {
  const { api } = useAuth();
  const [note, setNote] = useState(props.ex.internal_note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api!.setExemptionNote(props.ex.id, note);
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <FormDialog title={`הערה פנימית – ${props.who}`} error={error} busy={busy} onClose={props.onClose} onSave={save}>
      <NoteField value={note} onChange={setNote} autoFocus />
    </FormDialog>
  );
}

function ExemptionsTab({ ctx }: { ctx: Ctx }) {
  const live = useLiveTick();
  const narrow = useNarrow();
  const { api } = useAuth();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Exemption[] | null>(null);
  const [types, setTypes] = useState<ExemptionType[]>([]);
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [status, setStatus] = useState<RequestStatus | "">((params.get("status") as RequestStatus) ?? "");
  // ?urgent=1 / ?by=soldier (from "נתוני היחידה"): only those
  const [urgentOnly, setUrgentOnly] = useState(params.get("urgent") === "1");
  const [bySoldier, setBySoldier] = useState(params.get("by") === "soldier");
  // ?set=1 ("נתוני המסגרת"): only a gaf commander's people – the list his number counted
  const [peopleSet, setPeopleSet] = useState<{ label: string; ids: Set<string> } | null>(() => {
    if (params.get("set") !== "1") return null;
    const s = readDashboardSet();
    return s ? { label: s.label, ids: new Set(s.ids) } : null;
  });
  const [adding, setAdding] = useState(false);
  const [approving, setApproving] = useState<Exemption | null>(null);
  const [detailing, setDetailing] = useState<Exemption | null>(null);
  const [noting, setNoting] = useState<Exemption | null>(null);
  const [editing, setEditing] = useState<Exemption | null>(null);
  const [rejecting, setRejecting] = useState<{ ex: Exemption; action: "reject" | "cancel" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filter = useFilter(ctx);

  const load = useCallback(async () => {
    try {
      const [r, t, tt] = await Promise.all([api!.exemptions(ctx.cycle.start_date, ctx.cycle.end_date), api!.exemptionTypes(), api!.taskTypes()]);
      setRows(r);
      setTypes(t);
      setTasks(tt);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, ctx.cycle]);
  useEffect(() => void load(), [load, live]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) return <Loading />;
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const taskName = new Map(tasks.map((t) => [t.id, t.name]));
  const shown = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!urgentOnly || r.is_urgent) &&
      (!bySoldier || r.source === "soldier") &&
      (!peopleSet || peopleSet.ids.has(r.soldier_id)) &&
      filter.match(r.soldier_id),
  );
  const pending = rows.filter((r) => r.status === "pending").length;

  const scope = (r: Exemption) => {
    if (missingDutyList(r, types)) return "חסר פירוט – פוטר מהכול";
    if (r.kind === "full") return "לפי הסוג";
    const parts = (r.excluded_task_type_ids ?? []).map((id) => taskName.get(id) ?? "?");
    if (r.restricted_hours) parts.push(`שעות ${r.restricted_hours}`);
    return parts.join(", ");
  };

  return (
    <Stack spacing={2}>
      <FilterBar
        narrow={narrow}
        add={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            פטור חדש
          </Button>
        }
        search={filter.search}
        gaf={filter.gafSelect}
        third={
          <TextField select size="small" label="סטטוס" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | "")} sx={{ minWidth: 130 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
            <MenuItem value="">הכל</MenuItem>
            {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
        }
        extra={
          pending > 0 || urgentOnly || bySoldier || peopleSet ? (
            <Stack direction="row" spacing={1}>
              {pending > 0 && <Chip color="warning" label={`${pending} ממתינים לאישור`} onClick={() => setStatus("pending")} />}
              {urgentOnly && <Chip color="error" label="רק דחופות" onDelete={() => setUrgentOnly(false)} />}
              {bySoldier && <Chip color="info" label="רק שהגישו בעצמם" onDelete={() => setBySoldier(false)} />}
              {peopleSet && <Chip color="primary" label={peopleSet.label} onDelete={() => setPeopleSet(null)} />}
            </Stack>
          ) : undefined
        }
      />
      {shown.length === 0 ? (
        <EmptyState size="sm" title="אין פטורים להצגה" text="במחזור הזה, לפי הסינון שנבחר." />
      ) : narrow ? (
        <CardList>
          {shown.map((r) => (
            <RowCard
              key={r.id}
              title={nameOf(ctx, r.soldier_id)}
              chips={
                <>
                  <Tooltip title={r.decision_reason ?? ""}>
                    <Chip size="small" color={STATUS_COLOR[r.status]} label={STATUS_LABEL[r.status]} />
                  </Tooltip>
                  {r.is_urgent && <Chip size="small" color="error" variant="outlined" label="דחוף" />}
                  {r.source === "soldier" && <Chip size="small" color="info" variant="outlined" label="הגיש בעצמו" />}
                </>
              }
              sub={`${typeName.get(r.exemption_type_id) ?? ""} · ${scope(r)}`}
              lines={[
                `${gafOf(ctx, r.soldier_id)} · ${fmt(r.start_date)} – ${fmt(r.end_date)}`,
                r.source === "computed" ? "מחושב" : r.proof_checked_at ? `אסמכתא נבדקה ${fmt(r.proof_checked_at)}` : null,
                r.internal_note ? `הערה: ${r.internal_note}` : null,
              ]}
              actions={
                <>
                  {r.status === "pending" && (
                    <>
                      <Button size="small" variant="contained" startIcon={<CheckIcon />} onClick={() => setApproving(r)}>
                        אישור
                      </Button>
                      <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />} onClick={() => setRejecting({ ex: r, action: "reject" })}>
                        דחייה
                      </Button>
                    </>
                  )}
                  {r.status === "approved" && missingDutyList(r, types) && (
                    <Button size="small" color="error" variant="outlined" onClick={() => setDetailing(r)}>
                      פירוט משימות
                    </Button>
                  )}
                  {r.status === "approved" && (
                    <Button size="small" variant="outlined" color="inherit" onClick={() => setRejecting({ ex: r, action: "cancel" })}>
                      ביטול
                    </Button>
                  )}
                </>
              }
              tools={
                <>
                  {(r.status === "pending" || r.status === "approved") && (
                    <Tooltip title="עריכה">
                      <IconButton size="small" aria-label="עריכת הפטור" onClick={() => setEditing(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="הערה פנימית">
                    <IconButton size="small" aria-label="הערה פנימית" onClick={() => setNoting(r)}>
                      <EditNoteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <DeleteRowButton
                    what={`פטור של ${nameOf(ctx, r.soldier_id)} – ${typeName.get(r.exemption_type_id) ?? ""}, ${fmt(r.start_date)} – ${fmt(r.end_date)}`}
                    onDelete={() => api!.deleteExemption(r.id)}
                    onDone={() => void load()}
                  />
                </>
              }
            />
          ))}
        </CardList>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>עובד</TableCell>
                <TableCell>מסגרת</TableCell>
                <TableCell>סוג</TableCell>
                <TableCell>היקף</TableCell>
                <TableCell>תאריכים</TableCell>
                <TableCell>אסמכתא</TableCell>
                <TableCell>הערה</TableCell>
                <TableCell>סטטוס</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    {nameOf(ctx, r.soldier_id)}
                    {r.is_urgent && <Chip size="small" color="error" variant="outlined" label="דחוף" sx={{ mr: 1 }} />}
                    {r.source === "soldier" && <Chip size="small" color="info" variant="outlined" label="הגיש בעצמו" sx={{ mr: 1 }} />}
                  </TableCell>
                  <TableCell>{gafOf(ctx, r.soldier_id)}</TableCell>
                  <TableCell>{typeName.get(r.exemption_type_id)}</TableCell>
                  <TableCell>
                    {missingDutyList(r, types) ? <Chip size="small" color="error" label="חסר פירוט – פוטר מהכול" /> : scope(r)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {fmt(r.start_date)} – {fmt(r.end_date)}
                  </TableCell>
                  <TableCell>{r.source === "computed" ? "מחושב" : r.proof_checked_at ? `נבדקה ${fmt(r.proof_checked_at)}` : "—"}</TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                        {r.internal_note ?? ""}
                      </Typography>
                      <Tooltip title={r.internal_note ? "עריכת ההערה" : "הוספת הערה פנימית"}>
                        <IconButton size="small" aria-label="הערה פנימית" onClick={() => setNoting(r)}>
                          <EditNoteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={r.decision_reason ?? ""}>
                      <Chip size="small" color={STATUS_COLOR[r.status]} label={STATUS_LABEL[r.status]} />
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {r.status === "pending" && (
                      <>
                        <Button size="small" startIcon={<CheckIcon />} onClick={() => setApproving(r)}>
                          אישור
                        </Button>
                        <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => setRejecting({ ex: r, action: "reject" })}>
                          דחייה
                        </Button>
                      </>
                    )}
                    {r.status === "approved" && missingDutyList(r, types) && (
                      <Button size="small" color="error" onClick={() => setDetailing(r)}>
                        פירוט משימות
                      </Button>
                    )}
                    {(r.status === "pending" || r.status === "approved") && (
                      <Tooltip title="עריכה">
                        <IconButton size="small" aria-label="עריכת הפטור" onClick={() => setEditing(r)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {r.status === "approved" && (
                      <Button size="small" color="inherit" onClick={() => setRejecting({ ex: r, action: "cancel" })}>
                        ביטול
                      </Button>
                    )}
                    <DeleteRowButton
                      what={`פטור של ${nameOf(ctx, r.soldier_id)} – ${typeName.get(r.exemption_type_id) ?? ""}, ${fmt(r.start_date)} – ${fmt(r.end_date)}`}
                      onDelete={() => api!.deleteExemption(r.id)}
                      onDone={() => void load()}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {adding && (
        <ExemptionDialog
          ctx={ctx}
          types={types}
          tasks={tasks}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {editing && (
        <ExemptionDialog
          ctx={ctx}
          types={types}
          tasks={tasks}
          edit={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {approving && (
        <ApproveDialog
          ex={approving}
          who={nameOf(ctx, approving.soldier_id)}
          types={types}
          tasks={tasks}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            void load();
          }}
        />
      )}
      {detailing && (
        <DutiesDialog
          ex={detailing}
          who={nameOf(ctx, detailing.soldier_id)}
          tasks={tasks}
          onClose={() => setDetailing(null)}
          onDone={() => {
            setDetailing(null);
            void load();
          }}
        />
      )}
      {noting && (
        <NoteDialog
          ex={noting}
          who={nameOf(ctx, noting.soldier_id)}
          onClose={() => setNoting(null)}
          onDone={() => {
            setNoting(null);
            void load();
          }}
        />
      )}
      {rejecting && (
        <ReasonDialog
          title={`${rejecting.action === "reject" ? "דחיית" : "ביטול"} פטור – ${nameOf(ctx, rejecting.ex.soldier_id)}`}
          label="נימוק"
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await api!.decideExemption(rejecting.ex.id, { action: rejecting.action, reason });
            setRejecting(null);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Absences
// ---------------------------------------------------------------------------

function AbsenceDialog(props: { ctx: Ctx; types: AbsenceType[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const [a, setA] = useState<AbsenceInput>({ soldier_id: "", absence_type_id: "", from: "", to: "", received_via: "message" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!a.soldier_id) return setError("בחר עובד");
    if (!a.absence_type_id) return setError("בחר סוג היעדרות");
    if (!a.from || !a.to) return setError("חסרים תאריכים");
    if (a.to < a.from) return setError("תאריך הסיום לפני תאריך ההתחלה");
    setBusy(true);
    try {
      await api!.addAbsences([a]);
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <FormDialog title="היעדרות חדשה" error={error} busy={busy} onClose={props.onClose} onSave={save}>
      <SoldierPicker soldiers={props.ctx.soldiers} value={a.soldier_id} onChange={(v) => setA({ ...a, soldier_id: v })} autoFocus />
      <TextField select label="סוג היעדרות" value={a.absence_type_id} onChange={(e) => setA({ ...a, absence_type_id: e.target.value })} fullWidth>
        {props.types.map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.name}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <DateInput label="מתאריך" value={a.from} onChange={(v) => setA({ ...a, from: v, to: a.to || v })} />
        <DateInput label="עד תאריך (כולל)" value={a.to} min={a.from} onChange={(v) => setA({ ...a, to: v })} />
      </Stack>
      <ViaSelect value={a.received_via} onChange={(v) => setA({ ...a, received_via: v })} />
      <Typography variant="caption" color="text.secondary">
        היעדרות לא דורשת אישור. העובד לא ישובץ בימים האלה, והיא מורידה את הזמינות שלו במטריצת הפוטנציאל.
      </Typography>
    </FormDialog>
  );
}

function AbsencesTab({ ctx }: { ctx: Ctx }) {
  const live = useLiveTick();
  const narrow = useNarrow();
  const { api } = useAuth();
  const [rows, setRows] = useState<Absence[] | null>(null);
  const [types, setTypes] = useState<AbsenceType[]>([]);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Absence | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filter = useFilter(ctx);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([api!.absences(ctx.cycle.start_date, ctx.cycle.end_date), api!.absenceTypes()]);
      setRows(r);
      setTypes(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, ctx.cycle]);
  useEffect(() => void load(), [load, live]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) return <Loading />;
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const shown = rows.filter((r) => (showCancelled || r.status === "active") && filter.match(r.soldier_id));

  return (
    <Stack spacing={2}>
      <FilterBar
        narrow={narrow}
        add={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            היעדרות חדשה
          </Button>
        }
        search={filter.search}
        gaf={filter.gafSelect}
        third={<FormControlLabel sx={{ m: 0 }} control={<Switch checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />} label="הצג מבוטלות" />}
      />
      {shown.length === 0 ? (
        <EmptyState size="sm" title="אין היעדרויות להצגה" text="במחזור הזה, לפי הסינון שנבחר." />
      ) : narrow ? (
        <CardList>
          {shown.map((r) => {
            const d = absenceDays(r);
            return (
              <RowCard
                key={r.id}
                dim={r.status !== "active"}
                title={nameOf(ctx, r.soldier_id)}
                chips={
                  r.status === "active" ? undefined : (
                    <Tooltip title={r.cancel_reason ?? ""}>
                      <Chip size="small" label="בוטלה" />
                    </Tooltip>
                  )
                }
                sub={`${typeName.get(r.absence_type_id) ?? ""} · ${fmt(d.from)} – ${fmt(d.to)} (${daysBetween(d.from, d.to)} ימים)`}
                lines={[`${gafOf(ctx, r.soldier_id)}${r.received_via ? ` · התקבל: ${VIA_LABEL[r.received_via]}` : ""}`]}
                actions={
                  r.status === "active" ? (
                    <Button size="small" variant="outlined" color="inherit" onClick={() => setCancelling(r)}>
                      ביטול
                    </Button>
                  ) : undefined
                }
                tools={
                  <DeleteRowButton
                    what={`היעדרות של ${nameOf(ctx, r.soldier_id)} – ${typeName.get(r.absence_type_id) ?? ""}, ${fmt(d.from)} – ${fmt(d.to)}`}
                    onDelete={() => api!.deleteAbsence(r.id)}
                    onDone={() => void load()}
                  />
                }
              />
            );
          })}
        </CardList>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>עובד</TableCell>
                <TableCell>מסגרת</TableCell>
                <TableCell>סוג</TableCell>
                <TableCell>תאריכים</TableCell>
                <TableCell>ימים</TableCell>
                <TableCell>התקבל ב</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => {
                const d = absenceDays(r);
                return (
                  <TableRow key={r.id} hover sx={{ opacity: r.status === "active" ? 1 : 0.5 }}>
                    <TableCell>{nameOf(ctx, r.soldier_id)}</TableCell>
                    <TableCell>{gafOf(ctx, r.soldier_id)}</TableCell>
                    <TableCell>{typeName.get(r.absence_type_id)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {fmt(d.from)} – {fmt(d.to)}
                    </TableCell>
                    <TableCell>{daysBetween(d.from, d.to)}</TableCell>
                    <TableCell>{r.received_via ? VIA_LABEL[r.received_via] : "—"}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {r.status === "active" ? (
                        <Button size="small" color="inherit" onClick={() => setCancelling(r)}>
                          ביטול
                        </Button>
                      ) : (
                        <Tooltip title={r.cancel_reason ?? ""}>
                          <Chip size="small" label="בוטלה" />
                        </Tooltip>
                      )}
                      <DeleteRowButton
                        what={`היעדרות של ${nameOf(ctx, r.soldier_id)} – ${typeName.get(r.absence_type_id) ?? ""}, ${fmt(d.from)} – ${fmt(d.to)}`}
                        onDelete={() => api!.deleteAbsence(r.id)}
                        onDone={() => void load()}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}
      {adding && (
        <AbsenceDialog
          ctx={ctx}
          types={types}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {cancelling && (
        <ReasonDialog
          title={`ביטול היעדרות – ${nameOf(ctx, cancelling.soldier_id)}`}
          label="סיבת הביטול"
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await api!.cancelAbsence(cancelling.id, reason);
            setCancelling(null);
            void load();
          }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Date blocks
// ---------------------------------------------------------------------------

function BlocksTab({ ctx }: { ctx: Ctx }) {
  const live = useLiveTick();
  const narrow = useNarrow();
  const { api } = useAuth();
  const [rows, setRows] = useState<DateBlock[] | null>(null);
  const [quota, setQuota] = useState(1);
  const [adding, setAdding] = useState<{ soldier_id: string; day: string; received_via: ReceivedVia } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filter = useFilter(ctx);

  const load = useCallback(async () => {
    try {
      const [r, q] = await Promise.all([api!.dateBlocks(ctx.cycle.start_date, ctx.cycle.end_date), api!.blockQuota()]);
      setRows(r);
      setQuota(q);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, ctx.cycle]);
  useEffect(() => void load(), [load, live]);

  async function save() {
    if (!adding) return;
    if (!adding.soldier_id || !adding.day) return setFormError("בחר עובד ותאריך");
    if (adding.day < ctx.cycle.start_date || adding.day > ctx.cycle.end_date) return setFormError("התאריך מחוץ למחזור");
    const over = blockQuotaProblems([adding], rows ?? [], quota).get(0);
    if (over) return setFormError(over);
    try {
      await api!.addDateBlocks([adding], ctx.cycle.id);
      setAdding(null);
      void load();
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) return <Loading />;
  const shown = rows.filter((r) => (showCancelled || r.status === "active") && filter.match(r.soldier_id));
  const deadlinePassed = !!ctx.cycle.exemption_deadline && Date.parse(ctx.cycle.exemption_deadline) < Date.now();

  return (
    <Stack spacing={2}>
      <FilterBar
        narrow={narrow}
        add={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setFormError(null);
              setAdding({ soldier_id: "", day: "", received_via: "message" });
            }}
          >
            חסימה חדשה
          </Button>
        }
        search={filter.search}
        gaf={filter.gafSelect}
        third={<FormControlLabel sx={{ m: 0 }} control={<Switch checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />} label="הצג מבוטלות" />}
      />
      <Typography variant="body2" color="text.secondary">
        עד {quota} חסימה לעובד בחודש. חסימה לא דורשת אישור ונכנסת כאילוץ קשיח.
        {deadlinePassed && " מועד הסגירה של המחזור עבר: חסימה חדשה עכשיו היא חריגה מהנוהל."}
      </Typography>
      {shown.length === 0 ? (
        <EmptyState size="sm" title="אין חסימות להצגה" text="במחזור הזה, לפי הסינון שנבחר." />
      ) : narrow ? (
        <CardList>
          {shown.map((r) => (
            <RowCard
              key={r.id}
              dim={r.status !== "active"}
              title={nameOf(ctx, r.soldier_id)}
              chips={r.status === "active" ? undefined : <Chip size="small" label="בוטלה" />}
              sub={fmt(r.day)}
              lines={[`${gafOf(ctx, r.soldier_id)}${r.received_via ? ` · התקבל: ${VIA_LABEL[r.received_via]}` : ""}`]}
              actions={
                r.status === "active" ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    onClick={async () => {
                      await api!.cancelDateBlock(r.id);
                      void load();
                    }}
                  >
                    ביטול
                  </Button>
                ) : undefined
              }
              tools={
                <DeleteRowButton
                  what={`חסימה של ${nameOf(ctx, r.soldier_id)} – ${fmt(r.day)}`}
                  onDelete={() => api!.deleteDateBlock(r.id)}
                  onDone={() => void load()}
                />
              }
            />
          ))}
        </CardList>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>עובד</TableCell>
                <TableCell>מסגרת</TableCell>
                <TableCell>תאריך</TableCell>
                <TableCell>התקבל ב</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id} hover sx={{ opacity: r.status === "active" ? 1 : 0.5 }}>
                  <TableCell>{nameOf(ctx, r.soldier_id)}</TableCell>
                  <TableCell>{gafOf(ctx, r.soldier_id)}</TableCell>
                  <TableCell>{fmt(r.day)}</TableCell>
                  <TableCell>{r.received_via ? VIA_LABEL[r.received_via] : "—"}</TableCell>
                  <TableCell>
                    {r.status === "active" ? (
                      <Button
                        size="small"
                        color="inherit"
                        onClick={async () => {
                          await api!.cancelDateBlock(r.id);
                          void load();
                        }}
                      >
                        ביטול
                      </Button>
                    ) : (
                      <Chip size="small" label="בוטלה" />
                    )}
                    <DeleteRowButton
                      what={`חסימה של ${nameOf(ctx, r.soldier_id)} – ${fmt(r.day)}`}
                      onDelete={() => api!.deleteDateBlock(r.id)}
                      onDone={() => void load()}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {adding && (
        <FormDialog title="חסימת תאריך" error={formError} busy={false} onClose={() => setAdding(null)} onSave={save}>
          <SoldierPicker soldiers={ctx.soldiers} value={adding.soldier_id} onChange={(v) => setAdding({ ...adding, soldier_id: v })} autoFocus />
          <DateInput label="תאריך" value={adding.day} min={ctx.cycle.start_date} max={ctx.cycle.end_date} onChange={(v) => setAdding({ ...adding, day: v })} />
          <ViaSelect value={adding.received_via} onChange={(v) => setAdding({ ...adding, received_via: v })} />
        </FormDialog>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------

const TABS = [
  { key: "exemptions", label: "פטורים", kind: "exemption" },
  { key: "absences", label: "היעדרויות", kind: "absence" },
  { key: "blocks", label: "חסימות", kind: "block" },
] as const;

export function ConstraintsPage() {
  const live = useLiveTick();
  const { api } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "exemptions";
  const narrow = useNarrow();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [soldiers, setSoldiers] = useState<ExistingSoldier[]>([]);
  const { cycleId, setCycleId } = useCycle();
  // a link from "נתוני היחידה": the cycle its number counted
  const cycleParam = params.get("cycle");
  useEffect(() => {
    if (!cycleParam) return;
    if (cycleParam !== cycleId) setCycleId(cycleParam);
    // once: the cycle picker works as usual after it
    setParams((p) => (p.delete("cycle"), p), { replace: true });
  }, [cycleParam, cycleId, setCycleId, setParams]);
  const [version, setVersion] = useState(0);
  const [cyclesVersion, setCyclesVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api!.cycles(), api!.soldiers()])
      .then(([c, s]) => {
        setCycles(c);
        setSoldiers(s);
      })
      .catch((e) => setError((e as Error).message));
  }, [api, cyclesVersion, live]);

  const byId = useMemo(() => new Map(soldiers.map((s) => [s.id, s])), [soldiers]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!cycles) return <Loading />;
  const cycle = cycles.find((c) => c.id === cycleId);
  const ctx: Ctx | null = cycle ? { cycle, soldiers, byId, reload: () => setVersion((v) => v + 1) } : null;

  return (
    <Stack spacing={2}>
      {!ctx ? (
        <Alert severity="info">כדי להזין אילוצים צריך קודם ליצור מחזור בניהול המחזורים.</Alert>
      ) : (
        <>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <DeadlineEditor cycle={ctx.cycle} onSaved={() => setCyclesVersion((v) => v + 1)} />
          </Stack>
          <Tabs
            value={tab}
            onChange={(_, v) => setParams({ tab: v }, { replace: true })}
            variant={narrow ? "fullWidth" : "scrollable"}
            allowScrollButtonsMobile
            sx={narrow ? { "& .MuiTab-root": { minWidth: 0, px: 0.5 } } : undefined}
          >
            {TABS.map((t) => (
              <Tab
                key={t.key}
                value={t.key}
                label={t.label}
                icon={<IconBadge icon={KIND_LOOK[t.kind].icon} tone={KIND_LOOK[t.kind].tone} size={26} />}
                iconPosition="start"
                sx={{ minHeight: 52, gap: 0.5 }}
              />
            ))}
          </Tabs>
          <Box key={`${ctx.cycle.id}-${version}`}>
            {tab === "exemptions" && <ExemptionsTab ctx={ctx} />}
            {tab === "absences" && <AbsencesTab ctx={ctx} />}
            {tab === "blocks" && <BlocksTab ctx={ctx} />}
          </Box>
        </>
      )}
    </Stack>
  );
}

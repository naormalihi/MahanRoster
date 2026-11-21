import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import UploadIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Autocomplete,
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
  List,
  ListItem,
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
  dedupeConstraints,
  exemptionProblems,
  parseTemplate,
  templateRows,
  type Absence,
  type AbsenceInput,
  type AbsenceType,
  type Cycle,
  type DateBlock,
  type Exemption,
  type ExemptionInput,
  type ExemptionType,
  type ParsedConstraints,
  type ReceivedVia,
  type RequestStatus,
} from "../lib/cycles";
import type { ExistingSoldier } from "../lib/roster";
import { DeadlineEditor } from "../components/DeadlineEditor";
import { EmptyState } from "../components/EmptyState";
import { CardList, RowCard, useNarrow } from "../components/CardList";

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
    <TextField
      type="date"
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
  const controls = (
    <>
      <TextField
        size="small"
        placeholder="חיפוש לפי שם"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        sx={{ minWidth: 180 }}
      />
      <TextField select size="small" label="מסגרת" value={gaf} onChange={(e) => setGaf(e.target.value)} sx={{ minWidth: 140 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
        <MenuItem value="">כל המסגרות</MenuItem>
        {gafim.map((g) => (
          <MenuItem key={g} value={g}>
            {g}
          </MenuItem>
        ))}
      </TextField>
    </>
  );
  return { match, controls, gafim };
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

function ExemptionDialog(props: { ctx: Ctx; types: ExemptionType[]; tasks: TaskType[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth();
  const { cycle } = props.ctx;
  const deadlinePassed = !!cycle.exemption_deadline && Date.parse(cycle.exemption_deadline) < Date.now();
  const [e, setE] = useState<ExemptionInput>({
    soldier_id: "",
    exemption_type_id: "",
    kind: "full",
    start_date: cycle.start_date,
    end_date: cycle.end_date,
    excluded_task_type_ids: [],
    restricted_hours: null,
    is_urgent: deadlinePassed,
    received_via: "in_person",
  });
  const [hours, setHours] = useState({ on: false, from: "22:00", to: "06:00" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeTasks = props.tasks.filter((t) => t.is_active);

  async function save() {
    const input = { ...e, restricted_hours: e.kind === "partial" && hours.on ? `${hours.from}-${hours.to}` : null };
    const p = exemptionProblems(input);
    if (p.length) return setError(p[0]);
    setBusy(true);
    try {
      await api!.addExemption(input);
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <FormDialog title="פטור חדש" error={error} busy={busy} onClose={props.onClose} onSave={save}>
      <SoldierPicker soldiers={props.ctx.soldiers} value={e.soldier_id} onChange={(v) => setE({ ...e, soldier_id: v })} autoFocus />
      <TextField select label="סוג פטור" value={e.exemption_type_id} onChange={(ev) => setE({ ...e, exemption_type_id: ev.target.value })} fullWidth>
        {props.types.map((t) => (
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
          ת״ש 7: העובד לן בבית ולא ישובץ בתאריכים האלה לתורנות שכוללת שעות לילה. במשבצות שהבסיס סימן "ת״ש 7" הוא מקבל עדיפות.
        </Alert>
      )}
      {!props.types.find((t) => t.id === e.exemption_type_id)?.home_nightly && (
      <RadioGroup row value={e.kind} onChange={(ev) => setE({ ...e, kind: ev.target.value as "full" | "partial" })}>
        <FormControlLabel value="full" control={<Radio />} label="לפי סוג הפטור" />
        <FormControlLabel value="partial" control={<Radio />} label="מצומצם לתורנויות או לשעות" />
      </RadioGroup>
      )}
      {e.kind === "partial" && !props.types.find((t) => t.id === e.exemption_type_id)?.home_nightly && (
        <>
          <Autocomplete
            multiple
            options={activeTasks}
            value={activeTasks.filter((t) => e.excluded_task_type_ids?.includes(t.id))}
            onChange={(_, v) => setE({ ...e, excluded_task_type_ids: v.map((t) => t.id) })}
            getOptionLabel={(t) => t.name}
            renderInput={(p) => <TextField {...p} label="פטור מהתורנויות" />}
          />
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
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        <ViaSelect value={e.received_via} onChange={(v) => setE({ ...e, received_via: v })} />
        <FormControlLabel
          control={<Checkbox checked={e.is_urgent} onChange={(ev) => setE({ ...e, is_urgent: ev.target.checked })} />}
          label="דחוף (אחרי מועד הסגירה)"
          sx={{ flexShrink: 0 }}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        בלי מסמכים ובלי פירוט רפואי: רק סוג הפטור ותאריכים. את האסמכתא בודקים מחוץ למערכת ומסמנים "אסמכתא נבדקה".
      </Typography>
    </FormDialog>
  );
}

function ApproveDialog(props: { ex: Exemption; who: string; onClose: () => void; onDone: () => void }) {
  const { api } = useAuth();
  const [proof, setProof] = useState(!!props.ex.proof_checked_at || props.ex.source === "computed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!proof) return setError("לפני אישור צריך לבדוק את האסמכתא");
    setBusy(true);
    try {
      if (!props.ex.proof_checked_at && props.ex.source !== "computed") await api!.markProofChecked(props.ex.id);
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
    </FormDialog>
  );
}

function ExemptionsTab({ ctx }: { ctx: Ctx }) {
  const narrow = useNarrow();
  const { api } = useAuth();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Exemption[] | null>(null);
  const [types, setTypes] = useState<ExemptionType[]>([]);
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [status, setStatus] = useState<RequestStatus | "">((params.get("status") as RequestStatus) ?? "");
  const [adding, setAdding] = useState(false);
  const [approving, setApproving] = useState<Exemption | null>(null);
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
  useEffect(() => void load(), [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) return <Loading />;
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const taskName = new Map(tasks.map((t) => [t.id, t.name]));
  const shown = rows.filter((r) => (!status || r.status === status) && filter.match(r.soldier_id));
  const pending = rows.filter((r) => r.status === "pending").length;

  const scope = (r: Exemption) => {
    if (r.kind === "full") return "לפי הסוג";
    const parts = (r.excluded_task_type_ids ?? []).map((id) => taskName.get(id) ?? "?");
    if (r.restricted_hours) parts.push(`שעות ${r.restricted_hours}`);
    return parts.join(", ");
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          פטור חדש
        </Button>
        {filter.controls}
        <TextField select size="small" label="סטטוס" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | "")} sx={{ minWidth: 130 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
          <MenuItem value="">הכל</MenuItem>
          {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((s) => (
            <MenuItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </TextField>
        {pending > 0 && <Chip color="warning" label={`${pending} ממתינים לאישור`} onClick={() => setStatus("pending")} />}
      </Stack>
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
              ]}
              actions={
                r.status === "pending" ? (
                  <>
                    <Button size="small" variant="contained" startIcon={<CheckIcon />} onClick={() => setApproving(r)}>
                      אישור
                    </Button>
                    <Button size="small" color="error" startIcon={<CloseIcon />} onClick={() => setRejecting({ ex: r, action: "reject" })}>
                      דחייה
                    </Button>
                  </>
                ) : r.status === "approved" ? (
                  <Button size="small" color="inherit" onClick={() => setRejecting({ ex: r, action: "cancel" })}>
                    ביטול
                  </Button>
                ) : undefined
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
                  <TableCell>{scope(r)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {fmt(r.start_date)} – {fmt(r.end_date)}
                  </TableCell>
                  <TableCell>{r.source === "computed" ? "מחושב" : r.proof_checked_at ? `נבדקה ${fmt(r.proof_checked_at)}` : "—"}</TableCell>
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
                    {r.status === "approved" && (
                      <Button size="small" color="inherit" onClick={() => setRejecting({ ex: r, action: "cancel" })}>
                        ביטול
                      </Button>
                    )}
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
      {approving && (
        <ApproveDialog
          ex={approving}
          who={nameOf(ctx, approving.soldier_id)}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
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
  useEffect(() => void load(), [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) return <Loading />;
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const shown = rows.filter((r) => (showCancelled || r.status === "active") && filter.match(r.soldier_id));

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          היעדרות חדשה
        </Button>
        {filter.controls}
        <FormControlLabel control={<Switch checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />} label="הצג מבוטלות" />
      </Stack>
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
                    <Button size="small" color="inherit" onClick={() => setCancelling(r)}>
                      ביטול
                    </Button>
                  ) : undefined
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
                    <TableCell>
                      {r.status === "active" ? (
                        <Button size="small" color="inherit" onClick={() => setCancelling(r)}>
                          ביטול
                        </Button>
                      ) : (
                        <Tooltip title={r.cancel_reason ?? ""}>
                          <Chip size="small" label="בוטלה" />
                        </Tooltip>
                      )}
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
  useEffect(() => void load(), [load]);

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
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
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
        {filter.controls}
        <FormControlLabel control={<Switch checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />} label="הצג מבוטלות" />
      </Stack>
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
// Gaf template (Excel)
// ---------------------------------------------------------------------------

function ExcelTab({ ctx }: { ctx: Ctx }) {
  const { api } = useAuth();
  const filter = useFilter(ctx);
  const [gaf, setGaf] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ parsed: ParsedConstraints; blocks: ParsedConstraints["blocks"]; absences: ParsedConstraints["absences"]; skipped: number; quota: Map<number, string> } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const templateSoldiers = ctx.soldiers.filter((s) => s.is_active && (!gaf || s.gaf_name === gaf));

  async function download() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(templateRows(templateSoldiers));
    ws["!cols"] = [{ wch: 38, hidden: true }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
    const types = await api!.absenceTypes();
    const help = XLSX.utils.aoa_to_sheet([
      ["הוראות"],
      [`מחזור: ${ctx.cycle.name} (${fmt(ctx.cycle.start_date)} – ${fmt(ctx.cycle.end_date)})`],
      ["תאריכים בפורמט יום/חודש/שנה, למשל 15/01/2027."],
      ["חסימה: תאריך אחד לעובד בחודש."],
      ["היעדרות: סוג, מתאריך ועד תאריך (כולל). ליותר מהיעדרות אחת – העתיקו את שורת העובד."],
      ["אין לשנות את העמודה הנסתרת עם מזהה העובד."],
      [],
      ["סוגי היעדרות:"],
      ...types.map((t) => [t.name]),
    ]);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "אילוצים");
    XLSX.utils.book_append_sheet(wb, help, "הוראות");
    XLSX.writeFile(wb, `אילוצים-${gaf || "כל-המסגרות"}-${ctx.cycle.start_date}.xlsx`);
  }

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    setPlan(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
      const [types, blocks, absences, quota] = await Promise.all([
        api!.absenceTypes(),
        api!.dateBlocks(ctx.cycle.start_date, ctx.cycle.end_date),
        api!.absences(ctx.cycle.start_date, ctx.cycle.end_date),
        api!.blockQuota(),
      ]);
      const parsed = parseTemplate(rows, ctx.soldiers, types, { from: ctx.cycle.start_date, to: ctx.cycle.end_date });
      const d = dedupeConstraints(parsed, blocks, absences);
      setPlan({ parsed, ...d, quota: blockQuotaProblems(d.blocks, blocks, quota) });
    } catch (e) {
      setMsg({ ok: false, text: `לא הצלחתי לקרוא את הקובץ: ${(e as Error).message}` });
    }
    setBusy(false);
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    try {
      const blocks = plan.blocks.filter((_, i) => !plan.quota.has(i));
      await api!.addAbsences(plan.absences);
      await api!.addDateBlocks(blocks, ctx.cycle.id);
      setMsg({ ok: true, text: `נקלטו ${plan.absences.length} היעדרויות ו-${blocks.length} חסימות.` });
      setPlan(null);
      ctx.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  const problems = plan ? [...plan.parsed.errors, ...[...plan.quota].map(([i, m]) => ({ line: plan.blocks[i].line, message: `${plan.blocks[i].name}: ${m}` }))] : [];

  return (
    <Stack spacing={2} sx={{ maxWidth: 860 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h3">1. הורדת תבנית למסגרת</Typography>
          <Typography variant="body2" color="text.secondary">
            התבנית כוללת את רשימת העובדים של המסגרת. נציג המסגרת ממלא חסימות והיעדרויות ומחזיר אותה. בלי מספרים אישיים.
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <TextField select size="small" label="מסגרת" value={gaf} onChange={(e) => setGaf(e.target.value)} sx={{ minWidth: 180 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
              <MenuItem value="">כל המסגרות</MenuItem>
              {filter.gafim.map((g) => (
                <MenuItem key={g} value={g}>
                  {g}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={download} disabled={!templateSoldiers.length}>
              הורדת תבנית ({templateSoldiers.length} עובדים)
            </Button>
          </Stack>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h3">2. טעינת תבנית מלאה</Typography>
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
                  if (f) void upload(f);
                }}
              />
            </Button>
          </Box>
          {busy && <CircularProgress size={24} />}
          {msg && <Alert severity={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          {plan && (
            <>
              <Alert severity={plan.absences.length + plan.blocks.length - plan.quota.size > 0 ? "info" : "warning"}>
                ייקלטו {plan.absences.length} היעדרויות ו-{plan.blocks.length - plan.quota.size} חסימות.
                {plan.skipped > 0 && ` ${plan.skipped} שורות כבר רשומות במערכת ודולגו.`}
              </Alert>
              {problems.length > 0 && (
                <Alert severity="warning">
                  <b>{problems.length} שורות לא ייקלטו:</b>
                  <List dense disablePadding>
                    {problems.slice(0, 30).map((p, i) => (
                      <ListItem key={i} disableGutters sx={{ py: 0 }}>
                        שורה {p.line}: {p.message}
                      </ListItem>
                    ))}
                  </List>
                </Alert>
              )}
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={apply} disabled={busy || plan.absences.length + plan.blocks.length - plan.quota.size === 0}>
                  קליטה
                </Button>
                <Button onClick={() => setPlan(null)}>ביטול</Button>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------

const TABS = [
  { key: "exemptions", label: "פטורים" },
  { key: "absences", label: "היעדרויות" },
  { key: "blocks", label: "חסימות" },
  { key: "excel", label: "תבנית למסגרות" },
] as const;

export function ConstraintsPage() {
  const { api } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab"))?.key ?? "exemptions";
  const narrow = useNarrow();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [soldiers, setSoldiers] = useState<ExistingSoldier[]>([]);
  const { cycleId } = useCycle();
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
  }, [api, cyclesVersion]);

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
              <Tab key={t.key} value={t.key} label={narrow && t.key === "excel" ? "תבנית" : t.label} />
            ))}
          </Tabs>
          <Box key={`${ctx.cycle.id}-${version}`}>
            {tab === "exemptions" && <ExemptionsTab ctx={ctx} />}
            {tab === "absences" && <AbsencesTab ctx={ctx} />}
            {tab === "blocks" && <BlocksTab ctx={ctx} />}
            {tab === "excel" && <ExcelTab ctx={ctx} />}
          </Box>
        </>
      )}
    </Stack>
  );
}

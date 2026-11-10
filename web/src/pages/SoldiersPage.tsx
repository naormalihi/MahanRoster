import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import SearchIcon from "@mui/icons-material/Search";
import UploadIcon from "@mui/icons-material/UploadFileOutlined";
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
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { NamedRef } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  activeLoadRole,
  activeLoadRoles,
  todayIso,
  effectiveHomeNightly,
  effectiveParent,
  effectiveService,
  rangeState,
  type LoadRoleRef,
  type RangeState,
  type SoldierDetail,
  type SoldierLoadRole,
  type SoldierPatch,
} from "../lib/soldiers";

const SERVICE = { mandatory: "חובה", career: "קבע" } as const;
const RANGE_CHIP: Record<RangeState, { label: string; color: "default" | "error" | "warning" | "success" }> = {
  missing: { label: "לא הוזן", color: "default" },
  expired: { label: "פג", color: "error" },
  expiring: { label: "פג בקרוב", color: "warning" },
  valid: { label: "בתוקף", color: "success" },
};

const fmt = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

function RangeChip({ until }: { until: string | null }) {
  const st = rangeState(until);
  const c = RANGE_CHIP[st];
  return <Chip size="small" color={c.color} variant={st === "valid" ? "outlined" : "filled"} label={st === "missing" ? c.label : `${c.label} · ${fmt(until)}`} />;
}

function DateField(props: { label: string; value: string | null; onChange: (v: string | null) => void; helperText?: string }) {
  return (
    <TextField
      type="date"
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
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useAuth();
  const s = props.soldier;
  const fullScreen = useMediaQuery(useTheme().breakpoints.down("sm"));
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
    home_nightly_override: s.home_nightly_override,
    home_nightly_override_reason: s.home_nightly_override_reason,
    home_nightly_override_until: s.home_nightly_override_until,
    is_active: s.is_active,
  });
  const [roles, setRoles] = useState<Omit<SoldierLoadRole, "name" | "factor">[]>(
    s.load_roles.map(({ load_role_id, valid_from, valid_to }) => ({ load_role_id, valid_from, valid_to })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SoldierPatch>(k: K, v: SoldierPatch[K]) => setP((x) => ({ ...x, [k]: v }));

  const problems: string[] = [];
  if (p.parent_override !== null && !p.parent_override_reason?.trim()) problems.push("שינוי ידני של משרת הורה מחייב סיבה");
  if (roles.some((r) => !r.load_role_id || !r.valid_from)) problems.push("לכל תפקיד הקלה צריך סוג ותאריך התחלה");

  async function save() {
    if (problems.length) return setError(problems[0]);
    setBusy(true);
    setError(null);
    try {
      const patch = {
        ...p,
        parent_override_reason: p.parent_override === null ? null : p.parent_override_reason,
        home_nightly_override_reason: p.home_nightly_override === null ? null : p.home_nightly_override_reason,
      };
      await api!.updateSoldiers([s.id], patch);
      await api!.setSoldierLoadRoles(s.id, roles);
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const parentChoice = p.parent_override === null ? "file" : p.parent_override ? "yes" : "no";

  return (
    <Dialog open onClose={props.onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle>
        {s.full_name}
        <Typography variant="body2" color="text.secondary">
          {s.rank_name} · {s.gaf_name} · {SERVICE[effectiveService(s)]}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h3" gutterBottom>מטווח</Typography>
            <DateField
              label="תוקף מטווח עד"
              value={p.range_valid_until}
              onChange={(v) => set("range_valid_until", v)}
              helperText="ריק = בתוקף כברירת מחדל, כל עוד ההנחה מופעלת בהגדרות"
            />
          </Box>
          <Divider />
          <Box>
            <Typography variant="h3" gutterBottom>דרגת מינוי</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              במקום הדרגה המחושבת ({s.rank_name || "—"}), למשל סרן במינוי רס"ן.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField select label="דרגת מינוי" value={p.appointment_rank_id ?? ""} onChange={(e) => set("appointment_rank_id", e.target.value || null)} fullWidth>
                <MenuItem value="">— ללא —</MenuItem>
                {props.ranks.map((r) => (
                  <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                ))}
              </TextField>
              <DateField label="בתוקף עד" value={p.appointment_rank_until} onChange={(v) => set("appointment_rank_until", v)} />
            </Stack>
          </Box>
          <Divider />
          <Box>
            <Typography variant="h3" gutterBottom>משרת הורה</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              לפי הקובץ: {s.parent_status ? "כן" : "לא"}. שינוי ידני גובר על הקובץ עד התאריך שנקבע.
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                select
                label="מקור"
                value={parentChoice}
                onChange={(e) => set("parent_override", e.target.value === "file" ? null : e.target.value === "yes")}
              >
                <MenuItem value="file">לפי הקובץ</MenuItem>
                <MenuItem value="yes">משרת הורה – ידני</MenuItem>
                <MenuItem value="no">לא משרת הורה – ידני</MenuItem>
              </TextField>
              {p.parent_override !== null && (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <TextField label="סיבה" value={p.parent_override_reason ?? ""} onChange={(e) => set("parent_override_reason", e.target.value)} fullWidth />
                  <DateField label="עד תאריך" value={p.parent_override_until} onChange={(v) => set("parent_override_until", v)} />
                </Stack>
              )}
            </Stack>
          </Box>
          <Divider />
          <Box>
            <Typography variant="h3" gutterBottom>תפקיד שני</Typography>
            <Stack spacing={1.5}>
              <DateField
                label="תאריך חתימה על המשך שירות קבע (תפקיד שני)"
                value={p.second_role_signed_at}
                onChange={(v) => set("second_role_signed_at", v)}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
                <FormControlLabel control={<Switch checked={p.is_shachar} onChange={(e) => set("is_shachar", e.target.checked)} />} label="שח״ר" />
              </Stack>
            </Stack>
          </Box>
          <Divider />
          <Box>
            <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
              <Typography variant="h3" sx={{ flex: 1 }}>תפקידי הקלה</Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setRoles([...roles, { load_role_id: props.loadRoles[0]?.id ?? "", valid_from: new Date().toISOString().slice(0, 10), valid_to: null }])}
              >
                הוספה
              </Button>
            </Stack>
            {roles.length === 0 && <Typography variant="body2" color="text.secondary">אין. מקדם 1.0</Typography>}
            <Stack spacing={1.5}>
              {roles.map((r, i) => (
                <Stack key={i} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
                  <TextField
                    select
                    label="תפקיד"
                    value={r.load_role_id}
                    onChange={(e) => setRoles(roles.map((x, j) => (j === i ? { ...x, load_role_id: e.target.value } : x)))}
                    sx={{ minWidth: 160 }}
                  >
                    {props.loadRoles.map((lr) => (
                      <MenuItem key={lr.id} value={lr.id}>{lr.name}</MenuItem>
                    ))}
                  </TextField>
                  <DateField label="מתאריך" value={r.valid_from} onChange={(v) => setRoles(roles.map((x, j) => (j === i ? { ...x, valid_from: v ?? "" } : x)))} />
                  <IconButton aria-label="מחיקה" onClick={() => setRoles(roles.filter((_, j) => j !== i))}>
                    <DeleteIcon />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          </Box>
          <Divider />
          <FormControlLabel
            control={<Switch checked={p.is_active} onChange={(e) => set("is_active", e.target.checked)} />}
            label="פעיל ביחידה"
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" onClick={save} disabled={busy}>שמירה</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk range dialog
// ---------------------------------------------------------------------------

function BulkRangeDialog(props: { count: number; onClose: () => void; onApply: (date: string | null) => Promise<void> }) {
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>עדכון תוקף מטווח ל-{props.count} חיילים</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <DateField label="תוקף מטווח עד" value={date} onChange={setDate} helperText="ריק = מחיקת התאריך" />
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
  const { api } = useAuth();
  const [rows, setRows] = useState<SoldierDetail[] | null>(null);
  const [ranks, setRanks] = useState<NamedRef[]>([]);
  const [loadRoles, setLoadRoles] = useState<LoadRoleRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [gaf, setGaf] = useState("");
  const [service, setService] = useState("");
  const [range, setRange] = useState("");
  const [rank, setRank] = useState("");
  const [relief, setRelief] = useState(""); // "" all · "any" · "none" · a load role id
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<SoldierDetail | null>(null);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r, lr] = await Promise.all([api!.soldierDetails(), api!.ranks(), api!.loadRoles()]);
      setRows(s);
      setRanks(r);
      setLoadRoles(lr);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const gafim = useMemo(() => [...new Set((rows ?? []).map((s) => s.gaf_name))].sort(), [rows]);
  const rankName = useMemo(() => new Map(ranks.map((r) => [r.id, r.name])), [ranks]);
  // a rank appointment in force counts as the soldier's rank too (סרן במינוי רס"ן appears under both)
  const appointedNow = (s: SoldierDetail) => !!s.appointment_rank_id && (!s.appointment_rank_until || s.appointment_rank_until >= todayIso());
  // ranks present among the soldiers, in the catalog's order
  const rankOptions = useMemo(() => {
    const present = new Set((rows ?? []).flatMap((s) => [s.rank_name, appointedNow(s) ? rankName.get(s.appointment_rank_id!) : undefined]));
    return ranks.map((r) => r.name).filter((n) => present.has(n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ranks, rankName]);

  const shown = (rows ?? []).filter(
    (s) =>
      (showInactive || s.is_active) &&
      (!q || s.full_name.includes(q.trim())) &&
      (!gaf || s.gaf_name === gaf) &&
      (!service || effectiveService(s) === service) &&
      (!rank || s.rank_name === rank || (appointedNow(s) && rankName.get(s.appointment_rank_id!) === rank)) &&
      (!relief ||
        (relief === "any"
          ? activeLoadRoles(s).length > 0
          : relief === "none"
            ? activeLoadRoles(s).length === 0
            : activeLoadRoles(s).some((r) => r.load_role_id === relief))) &&
      (!range ||
        (range === "issues" ? ["expired", "expiring"].includes(rangeState(s.range_valid_until)) : rangeState(s.range_valid_until) === range)),
  );
  const allSelected = shown.length > 0 && shown.every((s) => selected.has(s.id));
  const counts = useMemo(() => {
    const active = (rows ?? []).filter((s) => s.is_active);
    return {
      active: active.length,
      mandatory: active.filter((s) => effectiveService(s) === "mandatory").length,
      career: active.filter((s) => effectiveService(s) === "career").length,
      rangeIssues: active.filter((s) => ["expired", "expiring"].includes(rangeState(s.range_valid_until))).length,
    };
  }, [rows]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Typography variant="h1" sx={{ flex: 1 }}>
          חיילים
        </Typography>
        <Button variant="contained" startIcon={<UploadIcon />} component={RouterLink} to="/soldiers/import">
          טעינת כוח אדם
        </Button>
      </Stack>
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
            onClick={() => setService(service === "mandatory" ? "" : "mandatory")}
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
        </Stack>
      )}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)", md: "2fr repeat(5, 1fr)" } }}>
          <TextField
            sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}
            placeholder="חיפוש לפי שם"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          />
          <TextField select label="גף" value={gaf} onChange={(e) => setGaf(e.target.value)}>
            <MenuItem value="">כל הגפים</MenuItem>
            {gafim.map((g) => (
              <MenuItem key={g} value={g}>{g}</MenuItem>
            ))}
          </TextField>
          <TextField select label="דרגה" value={rank} onChange={(e) => setRank(e.target.value)}>
            <MenuItem value="">כל הדרגות</MenuItem>
            {rankOptions.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="הקלה" value={relief} onChange={(e) => setRelief(e.target.value)}>
            <MenuItem value="">הכול</MenuItem>
            <MenuItem value="any">עם הקלה</MenuItem>
            <MenuItem value="none">בלי הקלה</MenuItem>
            {loadRoles.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="שירות" value={service} onChange={(e) => setService(e.target.value)}>
            <MenuItem value="">הכול</MenuItem>
            <MenuItem value="mandatory">חובה</MenuItem>
            <MenuItem value="career">קבע</MenuItem>
          </TextField>
          <TextField select label="מטווח" value={range} onChange={(e) => setRange(e.target.value)}>
            <MenuItem value="">הכול</MenuItem>
            <MenuItem value="missing">לא הוזן</MenuItem>
            <MenuItem value="expired">פג</MenuItem>
            <MenuItem value="expiring">פג בקרוב</MenuItem>
            <MenuItem value="issues">פג או פג בקרוב</MenuItem>
            <MenuItem value="valid">בתוקף</MenuItem>
          </TextField>
        </Box>
        <Stack direction="row" spacing={1.5} sx={{ mt: 1.5, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          <FormControlLabel control={<Switch checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />} label="הצגת לא פעילים" />
          <Box sx={{ flex: 1 }} />
          {selected.size > 0 && (
            <>
              <Typography variant="body2">נבחרו {selected.size}</Typography>
              <Button variant="contained" onClick={() => setBulk(true)}>עדכון מטווח לנבחרים</Button>
              <Button onClick={() => setSelected(new Set())}>ניקוי בחירה</Button>
            </>
          )}
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {!rows && !error && (
        <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {rows && rows.length === 0 && <Alert severity="info">אין עדיין חיילים. טען קובץ כוח אדם במסך "כוח אדם".</Alert>}

      {rows && rows.length > 0 && (
        <Paper sx={{ overflow: "hidden" }}>
          <Box sx={{ overflowX: "auto", maxHeight: "70vh" }}>
            <Table size="small" stickyHeader sx={{ minWidth: 820 }}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && shown.some((s) => selected.has(s.id))}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((s) => s.id)))}
                      slotProps={{ input: { "aria-label": "בחירת כל המוצגים" } }}
                    />
                  </TableCell>
                  {["שם", "דרגה", "גף", "שירות", "מטווח", "הורה / ת״ש", "הקלה", "תפקיד שני", ""].map((h, i) => (
                    <TableCell key={i}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((s) => {
                  const lr = activeLoadRole(s);
                  const appointed = s.appointment_rank_id && (!s.appointment_rank_until || s.appointment_rank_until >= new Date().toISOString().slice(0, 10));
                  return (
                    <TableRow key={s.id} hover selected={selected.has(s.id)} sx={{ opacity: s.is_active ? 1 : 0.5 }}>
                      <TableCell padding="checkbox">
                        <Checkbox checked={selected.has(s.id)} onChange={() => toggle(s.id)} slotProps={{ input: { "aria-label": `בחירת ${s.full_name}` } }} />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>{s.full_name}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {s.rank_name}
                        {appointed && (
                          <Typography component="span" variant="caption" color="secondary.main">
                            {" "}(מינוי {rankName.get(s.appointment_rank_id!)})
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{s.gaf_name}</TableCell>
                      <TableCell>{SERVICE[effectiveService(s)]}</TableCell>
                      <TableCell><RangeChip until={s.range_valid_until} /></TableCell>
                      <TableCell>
                        {effectiveParent(s) ? "כן" : "—"}
                        {s.parent_override !== null && <Typography component="span" variant="caption" color="text.secondary"> (ידני)</Typography>}
                        {effectiveHomeNightly(s) && <Chip size="small" variant="outlined" label="ת״ש 7" sx={{ mr: 0.5 }} />}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {activeLoadRoles(s).length === 0
                          ? "—"
                          : activeLoadRoles(s).map((r) => (
                              <Chip
                                key={r.load_role_id + r.valid_from}
                                size="small"
                                label={`${r.name} ×${r.factor}`}
                                color={r.load_role_id === lr?.load_role_id ? "primary" : "default"}
                                variant={r.load_role_id === lr?.load_role_id ? "filled" : "outlined"}
                                title={r.load_role_id === lr?.load_role_id ? "ההקלה שחלה (הגדולה מביניהן)" : "לא חלה – יש הקלה גדולה יותר"}
                                sx={{ ml: 0.5 }}
                              />
                            ))}
                      </TableCell>
                      <TableCell>{fmt(s.second_role_signed_at)}</TableCell>
                      <TableCell padding="checkbox">
                        <IconButton aria-label={`עריכת ${s.full_name}`} onClick={() => setEditing(s)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", p: 1 }}>
            מוצגים {shown.length} מתוך {rows.length}. סוג השירות מוצג לפי היום; במחזור הוא נקבע לפי תאריך תחילת המחזור.
          </Typography>
        </Paper>
      )}

      {editing && (
        <EditDialog
          soldier={editing}
          ranks={ranks}
          loadRoles={loadRoles}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {bulk && (
        <BulkRangeDialog
          count={selected.size}
          onClose={() => setBulk(false)}
          onApply={async (date) => {
            await api!.updateSoldiers([...selected], { range_valid_until: date });
            setBulk(false);
            setSelected(new Set());
            await load();
          }}
        />
      )}
    </Stack>
  );
}

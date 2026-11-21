import CalculateIcon from "@mui/icons-material/Calculate";
import { frameworkName } from "../lib/gafName";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  Chip,
  alpha,
  type Theme,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NamedRef } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCycle } from "../lib/cycleContext";
import { useCanEdit } from "../components/ReadOnly";
import type { Cycle } from "../lib/cycles";
import {
  cellText,
  effective,
  exportSheets,
  heat,
  overrideProblems,
  reasonText,
  summarize,
  weekly,
  type DailyAvailability,
  type PotentialCell,
  type SnapshotSoldier,
} from "../lib/potential";
import type { ExistingSoldier } from "../lib/roster";
import { CardList, RowCard, useNarrow } from "../components/CardList";

const fmt = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const short = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

function Loading() {
  return (
    <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
      <CircularProgress />
    </Box>
  );
}

interface Data {
  cells: PotentialCell[];
  snapshot: SnapshotSoldier[];
  daily: DailyAvailability[] | null;
}

// ---------------------------------------------------------------------------

function OverrideDialog(props: {
  cell: PotentialCell;
  who: string;
  category: string;
  onClose: () => void;
  onSave: (value: number, reason: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const c = props.cell;
  const [value, setValue] = useState(String(c.override_value ?? c.value));
  const [reason, setReason] = useState(c.override_reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(f: () => Promise<void>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {props.who} · {props.category}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2">
            ערך מחושב: <b>{cellText(c.value) || "לא זכאי"}</b>
            {c.value > 0 && c.value < 1 && ` (זמין ${c.available_days} מתוך ${c.cycle_days} ימים)`}
            {c.value === 0 && c.reasons.length > 0 && ` – ${reasonText(c.reasons)}`}
          </Typography>
          <TextField
            type="number"
            label="ערך מתוקן (0 עד 1)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
            autoFocus
          />
          <TextField label="נימוק" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {c.override_value !== null && (
          <Button color="error" onClick={() => run(props.onClear)} disabled={busy} sx={{ ml: "auto" }}>
            החזרה לערך המחושב
          </Button>
        )}
        <Button onClick={props.onClose}>ביטול</Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => {
            const v = Number(value);
            const p = overrideProblems(v, reason);
            if (p) return setError(p);
            void run(() => props.onSave(v, reason.trim()));
          }}
        >
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MatrixTab(props: {
  cycle: Cycle;
  data: Data;
  soldiers: Map<string, ExistingSoldier>;
  categories: NamedRef[];
  reload: () => void;
  locked?: boolean;
}) {
  const { api } = useAuth();
  const { data, categories } = props;
  const [q, setQ] = useState("");
  const [gaf, setGaf] = useState("");
  const [onlyEligible, setOnlyEligible] = useState(true);
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [editing, setEditing] = useState<PotentialCell | null>(null);
  const narrow = useNarrow();

  const at = useMemo(() => new Map(data.cells.map((c) => [`${c.soldier_id}|${c.category_id}`, c])), [data.cells]);
  const rank = useMemo(() => new Map(data.snapshot.map((s) => [s.soldier_id, s.rank_name])), [data.snapshot]);
  const summary = summarize(data.cells, categories.map((c) => c.id));
  const gafim = [...new Set(data.snapshot.map((s) => props.soldiers.get(s.soldier_id)?.gaf_name ?? ""))].sort((a, b) => a.localeCompare(b, "he"));

  const rows = data.snapshot
    .map((s) => ({ s, info: props.soldiers.get(s.soldier_id) }))
    .filter(({ s, info }) => {
      if (q && !info?.full_name.includes(q.trim())) return false;
      if (gaf && info?.gaf_name !== gaf) return false;
      const mine = categories.map((c) => at.get(`${s.soldier_id}|${c.id}`)).filter(Boolean) as PotentialCell[];
      if (onlyEligible && !mine.some((c) => effective(c) > 0)) return false;
      if (onlyMarked && !mine.some((c) => c.override_value !== null || (effective(c) > 0 && effective(c) < 1))) return false;
      return true;
    })
    .sort((a, b) => (a.info?.gaf_name ?? "").localeCompare(b.info?.gaf_name ?? "", "he") || (a.info?.full_name ?? "").localeCompare(b.info?.full_name ?? "", "he"));

  const cellSx = (c: PotentialCell | undefined) => {
    if (!c) return {};
    const v = effective(c);
    return {
      textAlign: "center" as const,
      cursor: "pointer",
      fontVariantNumeric: "tabular-nums",
      bgcolor: (t: Theme) => (v === 1 ? alpha(t.palette.success.main, 0.16) : v > 0 ? alpha(t.palette.warning.main, 0.18) : undefined),
      outline: c.override_value !== null ? "2px solid #e8700f" : undefined,
      outlineOffset: -3,
      "&:hover": { bgcolor: "action.hover" },
    };
  };
  const cellTitle = (c: PotentialCell) => {
    const parts: string[] = [];
    if (c.value === 0) parts.push(reasonText(c.reasons) || "לא זכאי");
    else if (c.value < 1) parts.push(`זמין ${c.available_days} מתוך ${c.cycle_days} ימים`);
    if (c.override_value !== null) parts.push(`תוקן ידנית (מחושב: ${cellText(c.value) || "0"}) – ${c.override_reason}`);
    return parts.join("\n");
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <TextField
          size="small"
          placeholder="חיפוש לפי שם"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <TextField select size="small" label="מסגרת" value={gaf} onChange={(e) => setGaf(e.target.value)} sx={{ minWidth: 140 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
          <MenuItem value="">כל המסגרות</MenuItem>
          {gafim.map((g) => (
            <MenuItem key={g} value={g}>
              {frameworkName(g)}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel control={<Switch checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} />} label="רק זכאים" />
        <FormControlLabel control={<Switch checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />} label="רק חלקיים ומתוקנים" />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {narrow
          ? "ירוק = זמין לכל המחזור · כתום = לחלק מהמחזור (השבר) · מסגרת כתומה = תוקן ידנית. לחיצה על קטגוריה פותחת תיקון."
          : "1 = זמין לכל המחזור · ריק = לא זכאי · שבר = חלק המחזור שבו זמין. מסגרת כתומה = תוקן ידנית. מעבר עם העכבר מראה את הסיבה; לחיצה על תא פותחת תיקון."}
      </Typography>
      {narrow ? (
        <>
          <Paper variant="outlined" sx={{ p: 1.25, bgcolor: (t) => alpha(t.palette.primary.main, 0.1) }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              סה״כ פוטנציאל
            </Typography>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap" }}>
              {summary.map((x) => (
                <Chip key={x.category_id} size="small" sx={{ bgcolor: "background.paper" }} label={`${categories.find((c) => c.id === x.category_id)?.name ?? ""} · ${x.total}`} />
              ))}
            </Stack>
          </Paper>
          <CardList>
            {rows.map(({ s, info }) => {
              const cells = categories.map((c) => ({ c, cell: at.get(`${s.soldier_id}|${c.id}`) })).filter((x) => x.cell) as { c: NamedRef; cell: PotentialCell }[];
              const open = cells.filter((x) => effective(x.cell) > 0 || x.cell.override_value !== null);
              const closed = cells.filter((x) => !(effective(x.cell) > 0 || x.cell.override_value !== null));
              return (
                <RowCard
                  key={s.soldier_id}
                  title={info?.full_name ?? "—"}
                  sub={`${frameworkName(info?.gaf_name)} · ${rank.get(s.soldier_id) ?? ""}`}
                  lines={[
                    <Stack key="o" component="span" direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.25 }}>
                      {open.length === 0 && "לא זכאי לאף קטגוריה"}
                      {open.map(({ c, cell }) => {
                        const v = effective(cell);
                        return (
                          <Chip
                            key={c.id}
                            size="small"
                            label={`${c.name} ${cellText(v) || "0"}`}
                            title={cellTitle(cell)}
                            onClick={props.locked ? undefined : () => setEditing(cell)}
                            sx={{
                              bgcolor: (t) => (v === 1 ? alpha(t.palette.success.main, 0.16) : v > 0 ? alpha(t.palette.warning.main, 0.18) : undefined),
                              border: cell.override_value !== null ? "2px solid #e8700f" : undefined,
                            }}
                          />
                        );
                      })}
                    </Stack>,
                    closed.length > 0 && (
                      <Stack key="c" component="span" direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5, alignItems: "center" }}>
                        <Typography component="span" variant="caption" color="text.secondary">
                          לא זכאי:
                        </Typography>
                        {closed.map(({ c, cell }) => (
                          <Chip key={c.id} size="small" variant="outlined" label={c.name} title={cellTitle(cell)} onClick={props.locked ? undefined : () => setEditing(cell)} />
                        ))}
                      </Stack>
                    ),
                  ]}
                />
              );
            })}
          </CardList>
        </>
      ) : (
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "70vh" }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>עובד</TableCell>
              <TableCell>מסגרת</TableCell>
              <TableCell>דרגה</TableCell>
              {categories.map((c) => (
                <TableCell key={c.id} sx={{ textAlign: "center", whiteSpace: "nowrap" }}>
                  {c.name}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} sx={{ top: 37, fontWeight: 700, bgcolor: (t) => alpha(t.palette.primary.main, 0.1) }}>
                סה״כ פוטנציאל
              </TableCell>
              {summary.map((s) => (
                <TableCell key={s.category_id} sx={{ top: 37, textAlign: "center", fontWeight: 700, bgcolor: (t) => alpha(t.palette.primary.main, 0.1) }} title={`${s.full} מלאים · ${s.partial} חלקיים · ${s.overrides} תיקונים`}>
                  {s.total}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ s, info }) => (
              <TableRow key={s.soldier_id} hover>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{info?.full_name ?? "—"}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{frameworkName(info?.gaf_name)}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{rank.get(s.soldier_id)}</TableCell>
                {categories.map((c) => {
                  const cell = at.get(`${s.soldier_id}|${c.id}`);
                  return (
                    <TableCell key={c.id} sx={cellSx(cell)} title={cell ? cellTitle(cell) : undefined} onClick={() => cell && !props.locked && setEditing(cell)}>
                      {cell ? cellText(effective(cell)) : ""}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      )}
      <Typography variant="caption" color="text.secondary">
        {rows.length} עובדים מוצגים מתוך {data.snapshot.length} במחזור.
      </Typography>
      {editing && (
        <OverrideDialog
          cell={editing}
          who={props.soldiers.get(editing.soldier_id)?.full_name ?? ""}
          category={categories.find((c) => c.id === editing.category_id)?.name ?? ""}
          onClose={() => setEditing(null)}
          onSave={async (v, r) => {
            await api!.setPotentialOverride(props.cycle.id, editing.soldier_id, editing.category_id, v, r);
            setEditing(null);
            props.reload();
          }}
          onClear={async () => {
            await api!.clearPotentialOverride(props.cycle.id, editing.soldier_id, editing.category_id);
            setEditing(null);
            props.reload();
          }}
        />
      )}
    </Stack>
  );
}

function HeatTab({ daily, categories }: { daily: DailyAvailability[] | null; categories: NamedRef[] }) {
  if (!daily) return <Loading />;
  const rows = categories.map((c) => ({ c, weeks: weekly(daily, c.id) })).filter((r) => r.weeks.length);
  const weeks = rows[0]?.weeks.map((w) => w.week_start) ?? [];
  const dark = useTheme().palette.mode === "dark";
  // red (weak) to green; deep shades on a dark background so the white numbers stay readable
  const color = (t: number) => `hsl(${Math.round(t * 120)}, ${dark ? 45 : 60}%, ${dark ? 22 + t * 6 : 88 - t * 8}%)`;
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        בכל תא: כמה עובדים זמינים לקטגוריה ביום הכי חלש של השבוע (אחרי היעדרויות, פטורים, גיוס ושחרור). אדום = השבועות החלשים של אותה קטגוריה.
        התיקונים הידניים במטריצה לא נכללים כאן.
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ "& td, & th": { px: 0.75 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: "sticky", insetInlineStart: 0, bgcolor: "background.paper", zIndex: 2 }}>קטגוריה</TableCell>
              {weeks.map((w) => (
                <TableCell key={w} sx={{ textAlign: "center", fontSize: 12, whiteSpace: "nowrap" }}>
                  {short(w)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ c, weeks: ws }) => {
              const all = ws.map((w) => w.min);
              return (
                <TableRow key={c.id}>
                  <TableCell sx={{ whiteSpace: "nowrap", position: "sticky", insetInlineStart: 0, bgcolor: "background.paper", zIndex: 1, fontWeight: 600 }}>{c.name}</TableCell>
                  {ws.map((w) => (
                    <TableCell
                      key={w.week_start}
                      title={`שבוע שמתחיל ב-${fmt(w.week_start)}: ${w.min} זמינים ביום החלש (${fmt(w.worst_day)})`}
                      sx={{ textAlign: "center", bgcolor: color(heat(w.min, all)), fontVariantNumeric: "tabular-nums" }}
                    >
                      {w.min}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

// ---------------------------------------------------------------------------

export function PotentialPage() {
  const { api } = useAuth();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const { cycleId, reload: reloadCycle, locked } = useCycle();
  const canEdit = useCanEdit();
  const [soldiers, setSoldiers] = useState<Map<string, ExistingSoldier>>(new Map());
  const [categories, setCategories] = useState<NamedRef[]>([]);
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"matrix" | "heat">("matrix");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCycles = useCallback(async () => {
    const [c, s, cats] = await Promise.all([api!.cycles(), api!.soldiers(), api!.dutyCategories()]);
    setCycles(c);
    setSoldiers(new Map(s.map((x) => [x.id, x])));
    setCategories(cats);
    return c;
  }, [api]);

  useEffect(() => {
    loadCycles().catch((e) => setError((e as Error).message));
  }, [loadCycles]);

  const cycle = cycles?.find((c) => c.id === cycleId);
  const computed = !!cycle?.potential_computed_at;

  const loadData = useCallback(async () => {
    if (!cycleId) return;
    setData(null);
    try {
      const [cells, snapshot] = await Promise.all([api!.potentialMatrix(cycleId), api!.snapshotSoldiers(cycleId)]);
      setData({ cells, snapshot, daily: null });
      const daily = await api!.potentialDaily(cycleId);
      setData((d) => (d ? { ...d, daily } : d));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, cycleId]);

  useEffect(() => {
    if (computed) void loadData();
    else setData(null);
  }, [computed, loadData]);

  // Only categories with at least one active duty show up in the matrix.
  const shownCategories = useMemo(() => {
    const used = new Set(data?.cells.map((c) => c.category_id));
    return categories.filter((c) => used.has(c.id));
  }, [categories, data]);

  async function compute() {
    setBusy(true);
    setConfirm(false);
    setError(null);
    try {
      await api!.computePotential(cycleId);
      await loadCycles();
      void reloadCycle();
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function exportToBase() {
    if (!data || !cycle) return;
    const XLSX = await import("xlsx");
    const rank = new Map(data.snapshot.map((s) => [s.soldier_id, s.rank_name]));
    const list = data.snapshot.map((s) => {
      const info = soldiers.get(s.soldier_id);
      return { id: s.soldier_id, full_name: info?.full_name ?? "", gaf_name: info?.gaf_name ?? "", rank_name: rank.get(s.soldier_id) ?? "" };
    });
    const { summaryRows, nameRows } = exportSheets(list, shownCategories, data.cells, cycle.name);
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const s1 = XLSX.utils.aoa_to_sheet(summaryRows);
    s1["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];
    const s2 = XLSX.utils.aoa_to_sheet(nameRows);
    s2["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 10 }, ...shownCategories.map(() => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(wb, s1, "סיכום");
    XLSX.utils.book_append_sheet(wb, s2, "רשימה שמית");
    XLSX.writeFile(wb, `פוטנציאל-${cycle.start_date}.xlsx`);
  }

  if (error && !cycles) return <Alert severity="error">{error}</Alert>;
  if (!cycles) return <Loading />;

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {!cycle ? (
        <Alert severity="info">צריך קודם ליצור מחזור בניהול המחזורים.</Alert>
      ) : !computed ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720 }}>
          <Stack spacing={2}>
            <Typography variant="h2">חישוב פוטנציאל ל{cycle.name}</Typography>
            <Typography variant="body2">
              המערכת תחשב לכל עובד פעיל, לכל קטגוריית תורנות, אם הוא זכאי ולאיזה חלק מהמחזור הוא זמין. הדרגה, האוכלוסייה, משרת הורה והפטור המזכה
              ננעלים ברגע החישוב וחלים על כל המחזור.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              לפני החישוב כדאי לטעון קובץ כוח אדם עדכני ולאשר את הפטורים. אפשר לחשב שוב בהמשך.
            </Typography>
            <Box>
              <Button variant="contained" startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <CalculateIcon />} onClick={compute} disabled={busy}>
                חישוב פוטנציאל
              </Button>
            </Box>
          </Stack>
        </Paper>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 220 }}>
              חושב ב-{new Date(cycle.potential_computed_at!).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}. הדרגות והאוכלוסיות
              נעולות למחזור; היעדרויות ופטורים שנוספו מאז כבר נכללים.
              {locked && " המחזור פורסם, ולכן הפוטנציאל נעול: אין חישוב מחדש ואין תיקון תאים."}
            </Typography>
            {!locked && (
              <Button startIcon={<CalculateIcon />} onClick={() => setConfirm(true)} disabled={busy}>
                חישוב מחדש
              </Button>
            )}
            <Button data-read variant="contained" startIcon={<DownloadIcon />} onClick={exportToBase} disabled={!data}>
              ייצוא לבסיס
            </Button>
          </Stack>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab value="matrix" label="מטריצה" />
            <Tab value="heat" label="זמינות לפי שבוע" />
          </Tabs>
          {!data ? (
            <Loading />
          ) : tab === "matrix" ? (
            <MatrixTab cycle={cycle} data={data} soldiers={soldiers} categories={shownCategories} reload={loadData} locked={locked || !canEdit} />
          ) : (
            <HeatTab daily={data.daily} categories={shownCategories} />
          )}
        </>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>חישוב מחדש</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            הדרגות, האוכלוסיות ומשרתי ההורה יינעלו מחדש לפי הנתונים של היום. התיקונים הידניים במטריצה נשמרים. אם הפוטנציאל כבר נשלח לבסיס, ייתכן
            שיהיה צריך לשלוח אותו שוב.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>ביטול</Button>
          <Button variant="contained" onClick={compute}>
            חישוב מחדש
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

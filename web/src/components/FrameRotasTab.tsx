import AddIcon from "@mui/icons-material/Add";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Close from "@mui/icons-material/Close";
import SwapHoriz from "@mui/icons-material/SwapHoriz";
import Undo from "@mui/icons-material/Undo";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { dayKey } from "../lib/dates";
import { addMonths, monthLabel, monthName, monthStart, rotaGaf, WEEKDAYS, MONTH_NAMES, type FrameRota, type FrameRotaInput, type FrameRotasAdmin } from "../lib/frameRota";
import { useLiveTick } from "../lib/live";

const thisMonth = () => monthStart(dayKey(new Date()));

function fromRota(r: FrameRota): FrameRotaInput {
  const { months: _m, ...rest } = r;
  return { ...rest, gaf_order: [...r.gaf_order] };
}

/** Settings › תורנויות מסגרת: a monthly duty that passes between the frames – outside the scheduling. */
export function FrameRotasTab() {
  const live = useLiveTick();
  const { api } = useAuth();
  const [data, setData] = useState<FrameRotasAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState<FrameRotaInput | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api!.frameRotasAdmin());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load, live]);

  if (!data) return error ? <Alert severity="error">{error}</Alert> : null;
  const blank = (): FrameRotaInput => ({
    name: "", weekday: 0, at_time: "08:00", place: null, details: null, is_active: true,
    gaf_order: data.gafs.map((g) => g.id), start_month: addMonths(thisMonth(), 1),
  });

  return (
    <Stack spacing={3} sx={{ mt: 2, maxWidth: 820 }}>
      <Typography variant="body2" color="text.secondary">
        תורנות חודשית שעוברת בין המסגרות. היא לא נכנסת למנוע השיבוץ, לניקוד או לדוחות. מפקד המסגרת ונציג המסגרת רואים אותה ב"משימות" בחודש
        שלהם ובחודש שלפניו ומקבלים התראות; כל העובדים רואים מי אחראי החודש.
      </Typography>
      {msg && (
        <Alert severity="success" onClose={() => setMsg(null)}>
          {msg}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {data.rotas.map((r) => (
        <RotaEditor
          key={r.id}
          rota={r}
          gafs={data.gafs}
          onSaved={(m) => (setMsg(m), setError(null), void load())}
          onError={setError}
        />
      ))}
      {adding ? (
        <RotaForm
          value={adding}
          gafs={data.gafs}
          onChange={setAdding}
          onCancel={() => setAdding(null)}
          onSave={async () => {
            try {
              await api!.saveFrameRota(adding);
              setAdding(null);
              setMsg("התורנות נשמרה");
              setError(null);
              await load();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      ) : (
        <Box>
          <Button variant={data.rotas.length ? "outlined" : "contained"} startIcon={<AddIcon />} onClick={() => setAdding(blank())}>
            תורנות מסגרת חדשה
          </Button>
        </Box>
      )}
    </Stack>
  );
}

function RotaEditor({ rota, gafs, onSaved, onError }: { rota: FrameRota; gafs: FrameRotasAdmin["gafs"]; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const { api } = useAuth();
  const [draft, setDraft] = useState<FrameRotaInput>(() => fromRota(rota));
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changing, setChanging] = useState<string | null>(null); // month
  // a reload from elsewhere: take it unless he is in the middle of editing
  useEffect(() => {
    if (!dirty) setDraft(fromRota(rota));
  }, [rota, dirty]);
  const name = (id: string | null) => gafs.find((g) => g.id === id)?.name ?? "—";

  async function override(month: string, gaf: string | null) {
    try {
      await api!.overrideFrameRota(rota.id, month, gaf);
      setChanging(null);
      onSaved(gaf ? `${monthLabel(month)} עבר ל${name(gaf)}` : `${monthLabel(month)} חזר לסבב`);
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <Stack spacing={2}>
      <RotaForm
        value={draft}
        gafs={gafs}
        dirty={dirty}
        onChange={(v) => (setDraft(v), setDirty(true))}
        onCancel={dirty ? () => (setDraft(fromRota(rota)), setDirty(false)) : undefined}
        onDelete={() => setDeleting(true)}
        onSave={async () => {
          try {
            await api!.saveFrameRota(draft);
            setDirty(false);
            onSaved("התורנות נשמרה");
          } catch (e) {
            onError((e as Error).message);
          }
        }}
      />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          לוח 12 החודשים הבאים
        </Typography>
        {dirty && (
          <Alert severity="info" sx={{ mb: 1 }}>
            הלוח מתעדכן אחרי השמירה.
          </Alert>
        )}
        {/* a list, not a table: on a phone each month is one row – month, frame and its commander, the action */}
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
          {rota.months.map((m, k) => (
            <Stack
              key={m.month}
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center", py: 1, px: 1, borderRadius: 1, bgcolor: k === 0 ? "action.selected" : undefined }}
            >
              <Box sx={{ width: { xs: 76, sm: 130 }, flexShrink: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: k === 0 ? 700 : 400 }}>
                  {monthName(m.month)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {k === 0 ? "החודש" : m.month.slice(0, 4)}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {changing === m.month ? (
                  <TextField
                    select
                    size="small"
                    fullWidth
                    label="מסגרת לחודש"
                    value={m.gaf_id ?? ""}
                    onChange={(e) => void override(m.month, e.target.value)}
                  >
                    {gafs.map((g) => (
                      <MenuItem key={g.id} value={g.id}>
                        {g.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <>
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {m.gaf_name ?? "—"}
                      </Typography>
                      {m.overridden && <Chip size="small" color="warning" variant="outlined" label="הוחלף ידנית" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div" noWrap>
                      {m.commander ?? "אין מפקד מסגרת"}
                    </Typography>
                  </>
                )}
              </Box>
              <Stack direction="row" sx={{ flexShrink: 0 }}>
                {changing === m.month ? (
                  <Button size="small" onClick={() => setChanging(null)}>
                    ביטול
                  </Button>
                ) : (
                  <>
                    {m.overridden && (
                      <Tooltip title="החזרה לסבב">
                        <IconButton size="small" aria-label="החזרה לסבב" onClick={() => void override(m.month, null)}>
                          <Undo fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="החלפת המסגרת לחודש הזה">
                      <IconButton size="small" color="primary" aria-label="החלפה" onClick={() => setChanging(m.month)}>
                        <SwapHoriz fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Paper>
      <Dialog open={deleting} onClose={() => setDeleting(false)}>
        <DialogTitle>למחוק את "{rota.name}"?</DialogTitle>
        <DialogContent>
          <Typography>התורנות, הסבב וההחלפות הידניות יימחקו, והיא תיעלם מהמסכים של העובדים.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(false)}>ביטול</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              try {
                await api!.deleteFrameRota(rota.id);
                setDeleting(false);
                onSaved("התורנות נמחקה");
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            מחיקה
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function RotaForm({
  value: v,
  gafs,
  dirty = true,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  value: FrameRotaInput;
  gafs: FrameRotasAdmin["gafs"];
  dirty?: boolean;
  onChange: (v: FrameRotaInput) => void;
  onSave: () => Promise<void>;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<FrameRotaInput>) => onChange({ ...v, ...p });
  const name = (id: string) => gafs.find((g) => g.id === id)?.name ?? "מסגרת שנמחקה";
  const missing = gafs.filter((g) => !v.gaf_order.includes(g.id));
  const move = (i: number, d: number) => {
    const o = [...v.gaf_order];
    [o[i], o[i + d]] = [o[i + d], o[i]];
    set({ gaf_order: o });
  };
  const n = v.gaf_order.length;
  // the months each frame takes (by the order alone)
  const monthsOf = (i: number) =>
    Array.from({ length: 12 }, (_, k) => addMonths(v.start_month, k))
      .filter((m) => rotaGaf(v.gaf_order, v.start_month, m) === v.gaf_order[i])
      .map((m) => MONTH_NAMES[Number(m.slice(5, 7)) - 1])
      .join(", ");
  const starts = Array.from({ length: 25 }, (_, k) => addMonths(thisMonth(), k - 12));
  const problems = [
    !v.name.trim() && "צריך שם",
    (v.details ?? "").length > 300 && "פרטים – עד 300 תווים",
    n === 0 && "צריך לפחות מסגרת אחת בסבב",
  ].filter(Boolean) as string[];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Typography variant="h3" sx={{ flex: 1 }}>
            {v.id ? v.name || "תורנות מסגרת" : "תורנות מסגרת חדשה"}
          </Typography>
          <FormControlLabel control={<Switch checked={v.is_active} onChange={(e) => set({ is_active: e.target.checked })} />} label="פעילה" />
        </Stack>
        <TextField label="שם" value={v.name} onChange={(e) => set({ name: e.target.value })} fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField select label="יום בשבוע" value={v.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} sx={{ minWidth: 140 }}>
            {WEEKDAYS.slice(0, 5).map((d, i) => (
              <MenuItem key={d} value={i}>
                {d}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="שעה" type="time" value={v.at_time} onChange={(e) => set({ at_time: e.target.value || "08:00" })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { dir: "ltr" } }} sx={{ minWidth: 120 }} />
          <TextField label="מקום" value={v.place ?? ""} onChange={(e) => set({ place: e.target.value || null })} fullWidth slotProps={{ htmlInput: { maxLength: 80 } }} />
        </Stack>
        <TextField
          label="פרטים לביצוע"
          multiline
          minRows={3}
          fullWidth
          value={v.details ?? ""}
          onChange={(e) => set({ details: e.target.value || null })}
          helperText={`${(v.details ?? "").length}/300 · רק מפקד המסגרת ונציג המסגרת רואים אותם`}
          error={(v.details ?? "").length > 300}
        />
        <Typography variant="body2" color="text.secondary">
          חג או ערב חג ב{WEEKDAYS[v.weekday]} (לפי לוח החגים) – התורנות עוברת ליום העבודה הבא.
        </Typography>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            סבב המסגרות
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {n ? `${n} מסגרות – כל מסגרת מקבלת חודש, והסבב חוזר כל ${n} חודשים.` : "אין מסגרות בסבב."}
          </Typography>
          <Stack spacing={0.5}>
            {v.gaf_order.map((g, i) => (
              <Stack key={g} direction="row" spacing={1} sx={{ alignItems: "center", p: 0.5, pl: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Typography sx={{ width: 20, textAlign: "center" }}>{i + 1}</Typography>
                <Typography sx={{ flex: 1 }}>{name(g)}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
                  {monthsOf(i)}
                </Typography>
                <IconButton size="small" aria-label="למעלה" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUpward fontSize="small" />
                </IconButton>
                <IconButton size="small" aria-label="למטה" disabled={i === n - 1} onClick={() => move(i, 1)}>
                  <ArrowDownward fontSize="small" />
                </IconButton>
                <Tooltip title="הוצאה מהסבב">
                  <IconButton size="small" aria-label="הוצאה מהסבב" onClick={() => set({ gaf_order: v.gaf_order.filter((x) => x !== g) })}>
                    <Close fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2 }}>
            <TextField select label="המסגרת הראשונה מתחילה בחודש" value={v.start_month} onChange={(e) => set({ start_month: e.target.value })} sx={{ minWidth: 240 }}>
              {starts.map((m) => (
                <MenuItem key={m} value={m}>
                  {monthLabel(m)}
                </MenuItem>
              ))}
            </TextField>
            {missing.length > 0 && (
              <TextField select label="הוספת מסגרת לסבב" value="" onChange={(e) => set({ gaf_order: [...v.gaf_order, e.target.value] })} sx={{ minWidth: 200 }}>
                {missing.map((g) => (
                  <MenuItem key={g.id} value={g.id}>
                    {g.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        </Box>

        {dirty && problems.length > 0 && <Alert severity="warning">{problems.join(" · ")}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={!dirty || busy || problems.length > 0}
            onClick={async () => {
              setBusy(true);
              await onSave();
              setBusy(false);
            }}
          >
            שמירה
          </Button>
          {onCancel && <Button onClick={onCancel}>ביטול</Button>}
          <Box sx={{ flex: 1 }} />
          {onDelete && (
            <Button color="error" onClick={onDelete}>
              מחיקה
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

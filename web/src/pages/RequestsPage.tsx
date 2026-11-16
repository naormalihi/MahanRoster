import AddIcon from "@mui/icons-material/Add";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { STATUS_LABEL, type RequestStatus } from "../lib/cycles";
import { dayKey, dayLabel } from "../lib/dates";
import { entryOpen, openCycle, type InputOptions, type MyRequests } from "../lib/me";

const STATUS_COLOR: Record<RequestStatus, "warning" | "success" | "error" | "default"> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  expired: "default",
  cancelled: "default",
};
const fmt = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const tomorrow = () => dayKey(new Date(Date.now() + 86_400_000));

function Section(props: { title: string; hint: string; onAdd?: () => void; addLabel: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: "center", mb: 0.5 }}>
        <Typography variant="h3" sx={{ flex: 1 }}>
          {props.title}
        </Typography>
        {props.onAdd && (
          <Button size="small" startIcon={<AddIcon />} onClick={props.onAdd}>
            {props.addLabel}
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {props.hint}
      </Typography>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>{props.children}</Stack>
    </Paper>
  );
}

function Row(props: { main: ReactNode; sub?: ReactNode; chips?: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", py: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }}>{props.main}</Typography>
        {props.sub && (
          <Typography variant="body2" color="text.secondary">
            {props.sub}
          </Typography>
        )}
      </Box>
      {props.chips}
      {props.action}
    </Stack>
  );
}

type Form = { kind: "exemption" | "block" | "absence"; type: string; from: string; to: string };

/**
 * Stage 2.2: the soldier enters his own constraints – an exemption request (נע"ת decides
 * after seeing the proof), a date block (one a month) and an absence – until the cycle's
 * constraints deadline. After it, blocks and absences go through נע"ת and a request is urgent.
 */
export function RequestsPage() {
  const { api } = useAuth();
  const [opts, setOpts] = useState<InputOptions | null>(null);
  const [mine, setMine] = useState<MyRequests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, m] = await Promise.all([api!.myInputOptions(), api!.myRequests()]);
      setOpts(o);
      setMine(m);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit() {
    if (!form) return;
    setBusy(true);
    setFormError(null);
    try {
      if (form.kind === "exemption") await api!.submitExemption(form.type, form.from, form.to);
      else if (form.kind === "block") await api!.addMyDateBlock(form.from);
      else await api!.addMyAbsence(form.type, form.from, form.to);
      setForm(null);
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    }
    setBusy(false);
  }

  if (error && !opts) return <Alert severity="error">{error}</Alert>;
  if (!opts || !mine)
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );

  const collecting = openCycle(opts.cycles);
  const closedNow = opts.cycles.find((c) => !c.open && c.start_date <= dayKey(new Date(Date.now() + 120 * 86_400_000)));
  const exName = (id: string) => opts.exemption_types.find((t) => t.id === id)?.name ?? "";
  const formClosed = form && form.from && form.kind !== "exemption" && (!entryOpen(form.from, opts.cycles) || (form.to && !entryOpen(form.to, opts.cycles)));
  const formUrgent = form && form.kind === "exemption" && form.from && (!entryOpen(form.from, opts.cycles) || (form.to && !entryOpen(form.to, opts.cycles)));

  return (
    <Stack spacing={2} sx={{ maxWidth: 1040, mx: "auto", width: "100%" }}>
      <Box>
        <Typography variant="h1">הבקשות שלי</Typography>
        <Typography variant="body2" color="text.secondary">
          פטורים, חסימות תאריך והיעדרויות – מכאן ישר למערכת.
        </Typography>
      </Box>

      {collecting ? (
        <Alert severity="info">
          איסוף האילוצים ל<b>{collecting.name}</b>{" "}
          {collecting.deadline ? (
            <>
              פתוח עד <b>{dayLabel(collecting.deadline)}</b>
            </>
          ) : (
            "פתוח"
          )}
          . אחרי זה חסימות והיעדרויות רק דרך נע"ת, ובקשת פטור תסומן דחופה.
        </Alert>
      ) : closedNow ? (
        <Alert severity="warning">
          איסוף האילוצים ל{closedNow.name} נסגר. חסימות והיעדרויות לתקופה הזו – דרך נע"ת. בקשת פטור אפשר עדיין להגיש, והיא תסומן דחופה.
        </Alert>
      ) : null}
      {error && <Alert severity="error">{error}</Alert>}

      {/* on a wide screen: exemptions across, date blocks and absences side by side under them */}
      <Box sx={{ display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) minmax(0, 1fr)" }, "& > :first-of-type": { gridColumn: { md: "1 / -1" } } }}>
      <Section
        title="פטורים"
        hint='בקשה עוברת לנע"ת. את האסמכתא מציגים לו – המערכת לא שומרת מסמכים או פרטים רפואיים.'
        addLabel="בקשת פטור"
        onAdd={() => setForm({ kind: "exemption", type: opts.exemption_types[0]?.id ?? "", from: tomorrow(), to: tomorrow() })}
      >
        {mine.exemptions.length === 0 && <Typography variant="body2" color="text.secondary">אין.</Typography>}
        {mine.exemptions.map((e) => (
          <Row
            key={e.id}
            main={e.type}
            sub={
              <>
                {fmt(e.start_date)} – {fmt(e.end_date)}
                {e.decision_reason && e.status !== "approved" ? ` · ${e.decision_reason}` : ""}
                {!e.mine ? ' · הוזן ע"י נע"ת' : ""}
              </>
            }
            chips={
              <>
                {e.is_urgent && <Chip size="small" color="error" variant="outlined" label="דחוף" />}
                <Chip size="small" color={STATUS_COLOR[e.status]} label={STATUS_LABEL[e.status]} />
              </>
            }
            action={
              e.mine &&
              e.status === "pending" && (
                <Button size="small" color="inherit" onClick={() => act(() => api!.withdrawMyExemption(e.id))}>
                  ביטול
                </Button>
              )
            }
          />
        ))}
      </Section>

      <Section
        title="חסימות תאריך"
        hint={`יום אחד שבו לא תשובץ – עד ${opts.block_quota_per_month} בחודש.`}
        addLabel="חסימת יום"
        onAdd={() => setForm({ kind: "block", type: "", from: tomorrow(), to: "" })}
      >
        {mine.blocks.length === 0 && <Typography variant="body2" color="text.secondary">אין.</Typography>}
        {mine.blocks.map((b) => (
          <Row
            key={b.id}
            main={dayLabel(b.day)}
            sub={!b.mine ? 'הוזן ע"י נע"ת' : undefined}
            action={
              b.mine &&
              b.open && (
                <Button size="small" color="inherit" onClick={() => act(() => api!.cancelMyDateBlock(b.id))}>
                  ביטול
                </Button>
              )
            }
          />
        ))}
      </Section>

      <Section
        title="היעדרויות"
        hint="חופשה, קורס, נסיעה – ימים שבהם לא תהיה ביחידה."
        addLabel="היעדרות"
        onAdd={() => setForm({ kind: "absence", type: opts.absence_types[0]?.id ?? "", from: tomorrow(), to: tomorrow() })}
      >
        {mine.absences.length === 0 && <Typography variant="body2" color="text.secondary">אין.</Typography>}
        {mine.absences.map((a) => (
          <Row
            key={a.id}
            main={a.type}
            sub={
              <>
                {fmt(dayKey(a.starts_at))} – {fmt(dayKey(new Date(Date.parse(a.ends_at) - 1)))}
                {!a.mine ? ' · הוזן ע"י נע"ת' : ""}
              </>
            }
            action={
              a.mine &&
              a.open && (
                <Button size="small" color="inherit" onClick={() => act(() => api!.cancelMyAbsence(a.id))}>
                  ביטול
                </Button>
              )
            }
          />
        ))}
      </Section>
      </Box>

      {form && (
        <Dialog open onClose={() => setForm(null)} fullWidth maxWidth="xs">
          <DialogTitle>{form.kind === "exemption" ? "בקשת פטור" : form.kind === "block" ? "חסימת יום" : "היעדרות"}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {form.kind !== "block" && (
                <TextField select label="סוג" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {(form.kind === "exemption" ? opts.exemption_types : opts.absence_types).map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                type="date"
                label={form.kind === "block" ? "יום" : "מתאריך"}
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to && form.to < e.target.value ? e.target.value : form.to })}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: tomorrow() } }}
              />
              {form.kind !== "block" && (
                <TextField
                  type="date"
                  label="עד תאריך (כולל)"
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: form.from || tomorrow() } }}
                />
              )}
              {form.kind === "exemption" && (
                <Typography variant="body2" color="text.secondary">
                  הבקשה ממתינה עד שנע"ת יראה את האסמכתא ויחליט{exName(form.type) ? ` על "${exName(form.type)}"` : ""}.
                </Typography>
              )}
              {formUrgent && <Alert severity="warning">התאריכים אחרי מועד סגירת האילוצים – הבקשה תסומן דחופה.</Alert>}
              {formClosed && <Alert severity="warning">איסוף האילוצים לתאריכים האלה נסגר – פנה לנע"ת.</Alert>}
              {formError && <Alert severity="error">{formError}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setForm(null)}>ביטול</Button>
            <Button variant="contained" onClick={submit} disabled={busy || !form.from || (form.kind !== "block" && (!form.to || !form.type)) || !!formClosed}>
              {form.kind === "exemption" ? "הגשה" : "שמירה"}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

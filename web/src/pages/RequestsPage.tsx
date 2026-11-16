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
import { entryOpen, requestsByCycle, type InputCycle, type InputOptions, type MyRequests } from "../lib/me";

const STATUS_COLOR: Record<RequestStatus, "warning" | "success" | "error" | "default"> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  expired: "default",
  cancelled: "default",
};
const fmt = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const tomorrow = () => dayKey(new Date(Date.now() + 86_400_000));

/** One kind of request inside a cycle's card: its rows and the button to add one. */
function Part(props: { title: string; note?: string; onAdd?: () => void; addLabel: string; children: ReactNode[] }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", minHeight: 32 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          {props.title}
        </Typography>
        {props.onAdd && (
          <Button size="small" startIcon={<AddIcon />} onClick={props.onAdd}>
            {props.addLabel}
          </Button>
        )}
      </Stack>
      {props.note && (
        <Typography variant="caption" color="text.secondary">
          {props.note}
        </Typography>
      )}
      {props.children.length ? (
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>{props.children}</Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.5 }}>
          אין.
        </Typography>
      )}
    </Box>
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

type Form = { kind: "exemption" | "block" | "absence"; cycle: InputCycle; type: string; from: string; to: string };

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

  const today = dayKey(new Date());
  const groups = requestsByCycle(mine, opts.cycles, today);
  const exName = (id: string) => opts.exemption_types.find((t) => t.id === id)?.name ?? "";
  const formClosed = form && form.from && form.kind !== "exemption" && (!entryOpen(form.from, opts.cycles) || (form.to && !entryOpen(form.to, opts.cycles)));
  const formUrgent = form && form.kind === "exemption" && form.from && (!entryOpen(form.from, opts.cycles) || (form.to && !entryOpen(form.to, opts.cycles)));
  // a new request starts inside the cycle it was opened from
  const start = (c: InputCycle) => (c.start_date > tomorrow() ? c.start_date : tomorrow());
  const open = (kind: Form["kind"], c: InputCycle) =>
    setForm({
      kind,
      cycle: c,
      type: kind === "exemption" ? (opts.exemption_types[0]?.id ?? "") : kind === "absence" ? (opts.absence_types[0]?.id ?? "") : "",
      from: start(c),
      to: kind === "block" ? "" : start(c),
    });

  const exemptionRows = (list: MyRequests["exemptions"]) =>
    list.map((e) => (
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
    ));
  const blockRows = (list: MyRequests["blocks"]) =>
    list.map((b) => (
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
    ));
  const absenceRows = (list: MyRequests["absences"]) =>
    list.map((a) => (
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
    ));

  return (
    <Stack spacing={2} sx={{ maxWidth: 1040, mx: "auto", width: "100%" }}>
      <Box>
        <Typography variant="h1">הבקשות שלי</Typography>
        <Typography variant="body2" color="text.secondary">
          פטורים, חסימות תאריך והיעדרויות לכל מחזור – מכאן ישר למערכת. את האסמכתא לפטור מציגים לנע"ת; המערכת לא שומרת מסמכים או פרטים רפואיים.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {groups.length === 0 && <Alert severity="info">עוד אין מחזור פתוח. כשנע"ת יפתח מחזור, תוכל להגיש כאן בקשות.</Alert>}

      {groups.map((g) => {
        const c = g.cycle;
        const blocksUsed = g.blocks.filter((b) => b.mine).length;
        return (
          <Paper key={c?.id ?? "none"} variant="outlined" sx={{ overflow: "hidden", opacity: c && !c.open ? 0.92 : 1 }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: c ? (c.open ? "rgba(26,20,102,0.05)" : "action.hover") : "rgba(232,112,15,0.08)", borderBottom: 1, borderColor: "divider" }}>
              <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="h3" sx={{ flex: 1, minWidth: 180 }}>
                  {c ? c.name : "בלי מחזור"}
                </Typography>
                {c ? (
                  c.open ? (
                    <Chip size="small" color="success" label={c.deadline ? `פתוח להגשה עד ${dayLabel(c.deadline)}` : "פתוח להגשה"} />
                  ) : (
                    <Chip size="small" color="warning" variant="outlined" label='נסגר – דרך נע"ת' />
                  )
                ) : (
                  <Chip size="small" color="warning" label="ממתין למחזור" />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {c
                  ? `${fmt(c.start_date)} – ${fmt(c.end_date)}${c.open ? "" : ' · חסימות והיעדרויות לתקופה הזו – דרך נע"ת. בקשת פטור אפשר עדיין להגיש, והיא תסומן דחופה.'}`
                  : 'בקשות לתאריכים שעוד אין להם מחזור. הן שמורות, ונע"ת יראה אותן כשייפתח מחזור שמכסה אותן.'}
              </Typography>
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" }, "& > *": { p: 2 }, "& > * + *": { borderTop: { xs: 1, md: 0 }, borderInlineStart: { md: 1 }, borderColor: "divider" } }}>
              <Part title="פטורים" addLabel="בקשת פטור" onAdd={c ? () => open("exemption", c) : undefined}>
                {exemptionRows(g.exemptions)}
              </Part>
              <Part
                title="חסימות תאריך"
                note={c ? `${blocksUsed} בשימוש · עד ${opts.block_quota_per_month} בחודש` : undefined}
                addLabel="חסימת יום"
                onAdd={c && c.open ? () => open("block", c) : undefined}
              >
                {blockRows(g.blocks)}
              </Part>
              <Part title="היעדרויות" addLabel="היעדרות" onAdd={c && c.open ? () => open("absence", c) : undefined}>
                {absenceRows(g.absences)}
              </Part>
            </Box>
          </Paper>
        );
      })}

      {form && (
        <Dialog open onClose={() => setForm(null)} fullWidth maxWidth="xs">
          <DialogTitle>
            {form.kind === "exemption" ? "בקשת פטור" : form.kind === "block" ? "חסימת יום" : "היעדרות"}
            <Typography variant="body2" color="text.secondary">
              {form.cycle.name}
            </Typography>
          </DialogTitle>
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
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: start(form.cycle), max: form.cycle.end_date } }}
              />
              {form.kind !== "block" && (
                <TextField
                  type="date"
                  label="עד תאריך (כולל)"
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: form.from || start(form.cycle), max: form.kind === "absence" ? form.cycle.end_date : undefined } }}
                />
              )}
              {form.kind === "exemption" && (
                <Typography variant="body2" color="text.secondary">
                  הבקשה ממתינה עד שנע"ת יראה את האסמכתא ויחליט{exName(form.type) ? ` על "${exName(form.type)}"` : ""}.
                </Typography>
              )}
              {form.from && (form.from < form.cycle.start_date || form.from > form.cycle.end_date) && (
                <Alert severity="info">
                  התאריך מחוץ ל{form.cycle.name} ({fmt(form.cycle.start_date)} – {fmt(form.cycle.end_date)}).
                </Alert>
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

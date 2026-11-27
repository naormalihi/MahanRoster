import { DateTextField } from "../components/DateTextField";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  Autocomplete,
  AccordionDetails,
  AccordionSummary,
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
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { STATUS_LABEL, type RequestStatus } from "../lib/cycles";
import { dayKey, dayLabel } from "../lib/dates";
import { ContactCard, ContactsDialog } from "../components/ContactCard";
import { Mascot } from "../components/Mascot";
import { entryOpen, type InputOptions, type MyRequests } from "../lib/me";
import { blocksInMonth, closedNotice, cycleOf, KIND_LABEL, requestItems, type RequestItem, type RequestKind } from "../lib/requestList";
import { useLiveTick } from "../lib/live";

const STATUS_COLOR: Record<RequestStatus, "warning" | "success" | "error" | "default"> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  expired: "default",
  cancelled: "default",
};
const fmt = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const tomorrow = () => dayKey(new Date(Date.now() + 86_400_000));

type Form = { kind: RequestKind; type: string; from: string; to: string; tasks?: string[] };

const ITEM_TITLE = (r: RequestItem) => (r.kind === "block" ? "חסימת תאריך" : `${KIND_LABEL[r.kind]} · ${r.type}`);
const dates = (r: RequestItem) => (r.from === r.to ? dayLabel(r.from) : `${fmt(r.from)} – ${fmt(r.to)}`);

/** "מה קרה?" – the one question that picks the kind of request. */
const CHOICES: { kind: RequestKind; label: string; hint: string }[] = [
  { kind: "block", label: "יום שאני לא יכול", hint: "חסימת תאריך – בלי אישור" },
  { kind: "absence", label: "אני לא ביחידה כמה ימים", hint: "היעדרות – בלי אישור" },
  { kind: "exemption", label: "יש לי סיבה רפואית או אחרת לפטור", hint: 'בקשת פטור – אחראי השיבוצים מחליט אחרי שיראה אסמכתא' },
];

/**
 * "הבקשות שלי": one list of all the soldier's requests (the coming first, the passed ones folded),
 * and one "בקשה חדשה" button that asks what happened. Blocks and absences take effect at once
 * until the cycle's deadline; an exemption waits for אחראי השיבוצים. After the deadline – through אחראי השיבוצים.
 */
export function RequestsPage() {
  const live = useLiveTick();
  const { api } = useAuth();
  const [opts, setOpts] = useState<InputOptions | null>(null);
  const [mine, setMine] = useState<MyRequests | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ?new=1 ("בקשה חדשה" on the home's "המחזור הבא" card): straight to the choice
  const [choosing, setChoosing] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [contacts, setContacts] = useState(false);
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
  useEffect(() => void load(), [load, live]);

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
      if (form.kind === "exemption") {
        const needs = !!opts?.exemption_types.find((t) => t.id === form.type)?.requires_duty_list;
        if (needs && !form.tasks?.length) throw new Error("בפטור חלקי צריך לבחור לפחות משימה אחת שאינך יכול לבצע");
        await api!.submitExemption(form.type, form.from, form.to, needs ? form.tasks : undefined);
      }
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
  const { current, past } = requestItems(mine, today);
  const closed = closedNotice(opts.cycles, today);
  const exName = (id: string) => opts.exemption_types.find((t) => t.id === id)?.name ?? "";
  const formClosed = form && form.from && form.kind !== "exemption" && (!entryOpen(form.from, opts.cycles) || (form.to && !entryOpen(form.to, opts.cycles)));
  const formUrgent = form && form.kind === "exemption" && form.from && (!entryOpen(form.from, opts.cycles) || (form.to && !entryOpen(form.to, opts.cycles)));
  const formCycle = form?.from ? cycleOf(form.from, opts.cycles) : undefined;
  // no cycle for these days: an absence or a block needs one for every day, an exemption to touch one
  const noCycle =
    !!form?.from &&
    (form.kind === "exemption"
      ? !opts.cycles.some((c) => c.start_date <= (form.to || form.from) && c.end_date >= form.from)
      : !formCycle || (!!form.to && form.kind === "absence" && !cycleOf(form.to, opts.cycles)));
  const used = form?.kind === "block" && form.from ? blocksInMonth(mine, form.from.slice(0, 7)) : 0;
  const newForm = (kind: RequestKind) => {
    setChoosing(false);
    setFormError(null);
    setForm({
      kind,
      type: kind === "exemption" ? (opts.exemption_types[0]?.id ?? "") : kind === "absence" ? (opts.absence_types[0]?.id ?? "") : "",
      from: tomorrow(),
      to: kind === "block" ? "" : tomorrow(),
    });
  };
  const newButton = (
    <Button variant="contained" startIcon={<AddIcon />} onClick={() => setChoosing(true)}>
      בקשה חדשה
    </Button>
  );

  const row = (r: RequestItem) => (
    <Stack key={r.key} direction="row" spacing={1} sx={{ alignItems: "center", py: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }}>{ITEM_TITLE(r)}</Typography>
        <Typography variant="body2" color="text.secondary">
          {dates(r)}
          {r.reason ? ` · ${r.reason}` : ""}
          {r.byStaff ? ' · הוזן ע"י אחראי השיבוצים' : ""}
        </Typography>
      </Box>
      {r.urgent && <Chip size="small" color="error" variant="outlined" label="דחוף" />}
      {r.status === "active" ? (
        <Chip size="small" color="success" variant="outlined" label="בתוקף" />
      ) : (
        <Chip size="small" color={STATUS_COLOR[r.status]} label={STATUS_LABEL[r.status]} />
      )}
      {r.cancellable && (
        <Button
          size="small"
          color="inherit"
          onClick={() =>
            act(() => (r.kind === "exemption" ? api!.withdrawMyExemption(r.id) : r.kind === "block" ? api!.cancelMyDateBlock(r.id) : api!.cancelMyAbsence(r.id)))
          }
        >
          ביטול
        </Button>
      )}
    </Stack>
  );

  return (
    <Stack spacing={2} sx={{ maxWidth: 820, mx: "auto", width: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h1">בקשות ואילוצים</Typography>
          <Typography variant="body2" color="text.secondary">
            את האסמכתא לפטור מציגים לאחראי השיבוצים – המערכת לא שומרת מסמכים או פרטים רפואיים.
          </Typography>
        </Box>
        {(current.length > 0 || past.length > 0) && newButton}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {closed && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => setContacts(true)} sx={{ whiteSpace: "nowrap" }}>
              למי לפנות
            </Button>
          }
        >
          המועד ל{closed.closed.name} נסגר{closed.closed.deadline ? ` ב-${fmt(dayKey(closed.closed.deadline))}` : ""}. חסימה, היעדרות או פטור דחוף לתאריכים האלה – דרך אחראי השיבוצים.
          {closed.next ? ` ל${closed.next.name} אפשר להגיש כרגיל${closed.next.deadline ? ` עד ${fmt(dayKey(closed.next.deadline))}` : ""}.` : ""}
        </Alert>
      )}

      {current.length === 0 && past.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Mascot pose="sleep" height={120} sx={{ mx: "auto", mb: 1 }} />
          <Typography sx={{ mb: 1.5 }}>אין לך בקשות פתוחות</Typography>
          {newButton}
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ px: 2, py: 0.5 }}>
          {current.length ? (
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>{current.map(row)}</Stack>
          ) : (
            <Typography color="text.secondary" sx={{ py: 1.5 }}>
              אין לך בקשות פתוחות.
            </Typography>
          )}
          {past.length > 0 && (
            <Accordion disableGutters elevation={0} sx={{ "&:before": { display: "none" }, borderTop: 1, borderColor: "divider", bgcolor: "transparent" }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                <Typography color="text.secondary">קודמות ({past.length})</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0, pt: 0 }}>
                <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />} sx={{ opacity: 0.8 }}>
                  {past.map(row)}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
        </Paper>
      )}
      {closed && <ContactCard />}

      {choosing && (
        <Dialog open onClose={() => setChoosing(false)} fullWidth maxWidth="xs">
          <DialogTitle>מה קרה?</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1}>
              {CHOICES.map((c) => (
                <Button key={c.kind} variant="outlined" onClick={() => newForm(c.kind)} sx={{ justifyContent: "flex-start", textAlign: "start", py: 1.25, display: "block" }}>
                  <Typography sx={{ fontWeight: 700 }}>{c.label}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {c.hint}
                  </Typography>
                </Button>
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setChoosing(false)}>ביטול</Button>
          </DialogActions>
        </Dialog>
      )}
      {contacts && <ContactsDialog onClose={() => setContacts(false)} />}

      {form && (
        <Dialog open onClose={() => setForm(null)} fullWidth maxWidth="xs">
          <DialogTitle>{form.kind === "exemption" ? "בקשת פטור" : form.kind === "block" ? "חסימת תאריך" : "היעדרות"}</DialogTitle>
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
              <DateTextField
                label={form.kind === "block" ? "יום" : "מתאריך"}
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to && form.to < e.target.value ? e.target.value : form.to })}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: tomorrow() } }}
              />
              {form.kind !== "block" && (
                <DateTextField
                  label="עד תאריך (כולל)"
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: form.from || tomorrow() } }}
                />
              )}
              {form.kind === "block" && form.from && (
                <Typography variant="body2" color={used >= opts.block_quota_per_month ? "error" : "text.secondary"}>
                  {used} מתוך {opts.block_quota_per_month} חסימות בחודש הזה
                </Typography>
              )}
              {form.kind === "exemption" && opts.exemption_types.find((t) => t.id === form.type)?.requires_duty_list && (
                <Autocomplete
                  multiple
                  options={opts.eligible_tasks ?? []}
                  value={(opts.eligible_tasks ?? []).filter((t) => form.tasks?.includes(t.id))}
                  onChange={(_, v) => setForm({ ...form, tasks: v.map((t) => t.id) })}
                  getOptionLabel={(t) => t.name}
                  noOptionsText="אין משימות"
                  renderInput={(p) => <TextField {...p} required label="משימות שאינך יכול לבצע" helperText="מתוך המשימות שאתה משובץ אליהן" />}
                />
              )}
              {form.kind === "exemption" && (
                <Typography variant="body2" color="text.secondary">
                  הבקשה ממתינה עד שאחראי השיבוצים יראה את האסמכתא ויחליט{exName(form.type) ? ` על "${exName(form.type)}"` : ""}.
                </Typography>
              )}
              {noCycle && (
                <Alert severity="error">
                  עוד אין מחזור לתאריכים האלה, אז אי אפשר להגיש עליהם בקשה. אפשר להגיש כשאחראי השיבוצים יפתח מחזור
                  {opts.cycles.length ? ` – עכשיו פתוח עד ${opts.cycles.map((c) => c.end_date).sort().at(-1)!.split("-").reverse().join("/")}` : ""}.
                </Alert>
              )}
              {formUrgent && <Alert severity="warning">מועד האילוצים לתאריכים האלה נסגר – הבקשה תסומן דחופה.</Alert>}
              {formClosed && (
                <Alert
                  severity="warning"
                  action={
                    <Button color="inherit" size="small" onClick={() => setContacts(true)} sx={{ whiteSpace: "nowrap" }}>
                      למי לפנות
                    </Button>
                  }
                >
                  המועד לתאריכים האלה נסגר – דרך אחראי השיבוצים.
                </Alert>
              )}
              {formError && <Alert severity="error">{formError}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setForm(null)}>ביטול</Button>
            <Button variant="contained" onClick={submit} disabled={busy || !form.from || (form.kind !== "block" && (!form.to || !form.type)) || !!formClosed || noCycle}>
              {form.kind === "exemption" ? "הגשה" : "שמירה"}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

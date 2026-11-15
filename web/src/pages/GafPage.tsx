import AddIcon from "@mui/icons-material/Add";
import CommentIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
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
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { STATUS_LABEL, type RequestStatus } from "../lib/cycles";
import { dayKey, dayLabel, spanLabel } from "../lib/dates";
import { constraintCounts, SUBMISSION_LABEL, type GafOverview } from "../lib/gaf";
import type { InputOptions } from "../lib/me";

const fmt = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const ddmm = (d: string) => d.slice(5, 10).split("-").reverse().join("/");
const tomorrow = () => dayKey(new Date(Date.now() + 86_400_000));

type Entry = { soldier: string; kind: "block" | "absence" | "exemption"; type: string; from: string; to: string };

/**
 * The gaf's own screen (version 2.0, stage 2.3). The representative gathers the gaf's
 * constraints – sees what each soldier entered, enters for those who are away – and submits
 * them; the commander can do the same and approves. On the draft, both comment for נע"ת.
 */
export function GafPage() {
  const { api } = useAuth();
  const [opts, setOpts] = useState<InputOptions | null>(null);
  const [cycleId, setCycleId] = useState<string>("");
  const [o, setO] = useState<GafOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [comment, setComment] = useState<{ slot: string | null; label: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api!
      .myInputOptions()
      .then((x) => {
        setOpts(x);
        // the cycle still collecting, else the latest one
        const first = x.cycles.find((c) => c.open) ?? x.cycles[x.cycles.length - 1];
        setCycleId(first?.id ?? "");
      })
      .catch((e) => setError((e as Error).message));
  }, [api]);

  const load = useCallback(async () => {
    if (!cycleId) return;
    try {
      setO(await api!.gafOverview(cycleId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, cycleId]);
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

  async function saveEntry() {
    if (!entry) return;
    setBusy(true);
    setEntryError(null);
    try {
      if (entry.kind === "block") await api!.gafAddBlock(entry.soldier, entry.from);
      else if (entry.kind === "absence") await api!.gafAddAbsence(entry.soldier, entry.type, entry.from, entry.to);
      else await api!.gafRequestExemption(entry.soldier, entry.type, entry.from, entry.to);
      setEntry(null);
      await load();
    } catch (e) {
      setEntryError((e as Error).message);
    }
    setBusy(false);
  }

  if (error && !o) return <Alert severity="error">{error}</Alert>;
  if (opts && !opts.cycles.length) return <Alert severity="info">אין מחזור פתוח או מתוכנן.</Alert>;
  if (!opts || !o)
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );

  const counts = constraintCounts(o);
  const name = new Map(o.soldiers.map((s) => [s.id, s.name]));
  const published = o.cycle.status === "published" || o.cycle.status === "closed";
  const sub = o.submission;
  const typesFor = (k: Entry["kind"]) => (k === "exemption" ? opts.exemption_types : opts.absence_types);

  return (
    <Stack spacing={2} sx={{ maxWidth: 900 }}>
      <Box>
        <Typography variant="h1">הגף שלי · {o.gaf.name}</Typography>
        <Typography variant="body2" color="text.secondary">
          {o.is_commander ? "מפקד הגף" : "נציג הגף"} · {o.soldiers.length} חיילים
        </Typography>
      </Box>

      {opts.cycles.length > 1 && (
        <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
          {opts.cycles.map((c) => (
            <Chip key={c.id} label={c.name} color={c.id === cycleId ? "primary" : "default"} variant={c.id === cycleId ? "filled" : "outlined"} onClick={() => setCycleId(c.id)} />
          ))}
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}

      {/* collection and approval */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3">אילוצי הגף · {o.cycle.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {o.cycle.open
            ? `האיסוף פתוח${o.cycle.deadline ? ` עד ${dayLabel(o.cycle.deadline)}` : ""}. החיילים מזינים בעצמם; לחיילים שנעדרים – מזינים מכאן.`
            : 'האיסוף נסגר – שינויים דרך נע"ת. בקשת פטור אפשר עדיין להגיש (תסומן דחופה).'}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5, alignItems: { sm: "center" } }}>
          <Chip
            label={sub ? SUBMISSION_LABEL[sub.status] : "לא הוגש"}
            color={sub?.status === "approved" ? "success" : sub?.status === "late" ? "warning" : sub?.status === "submitted" ? "info" : "default"}
          />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {sub?.approved_at
              ? `אושר ${fmt(sub.approved_at)}${sub.approved_by ? ` ע"י ${sub.approved_by}` : ""}`
              : sub?.submitted_at
                ? `הוגש ${fmt(sub.submitted_at)}${sub.submitted_by ? ` ע"י ${sub.submitted_by}` : ""}`
                : ""}
          </Typography>
          {!published && (!sub || sub.status === "open") && (
            <Button variant="outlined" onClick={() => act(() => api!.gafSubmit(o.cycle.id))}>
              הגשה למפקד הגף
            </Button>
          )}
          {!published && o.is_commander && sub?.status !== "approved" && sub?.status !== "late" && (
            <Button variant="contained" onClick={() => act(() => api!.gafApprove(o.cycle.id))}>
              אישור אילוצי הגף
            </Button>
          )}
        </Stack>
      </Paper>

      {/* soldiers and their constraints */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="h3" sx={{ px: 0.5, mb: 1 }}>
          חיילי הגף
        </Typography>
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
          {o.soldiers.map((s) => (
            <Box key={s.id} sx={{ py: 1, px: 0.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {s.name}
                    <Typography component="span" variant="body2" color="text.secondary">
                      {" "}· {s.rank ?? ""}
                      {!s.has_account ? " · בלי חשבון" : ""}
                    </Typography>
                  </Typography>
                </Box>
                {(o.cycle.open || !published) && (
                  <IconButton
                    size="small"
                    aria-label={`אילוץ ל${s.name}`}
                    onClick={() => setEntry({ soldier: s.id, kind: o.cycle.open ? "block" : "exemption", type: "", from: tomorrow(), to: tomorrow() })}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
              {counts.get(s.id) ? (
                <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                  {o.exemptions
                    .filter((e) => e.soldier_id === s.id)
                    .map((e) => (
                      <Chip
                        key={e.id}
                        size="small"
                        color={e.status === "approved" ? "info" : "warning"}
                        variant={e.status === "approved" ? "filled" : "outlined"}
                        label={`${e.type} ${ddmm(e.start_date)}–${ddmm(e.end_date)} · ${STATUS_LABEL[e.status as RequestStatus] ?? e.status}`}
                      />
                    ))}
                  {o.blocks
                    .filter((b) => b.soldier_id === s.id)
                    .map((b) => (
                      <Chip
                        key={b.id}
                        size="small"
                        variant="outlined"
                        label={`חסימה ${ddmm(b.day)}`}
                        onDelete={o.cycle.open ? () => act(() => api!.gafCancelEntry("block", b.id)) : undefined}
                      />
                    ))}
                  {o.absences
                    .filter((a) => a.soldier_id === s.id)
                    .map((a) => (
                      <Chip
                        key={a.id}
                        size="small"
                        variant="outlined"
                        label={`${a.type} ${ddmm(dayKey(a.starts_at))}–${ddmm(dayKey(new Date(Date.parse(a.ends_at) - 1)))}`}
                        onDelete={o.cycle.open ? () => act(() => api!.gafCancelEntry("absence", a.id)) : undefined}
                      />
                    ))}
                </Stack>
              ) : null}
            </Box>
          ))}
        </Stack>
      </Paper>

      {/* the draft and comments */}
      {o.duties.length > 0 && (
        <Accordion variant="outlined" disableGutters defaultExpanded={!published}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">
              {published ? "התורנויות של הגף בלוח" : "התורנויות של הגף בטיוטה"} ({o.duties.filter((d) => d.role === "performer").length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {!published && (
              <Box sx={{ mb: 1 }}>
                <Button size="small" startIcon={<CommentIcon />} onClick={() => setComment({ slot: null, label: "הערה כללית על הטיוטה", text: "" })}>
                  הערה כללית לנע"ת
                </Button>
              </Box>
            )}
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
              {o.duties.map((d) => (
                <Stack key={d.assignment_id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.75 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {name.get(d.soldier_id)} · {d.task}
                      {d.role === "reserve" ? " (עתודה)" : ""}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {dayLabel(d.starts_at)} · {spanLabel(d.starts_at, d.ends_at)}
                    </Typography>
                  </Box>
                  {!published && (
                    <IconButton
                      size="small"
                      aria-label="הערה על התורנות"
                      onClick={() => setComment({ slot: d.slot_id, label: `${name.get(d.soldier_id)} · ${d.task} · ${dayLabel(d.starts_at)}`, text: "" })}
                    >
                      <CommentIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
      {o.comments.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            ההערות של הגף על הטיוטה
          </Typography>
          <Stack spacing={1}>
            {o.comments.map((c) => (
              <Stack key={c.id} direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <Chip size="small" label={c.status === "handled" ? "טופל" : "פתוח"} color={c.status === "handled" ? "success" : "default"} />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {c.text}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {" "}· {c.author} · {fmt(c.created_at)}
                  </Typography>
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {entry && (
        <Dialog open onClose={() => setEntry(null)} fullWidth maxWidth="xs">
          <DialogTitle>אילוץ ל{name.get(entry.soldier)}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <TextField
                select
                label="מה"
                value={entry.kind}
                onChange={(e) => {
                  const kind = e.target.value as Entry["kind"];
                  setEntry({ ...entry, kind, type: typesFor(kind)[0]?.id ?? "" });
                }}
              >
                {o.cycle.open && <MenuItem value="block">חסימת יום</MenuItem>}
                {o.cycle.open && <MenuItem value="absence">היעדרות</MenuItem>}
                <MenuItem value="exemption">בקשת פטור</MenuItem>
              </TextField>
              {entry.kind !== "block" && (
                <TextField select label="סוג" value={entry.type || typesFor(entry.kind)[0]?.id || ""} onChange={(e) => setEntry({ ...entry, type: e.target.value })}>
                  {typesFor(entry.kind).map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                type="date"
                label={entry.kind === "block" ? "יום" : "מתאריך"}
                value={entry.from}
                onChange={(e) => setEntry({ ...entry, from: e.target.value, to: entry.to < e.target.value ? e.target.value : entry.to })}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: tomorrow() } }}
              />
              {entry.kind !== "block" && (
                <TextField
                  type="date"
                  label="עד תאריך (כולל)"
                  value={entry.to}
                  onChange={(e) => setEntry({ ...entry, to: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: entry.from } }}
                />
              )}
              {entry.kind === "exemption" && (
                <Typography variant="body2" color="text.secondary">
                  הבקשה ממתינה לנע"ת, שיראה את האסמכתא של החייל ויחליט.
                </Typography>
              )}
              {entryError && <Alert severity="error">{entryError}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEntry(null)}>ביטול</Button>
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => {
                if (entry.kind !== "block" && !entry.type) entry.type = typesFor(entry.kind)[0]?.id ?? "";
                void saveEntry();
              }}
            >
              שמירה
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {comment && (
        <Dialog open onClose={() => setComment(null)} fullWidth maxWidth="sm">
          <DialogTitle>הערה לנע"ת</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {comment.label}
              </Typography>
              <TextField label="ההערה" value={comment.text} onChange={(e) => setComment({ ...comment, text: e.target.value })} multiline minRows={3} autoFocus />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setComment(null)}>ביטול</Button>
            <Button
              variant="contained"
              disabled={comment.text.trim().length < 2}
              onClick={() =>
                act(async () => {
                  await api!.gafComment(o.cycle.id, comment.slot, comment.text);
                  setComment(null);
                })
              }
            >
              שליחה
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

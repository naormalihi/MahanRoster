import BoltIcon from "@mui/icons-material/BoltOutlined";
import UndoIcon from "@mui/icons-material/Undo";
import PersonRemoveIcon from "@mui/icons-material/PersonRemoveOutlined";
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
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { SlotPeople, SlotPerson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dayLabel, timeLabel } from "../lib/dates";

/** Day units of a duty (24 h each from its start; a remainder is one more). */
export const dayUnits = (startIso: string, endIso: string) =>
  Math.max(1, Math.ceil((Date.parse(endIso) - Date.parse(startIso)) / 86_400_000 - 1e-9));

/** Tells the cycle screens that the published board changed (their step marks reload). */
export const announceBoardChange = () => window.dispatchEvent(new Event("mahanroster:board-changed"));

export function ActivateDialog(props: {
  slot: { starts_at: string; ends_at: string };
  taskName: string;
  reserve: { id: string; name: string };
  performers: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useAuth();
  const units = dayUnits(props.slot.starts_at, props.slot.ends_at);
  const started = Date.parse(props.slot.starts_at) <= Date.now();
  // a duty under way: the reserve comes in from the current day
  const current = started ? Math.min(units - 1, Math.floor((Date.now() - Date.parse(props.slot.starts_at)) / 86_400_000)) : 0;
  const [from, setFrom] = useState(current);
  const [performer, setPerformer] = useState(props.performers[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dayOf = (i: number) => {
    const d = new Date(Date.parse(props.slot.starts_at) + i * 86_400_000).toISOString();
    return `${dayLabel(d)} ${timeLabel(d)}`;
  };
  const replaced = props.performers.find((p) => p.id === performer)?.name ?? "המבצע";
  async function save() {
    setBusy(true);
    try {
      await api!.activateReserve(props.reserve.id, from, performer || null, note.trim() || null);
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>הפעלת עתודה – {props.taskName}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography>
            <b>{props.reserve.name}</b> נכנס/ת במקום <b>{replaced}</b>.
          </Typography>
          {props.performers.length > 1 && (
            <TextField select label="המבצע שמוחלף" value={performer} onChange={(e) => setPerformer(e.target.value)} fullWidth>
              {props.performers.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {units > 1 && (
            <TextField select label="מאיזו יממה" value={from} onChange={(e) => setFrom(Number(e.target.value))} fullWidth helperText="כל אחד מקבל ניקוד על היממות שביצע">
              {Array.from({ length: units }, (_, i) => (
                <MenuItem key={i} value={i}>
                  {i === 0 ? "מתחילת התורנות – המבצע לא ביצע כלל" : `היממה ה-${i + 1} (${dayOf(i)})`}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField label="הערה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
          <Alert severity="info" icon={false}>
            {from === 0 ? `${replaced} יסומן/תסומן "הוחלף" ולא יקבל/תקבל ניקוד. ` : ""}
            אחרי ההפעלה חסרה עתודה לתורנות; היא תופיע בתפעול ברשימת הממתינות לשיבוץ.
          </Alert>
        </Stack>
      </DialogContent>
      {error && (
        <Alert severity="error" sx={{ mx: 2, mt: 1.5 }}>
          {error}
        </Alert>
      )}
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" color="warning" onClick={save} disabled={busy || !performer}>
          הפעלה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * The actions on one published duty (staff): who performs and who is the reserve, activating a
 * reserve, and undoing an activation while the duty has not started. Opened from the published
 * board and from the operations screen.
 */
export function SlotActionsDialog({ slotId, onClose, onChanged }: { slotId: string; onClose: () => void; onChanged: () => void }) {
  const { api } = useAuth();
  const phone = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [data, setData] = useState<SlotPeople | null | undefined>(undefined);
  const [activating, setActivating] = useState<SlotPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [editSpecial, setEditSpecial] = useState<{ name: string; points: string } | null>(null);
  const [deleting, setDeleting] = useState<{ reason: string } | null>(null);
  // taking one person off a published duty that has not started, to put someone else on it
  const [removing, setRemoving] = useState<{ p: SlotPerson; reason: string } | null>(null);

  useEffect(() => {
    api!.slotPeople(slotId).then(setData, (e) => setError((e as Error).message));
  }, [api, slotId, version]);

  const changed = () => {
    setActivating(null);
    setVersion((v) => v + 1);
    announceBoardChange();
    onChanged();
  };

  async function undo(p: SlotPerson) {
    setBusy(true);
    setError(null);
    try {
      await api!.undoReserveActivation(p.id);
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const people = data?.people ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const performing = people.filter((p) => (p.role === "performer" && p.status !== "dropped") || p.status === "reserve_activated");
  const idle = people.filter((p) => p.role === "reserve" && p.status === "reserve_idle");
  const replaced = people.filter((p) => people.some((x) => x.replaced_id === p.id));
  const openPerformers = people.filter((p) => p.role === "performer" && p.status === "assigned");
  const started = data ? Date.parse(data.slot.starts_at) <= Date.now() : false;
  const ended = data ? Date.parse(data.slot.ends_at) <= Date.now() : false;
  const when = data ? `${dayLabel(data.slot.starts_at)} ${timeLabel(data.slot.starts_at)} – ${dayLabel(data.slot.ends_at)} ${timeLabel(data.slot.ends_at)}` : "";

  return (
    <>
      <Dialog
        open={!activating}
        onClose={onClose}
        fullWidth
        maxWidth="xs"
        fullScreen={false}
        sx={phone ? { "& .MuiDialog-container": { alignItems: "flex-end" }, "& .MuiDialog-paper": { m: 0, width: "100%", borderRadius: "16px 16px 0 0" } } : undefined}
      >
        <DialogTitle sx={{ pb: 0.5 }}>{data?.slot.task_name ?? "תורנות"}</DialogTitle>
        <DialogContent>
          {data === undefined && !error && <CircularProgress size={22} />}
          {data === null && <Alert severity="warning">התורנות לא נמצאה.</Alert>}
          {data && (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {when}
              </Typography>
              {data.slot.fixed_points != null && (
                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Chip size="small" color="warning" variant="outlined" icon={<BoltIcon />} label={`הקפצה מיוחדת · ${data.slot.fixed_points} נק׳`} />
                    {!started && !editSpecial && (
                      <Button size="small" onClick={() => setEditSpecial({ name: data.slot.special_name ?? data.slot.task_name, points: String(data.slot.fixed_points) })}>
                        עריכת שם וניקוד
                      </Button>
                    )}
                  </Stack>
                  {editSpecial && (
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      <TextField size="small" label="שם המשימה" value={editSpecial.name} onChange={(e) => setEditSpecial({ ...editSpecial, name: e.target.value })} />
                      <TextField
                        size="small"
                        type="number"
                        label="ניקוד למבצע"
                        value={editSpecial.points}
                        onChange={(e) => setEditSpecial({ ...editSpecial, points: e.target.value })}
                        slotProps={{ htmlInput: { min: 0.5, max: 100, step: 0.5 } }}
                        helperText="מי שכבר שובץ מקבל את הניקוד החדש"
                      />
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError(null);
                            try {
                              await api!.updateSpecialSlot(data.slot.id, editSpecial.name, Number(editSpecial.points));
                              setEditSpecial(null);
                              changed();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          שמירה
                        </Button>
                        <Button size="small" onClick={() => setEditSpecial(null)}>
                          ביטול
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                </Box>
              )}
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  מבצעים
                </Typography>
                {performing.length === 0 && <Typography color="error">לא מאויש</Typography>}
                {performing.map((p) => (
                  <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.25, flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                    {p.status === "reserve_activated" && (
                      <Chip size="small" color="warning" variant="outlined" label={`עתודה שהופעלה${p.replaced_id ? ` · במקום ${byId.get(p.replaced_id)?.name ?? ""}` : ""}`} />
                    )}
                    <Box sx={{ flex: 1 }} />
                    {p.status === "reserve_activated" && !started && (
                      <Button size="small" startIcon={<UndoIcon />} onClick={() => undo(p)} disabled={busy}>
                        ביטול הפעלה
                      </Button>
                    )}
                    {data.slot.published && !started && p.status === "assigned" && (
                      <Button size="small" color="error" startIcon={<PersonRemoveIcon />} onClick={() => setRemoving({ p, reason: "" })} disabled={busy}>
                        הסרה
                      </Button>
                    )}
                  </Stack>
                ))}
                {replaced.map((p) => (
                  <Typography key={p.id} variant="body2" color="text.secondary" sx={{ textDecoration: "line-through" }}>
                    {p.name}
                  </Typography>
                ))}
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  עתודה
                </Typography>
                {idle.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    אין עתודה{!ended ? " – אפשר לשבץ בתפעול" : ""}
                  </Typography>
                )}
                {idle.map((p) => (
                  <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: "center", py: 0.25 }}>
                    <Typography>{p.name}</Typography>
                    <Box sx={{ flex: 1 }} />
                    {data.slot.published && !ended && openPerformers.length > 0 && (
                      <Button size="small" variant="contained" color="warning" startIcon={<BoltIcon />} onClick={() => setActivating(p)}>
                        הפעלת עתודה
                      </Button>
                    )}
                    {data.slot.published && !started && (
                      <Button size="small" color="error" startIcon={<PersonRemoveIcon />} onClick={() => setRemoving({ p, reason: "" })} disabled={busy}>
                        הסרה
                      </Button>
                    )}
                  </Stack>
                ))}
              </Box>
              {started && people.some((p) => p.status === "reserve_activated") && (
                <Typography variant="caption" color="text.secondary">
                  התורנות כבר התחילה, ולכן אי אפשר לבטל את הפעלת העתודה.
                </Typography>
              )}
            </Stack>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between" }}>
          {data && !started ? (
            <Button color="error" disabled={busy} onClick={() => setDeleting({ reason: "" })}>
              מחיקת התורנות
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>סגירה</Button>
        </DialogActions>
      </Dialog>
      {removing && data && (
        <Dialog open onClose={() => setRemoving(null)} maxWidth="xs" fullWidth>
          <DialogTitle>הסרה מהתורנות</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1.5}>
              <Typography>
                להסיר את <b>{removing.p.name}</b> ({removing.p.role === "performer" ? "מבצע" : "עתודה"}) מ{data.slot.task_name}, {when}?
              </Typography>
              <Typography variant="body2" color="text.secondary">
                הוא יקבל התראה, והניקוד על התורנות יירד ממנו. התורנות תופיע ב&quot;ממתינות לשיבוץ&quot;, ושם משבצים מחליף – רק חייל שאין לו תורנות באותן שעות.
              </Typography>
              <TextField label="סיבה" value={removing.reason} onChange={(e) => setRemoving({ ...removing, reason: e.target.value })} required fullWidth autoFocus />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRemoving(null)}>ביטול</Button>
            <Button
              color="error"
              variant="contained"
              disabled={busy || !removing.reason.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api!.unassignPublished(removing.p.id, removing.reason.trim());
                  setRemoving(null);
                  changed();
                } catch (e) {
                  setRemoving(null);
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              הסרה
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {deleting && data && (
        <Dialog open onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
          <DialogTitle>מחיקת התורנות</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1.5}>
              <Typography>
                למחוק את <b>{data.slot.task_name}</b>, {when}?
              </Typography>
              {people.length > 0 ? (
                <>
                  <Typography variant="body2" color="text.secondary">
                    {`יוסרו ממנה ${performing.length} מבצעים ו-${idle.length} עתודות, והניקוד שלהם על התורנות יירד. המחיקה נרשמת ביומן השינויים.`}
                  </Typography>
                  <TextField
                    label="סיבה"
                    value={deleting.reason}
                    onChange={(e) => setDeleting({ reason: e.target.value })}
                    placeholder="המשימה בוטלה"
                    required
                    fullWidth
                  />
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  אין עליה אף אחד.
                </Typography>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleting(null)}>ביטול</Button>
            <Button
              color="error"
              variant="contained"
              disabled={busy || (people.length > 0 && !deleting.reason.trim())}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api!.deleteSlot(data.slot.id, deleting.reason.trim() || undefined);
                  setDeleting(null);
                  announceBoardChange();
                  onChanged();
                  onClose();
                } catch (e) {
                  setDeleting(null);
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              מחיקה
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {activating && data && (
        <ActivateDialog
          slot={data.slot}
          taskName={data.slot.task_name}
          reserve={{ id: activating.id, name: activating.name }}
          performers={openPerformers.map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => setActivating(null)}
          onDone={changed}
        />
      )}
    </>
  );
}

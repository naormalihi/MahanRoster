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
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { RangeCard } from "../components/RangeCard";
import { useAuth } from "../lib/auth";
import { dmy, FIX_FIELDS, tashText, type MyProfile } from "../lib/profile";

type Fix = { field: string; current: string | null };

const SERVICE = { mandatory: "חובה", career: "קבע" } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Typography variant="h3" sx={{ fontSize: 16, fontWeight: 700, mb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/** one fact, with "לא נכון?" beside it */
function Row(props: { label: string; value: ReactNode; sub?: ReactNode; fix?: Fix; onFix: (f: Fix) => void; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ py: 1.25, gap: 1.5, alignItems: "center", borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {props.label}
        </Typography>
        <Typography sx={{ fontWeight: 500 }}>{props.value}</Typography>
        {props.sub && (
          <Typography variant="body2" color="text.secondary">
            {props.sub}
          </Typography>
        )}
      </Box>
      {props.action ??
        (props.fix && (
          <Button size="small" sx={{ minWidth: 0, textDecoration: "underline", whiteSpace: "nowrap" }} onClick={() => props.onFix(props.fix!)}>
            לא נכון?
          </Button>
        ))}
    </Stack>
  );
}

function FixDialog(props: { fix: Fix; onClose: () => void; onSent: () => void }) {
  const { api } = useAuth();
  const [field, setField] = useState(props.fix.field);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    if (!text.trim()) return setError("כתוב מה הנכון");
    setBusy(true);
    try {
      await api!.requestProfileFix(field, field === props.fix.field ? props.fix.current : null, text);
      props.onSent();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogTitle>משהו לא נכון?</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField select label="מה לא נכון" value={field} onChange={(e) => setField(e.target.value)} fullWidth>
            {[...new Set([props.fix.field, ...FIX_FIELDS])].map((f) => (
              <MenuItem key={f} value={f}>
                {f}
              </MenuItem>
            ))}
          </TextField>
          {field === props.fix.field && props.fix.current && (
            <Typography variant="body2" sx={{ bgcolor: "action.hover", p: 1.25, borderRadius: 2 }}>
              <span style={{ opacity: 0.7 }}>רשום היום: </span>
              <b>{props.fix.current}</b>
            </Typography>
          )}
          <TextField
            label="מה הנכון?"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 200))}
            multiline
            minRows={3}
            fullWidth
            autoFocus
            helperText={`עד 200 תווים · בלי מידע רפואי · ${text.length}/200`}
          />
          <Typography variant="body2" color="text.secondary">
            אחראי השיבוצים יקבל התראה ויבדוק. השינוי לא נכנס לבד – תקבל הודעה כשיטופל.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>ביטול</Button>
        <Button variant="contained" onClick={send} disabled={busy}>
          שליחה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function MyProfilePage() {
  const { api } = useAuth();
  const [p, setP] = useState<MyProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [sent, setSent] = useState(false);
  const load = useCallback(() => {
    api!
      .myProfile()
      .then(setP)
      .catch((e) => setError((e as Error).message));
  }, [api]);
  useEffect(load, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (p === undefined) return <CircularProgress />;
  if (p === null) return <Alert severity="info">החשבון לא משויך לעובד.</Alert>;

  const t = tashText(p.tash_level, p.home_nightly);
  const s = p.score;
  const open = p.fixes.filter((f) => f.status === "open");
  const done = p.fixes.filter((f) => f.status !== "open");
  const onFix = (f: Fix) => (setSent(false), setFix(f));
  const can = (p.tasks ?? []).filter((x) => x.ok);
  const cannot = (p.tasks ?? []).filter((x) => !x.ok);

  return (
    <Stack spacing={2} sx={{ maxWidth: 720, mx: "auto", width: "100%" }}>
      <Box>
        <Typography variant="h1">הפרטים שלי</Typography>
        <Typography variant="body2" color="text.secondary">
          כך המערכת רואה אותך – ועל זה מבוסס השיבוץ שלך. פרט לא נכון? לחץ "לא נכון?" לידו, ואחראי השיבוצים יבדוק.
        </Typography>
      </Box>
      {sent && (
        <Alert severity="success" onClose={() => setSent(false)}>
          הבקשה נשלחה לאחראי השיבוצים.
        </Alert>
      )}
      {(open.length > 0 || done.length > 0) && (
        <Section title="בקשות התיקון שלך">
          {[...open, ...done].map((f) => (
            <Row
              key={f.id}
              label={f.field}
              value={f.requested}
              sub={f.reply ? `תשובה: ${f.reply}` : undefined}
              onFix={onFix}
              action={
                <Chip
                  size="small"
                  color={f.status === "open" ? "warning" : f.status === "fixed" ? "success" : "default"}
                  label={f.status === "open" ? "ממתינה" : f.status === "fixed" ? "תוקן" : "נבדק – לא שונה"}
                />
              }
            />
          ))}
        </Section>
      )}

      <Section title="פרטים מקובץ כוח האדם">
        <Row label="שם" value={p.full_name} fix={{ field: "שם", current: p.full_name }} onFix={onFix} />
        <Row label="מסגרת" value={p.gaf ?? "—"} fix={{ field: "מסגרת", current: p.gaf }} onFix={onFix} />
        <Row label="דרגה" value={`${p.rank ?? "—"}${p.appointed ? " (מינוי)" : ""}`} fix={{ field: "דרגה", current: p.rank }} onFix={onFix} />
        <Row
          label="טלפון"
          value={<span dir="ltr">{p.phone ? p.phone.replace(/^972/, "0") : "—"}</span>}
          fix={{ field: "טלפון", current: p.phone }}
          onFix={onFix}
        />
        <Row
          label="סוג שירות"
          value={`${SERVICE[p.service]}${p.career_start_date ? ` · כניסה לקבע ${dmy(p.career_start_date)}` : ""}`}
          fix={{ field: "סוג שירות · כניסה לקבע", current: `${SERVICE[p.service]}${p.career_start_date ? ` · ${dmy(p.career_start_date)}` : ""}` }}
          onFix={onFix}
        />
        <Row
          label="גיוס · תום שירות"
          value={`גיוס ${dmy(p.enlistment_date)} · תום ${dmy(p.release_date)}`}
          fix={{ field: "גיוס · תום שירות", current: `${dmy(p.enlistment_date)} · ${dmy(p.release_date)}` }}
          onFix={onFix}
        />
        <Row
          label="תאריך קליטה ביחידה"
          value={dmy(p.unit_join_date)}
          sub={p.grace_until ? `בהכשרה עד ${dmy(p.grace_until)} – בלי שיבוץ אוטומטי` : undefined}
          fix={{ field: "תאריך קליטה", current: dmy(p.unit_join_date) }}
          onFix={onFix}
        />
      </Section>

      <Section title="מה משפיע על השיבוץ שלך">
        <Row label="ת״ש" value={t.value} sub={t.means} fix={{ field: "ת״ש", current: t.value }} onFix={onFix} />
        <Row
          label="הורה"
          value={p.parent ? "כן" : "לא"}
          sub={p.parent ? "פתוחה לך גם המשימה המזכה, בעדיפות" : undefined}
          fix={{ field: "הורה", current: p.parent ? "כן" : "לא" }}
          onFix={onFix}
        />
        <Row
          label="הקלה בעומס"
          value={p.relief ? `${p.relief.name} ×${p.relief.factor}` : "אין"}
          sub={p.relief ? `מקבל בערך ${Math.round(p.relief.factor * 100)}% מהעומס${p.relief.until ? ` · עד ${dmy(p.relief.until)}` : ""}` : undefined}
          fix={{ field: "הקלה בעומס", current: p.relief ? p.relief.name : "אין" }}
          onFix={onFix}
        />
        {p.shachar && <Row label="שח״ר" value="כן" sub="משובץ רק למשימות שמתאימות לשח״ר" onFix={onFix} />}
        {p.second_role_signed_at && (
          <Row label="תפקיד שני" value={`נחתם ${dmy(p.second_role_signed_at)}`} fix={{ field: "תפקיד שני", current: dmy(p.second_role_signed_at) }} onFix={onFix} />
        )}
        <Row
          label="פטורים והיעדרויות"
          value={p.away.length ? p.away.map((a) => `${a.name ?? (a.kind === "absence" ? "היעדרות" : "פטור")}${a.status === "pending" ? " (ממתין)" : ""}`).join(" · ") : "אין"}
          sub={p.away.length ? p.away.map((a) => `${dmy(a.from)} – ${dmy(a.to)}`).join(" · ") : undefined}
          onFix={onFix}
          action={
            <Link component={RouterLink} to="/requests" variant="body2" sx={{ whiteSpace: "nowrap" }}>
              לבקשות שלי
            </Link>
          }
        />
      </Section>

      <RangeCard />

      {p.cycle && (
        <Section title={`המשימות שלך – ${p.cycle.name}`}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            יכול לבצע
          </Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, my: 1 }}>
            {can.length ? can.map((x) => <Chip key={x.name} size="small" color="success" variant="outlined" label={x.name} />) : <Typography>—</Typography>}
          </Stack>
          {cannot.length > 0 && (
            <>
              <Typography variant="body2" color="text.secondary">
                לא משובץ אליהן – ולמה
              </Typography>
              {cannot.map((x) => (
                <Stack key={x.name} direction="row" sx={{ justifyContent: "space-between", py: 0.5 }}>
                  <Typography variant="body2">{x.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {x.reason}
                  </Typography>
                </Stack>
              ))}
            </>
          )}
          <Button size="small" sx={{ mt: 1, textDecoration: "underline" }} onClick={() => onFix({ field: "המשימות שלי", current: null })}>
            משהו כאן לא נכון?
          </Button>
        </Section>
      )}

      {s && p.cycle && (
        <Section title="הניקוד שלך">
          <Stack direction="row" sx={{ bgcolor: "action.hover", borderRadius: 2, p: 1.5, my: 1, justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                {p.cycle.published ? "הניקוד שלך" : "הניקוד שלך לפני המחזור"}
              </Typography>
              <Typography sx={{ fontSize: 28, fontWeight: 700, color: "primary.main" }}>
                {(Number(s.earlier) + Number(s.cycle_points ?? 0)).toFixed(1)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: "left" }}>
              <Typography variant="body2" color="text.secondary">
                ממוצע הקבוצה
              </Typography>
              <Typography sx={{ fontSize: 20, fontWeight: 700 }}>{s.group_avg != null ? Number(s.group_avg).toFixed(1) : "—"}</Typography>
              <Typography variant="body2" color="text.secondary">
                {s.group} ({s.group_size})
              </Typography>
            </Box>
          </Stack>
          {s.switch && (
            <Row
              label={`ניקוד מעבר ל${s.switch.to === "career" ? "קבע" : "חובה"}`}
              value={Number(s.switch.score).toFixed(1)}
              sub={`עברת ל${s.switch.to === "career" ? "קבע" : "חובה"} – הניקוד מהשירות הקודם לא נספר, ומתחילים מהממוצע`}
              onFix={onFix}
            />
          )}
          {s.opening != null && <Row label="ניקוד פתיחה" value={Number(s.opening).toFixed(1)} sub="ממוצע הקבוצה, כשנקלטת ביחידה" onFix={onFix} />}
          {s.corrections.map((c, i) => (
            <Row
              key={i}
              label="תיקון ידני"
              value={<bdi dir="ltr">{`${c.points > 0 ? "+" : ""}${Number(c.points).toFixed(1)}`}</bdi>}
              sub={`סיבה: ${c.note ?? "—"}${c.by ? ` · ${c.by}` : ""}, ${dmy(c.at)}`}
              onFix={onFix}
            />
          ))}
          {p.cycle.published && (
            <Row label="משימות במחזור" value={<bdi dir="ltr">{`+${Number(s.cycle_points ?? 0).toFixed(1)}`}</bdi>} sub={`${s.cycle_duties ?? 0} משימות על הלוח`} onFix={onFix} />
          )}
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", pt: 1 }}>
            <Link component={RouterLink} to="/scoring" variant="body2">
              איך מחושב הניקוד?
            </Link>
            <Button size="small" sx={{ textDecoration: "underline" }} onClick={() => onFix({ field: "הניקוד", current: (Number(s.earlier) + Number(s.cycle_points ?? 0)).toFixed(1) })}>
              לא נכון?
            </Button>
          </Stack>
        </Section>
      )}

      <Typography variant="body2" color="text.secondary">
        מספר העובד שלך לא שמור במערכת בגלוי, והמערכת לא שומרת מידע רפואי. הערות פנימיות של הסגל לא מוצגות כאן.
      </Typography>

      {fix && (
        <FixDialog
          fix={fix}
          onClose={() => setFix(null)}
          onSent={() => {
            setFix(null);
            setSent(true);
            load();
          }}
        />
      )}
    </Stack>
  );
}

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, CircularProgress, Link, Paper, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ContactCard } from "../components/ContactCard";
import { RangeCard } from "../components/RangeCard";
import { useAuth } from "../lib/auth";
import { dmy, tashText, type MyProfile } from "../lib/profile";

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
function Row(props: { label: string; value: ReactNode; sub?: ReactNode; action?: ReactNode }) {
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
      {props.action}
    </Stack>
  );
}

/** why the employee isn't assigned to some duties – a friendly line per reason */
const WHY: Record<string, string> = {
  "רק לקבע": "מיועדות לעובדי קבע",
  "רק לחובה": "מיועדות לעובדי חובה",
  "דרגה": "לא בטווח הדרגות שלך",
  "לא באוכלוסייה של המשימה": "מיועדות לקבוצה אחרת",
  "רק לגברים": "מיועדות לגברים",
  "רק לנשים": "מיועדות לנשים",
  "שח״ר": "לא מתאימות לשח״ר",
  "רק לשח״ר": "מיועדות לשח״ר",
};

export function MyProfilePage() {
  const { api } = useAuth();
  const [p, setP] = useState<MyProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
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
  const can = (p.tasks ?? []).filter((x) => x.ok);
  // the duties they're not assigned to, grouped by reason – the reason once, the duties as chips
  const notFor = new Map<string, string[]>();
  for (const x of (p.tasks ?? []).filter((x) => !x.ok)) {
    const why = WHY[x.reason ?? ""] ?? x.reason ?? "";
    notFor.set(why, [...(notFor.get(why) ?? []), x.name]);
  }
  const notCount = [...notFor.values()].reduce((n, l) => n + l.length, 0);

  return (
    <Stack spacing={2} sx={{ maxWidth: 720, mx: "auto", width: "100%" }}>
      <Box>
        <Typography variant="h1">כרטיס אישי</Typography>
        <Typography variant="body2" color="text.secondary">
          כך המערכת רואה אותך – ועל זה מבוסס השיבוץ שלך.
        </Typography>
      </Box>
      <Alert severity="info">זיהית פער בנתונים? פנה לאחראי השיבוצים – הפרטים למטה, ב"למי לפנות".</Alert>

      <Section title="פרטים מקובץ כוח האדם">
        <Row label="שם" value={p.full_name} />
        <Row label="מסגרת" value={p.gaf ?? "—"} />
        <Row label="דרגה" value={`${p.rank ?? "—"}${p.appointed ? " (מינוי)" : ""}`} />
        <Row label="טלפון" value={<span dir="ltr">{p.phone ? p.phone.replace(/^972/, "0") : "—"}</span>} />
        <Row label="סוג שירות" value={`${SERVICE[p.service]}${p.career_start_date ? ` · כניסה לקבע ${dmy(p.career_start_date)}` : ""}`} />
        <Row label="גיוס · תום שירות" value={`גיוס ${dmy(p.enlistment_date)} · תום ${dmy(p.release_date)}`} />
        <Row
          label="תאריך קליטה ביחידה"
          value={dmy(p.unit_join_date)}
          sub={p.grace_until ? `בהכשרה עד ${dmy(p.grace_until)} – בלי שיבוץ אוטומטי` : undefined}
        />
      </Section>

      <Section title="מה משפיע על השיבוץ שלך">
        <Row label="ת״ש" value={t.value} sub={t.means} />
        <Row label="הורה" value={p.parent ? "כן" : "לא"} sub={p.parent ? "פתוחה לך גם המשימה המזכה, בעדיפות" : undefined} />
        <Row
          label="הקלה בעומס"
          value={p.relief ? `${p.relief.name} ×${p.relief.factor}` : "אין"}
          sub={p.relief ? `מקבל בערך ${Math.round(p.relief.factor * 100)}% מהעומס${p.relief.until ? ` · עד ${dmy(p.relief.until)}` : ""}` : undefined}
        />
        {p.shachar && <Row label="שח״ר" value="כן" sub="משובץ רק למשימות שמתאימות לשח״ר" />}
        {p.second_role_signed_at && <Row label="תפקיד שני" value={`נחתם ${dmy(p.second_role_signed_at)}`} />}
        <Row
          label="פטורים והיעדרויות"
          value={p.away.length ? p.away.map((a) => `${a.name ?? (a.kind === "absence" ? "היעדרות" : "פטור")}${a.status === "pending" ? " (ממתין)" : ""}`).join(" · ") : "אין"}
          sub={p.away.length ? p.away.map((a) => `${dmy(a.from)} – ${dmy(a.to)}`).join(" · ") : undefined}
          action={
            <Link component={RouterLink} to="/requests" variant="body2" sx={{ whiteSpace: "nowrap" }}>
              לבקשות
            </Link>
          }
        />
      </Section>

      <RangeCard />

      {p.cycle && (
        <Section title={`המשימות שלך – ${p.cycle.name}`}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {can.length ? `אפשר לשבץ אותך ל-${can.length} סוגי משימות:` : "אין משימות שמתאימות לך במחזור הזה."}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, my: 1 }}>
            {can.map((x) => (
              <Chip key={x.name} size="small" color="success" variant="outlined" label={x.name} />
            ))}
          </Stack>
          {notCount > 0 && (
            <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", border: 0, "&:before": { display: "none" } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                <Typography variant="body2">למה לא משבצים אותי לעוד {notCount} משימות?</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0, pt: 0 }}>
                <Stack spacing={1.5}>
                  {[...notFor].map(([why, names]) => (
                    <Box key={why}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {why}
                      </Typography>
                      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, mt: 0.5 }}>
                        {names.map((n) => (
                          <Chip key={n} size="small" variant="outlined" label={n} sx={{ color: "text.secondary" }} />
                        ))}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
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
            />
          )}
          {s.opening != null && <Row label="ניקוד פתיחה" value={Number(s.opening).toFixed(1)} sub="ממוצע הקבוצה, כשנקלטת ביחידה" />}
          {s.corrections.map((c, i) => (
            <Row
              key={i}
              label="תיקון ידני"
              value={<bdi dir="ltr">{`${c.points > 0 ? "+" : ""}${Number(c.points).toFixed(1)}`}</bdi>}
              sub={`סיבה: ${c.note ?? "—"}${c.by ? ` · ${c.by}` : ""}, ${dmy(c.at)}`}
            />
          ))}
          {p.cycle.published && (
            <Row label="משימות במחזור" value={<bdi dir="ltr">{`+${Number(s.cycle_points ?? 0).toFixed(1)}`}</bdi>} sub={`${s.cycle_duties ?? 0} משימות על הלוח`} />
          )}
          <Link component={RouterLink} to="/scoring" variant="body2" sx={{ display: "inline-block", pt: 1 }}>
            איך מחושב הניקוד?
          </Link>
        </Section>
      )}

      <ContactCard />
      <Typography variant="body2" color="text.secondary">
        מספר העובד שלך לא שמור במערכת בגלוי, והמערכת לא שומרת מידע רפואי. הערות פנימיות של הסגל לא מוצגות כאן.
      </Typography>
    </Stack>
  );
}

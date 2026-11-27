import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DetailsIcon from "@mui/icons-material/BadgeOutlined";
import AffectsIcon from "@mui/icons-material/TuneOutlined";
import TasksIcon from "@mui/icons-material/TaskAltOutlined";
import ScoreIcon from "@mui/icons-material/InsightsOutlined";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, CircularProgress, Link, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ContactCard } from "../components/ContactCard";
import { RangeCard } from "../components/RangeCard";
import { IconSection, TONE } from "../components/IconBadge";
import type { MyScore } from "../lib/me";
import { useAuth } from "../lib/auth";
import { dmy, scoreWords, tashText, type MyProfile } from "../lib/profile";

const SERVICE = { mandatory: "חובה", career: "קבע" } as const;

/** one fact; `action` beside it */
function Row(props: { label: string; value: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ py: 1.25, gap: 1.5, alignItems: "center", borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {props.label}
        </Typography>
        <Typography component="div" sx={{ fontWeight: 500 }}>{props.value}</Typography>
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

/** The score, a bar with the average marked on it, and a sentence. */
function ScoreBar({ total, avg, label, group }: { total: number; avg: number | null; label: string; group: string }) {
  const top = Math.max(total, avg ?? 0, 1) * 1.15;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / top) * 100))}%`;
  const words = scoreWords(total, avg);
  return (
    <Box sx={{ my: 1 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-end", gap: 2 }}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, color: "primary.main" }}>{total.toFixed(1)}</Typography>
        </Box>
        <Box sx={{ textAlign: "end" }}>
          <Typography variant="body2" color="text.secondary">
            ממוצע: <b>{avg != null ? avg.toFixed(1) : "—"}</b>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {group}
          </Typography>
        </Box>
      </Stack>
      {avg != null && (
        <>
          <Box sx={{ position: "relative", height: 10, mt: 1.5, mb: 0.75, bgcolor: "action.selected", borderRadius: 5 }} role="img" aria-label={words ?? undefined}>
            <Box sx={{ position: "absolute", insetInlineStart: 0, top: 0, bottom: 0, width: pct(total), bgcolor: "primary.main", borderRadius: 5 }} />
            <Box sx={{ position: "absolute", insetInlineStart: pct(avg), top: -5, bottom: -5, width: 2, bgcolor: "text.primary" }} />
          </Box>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="caption" color="text.secondary">
              פחות משימות
            </Typography>
            <Typography variant="caption" color="text.secondary">
              יותר משימות
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {words}
          </Typography>
        </>
      )}
    </Box>
  );
}

/** The points of each cycle against its group's mean – compact rows, folded. */
function ByCycle({ rows }: { rows: MyScore[] }) {
  return (
    <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", border: 0, "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
        <Typography variant="body2">הניקוד לפי מחזור ({rows.length})</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        {rows.map((r) => (
          <Row
            key={r.cycle_id}
            label={r.cycle_name}
            value={`${r.points.toFixed(1)} נק׳ ב-${r.duties} משימות`}
            sub={r.group_mean != null ? `ממוצע ${r.group_mean.toFixed(1)}${r.group_label ? ` · ${r.group_label}` : ""} · ${r.group_size} עובדים` : undefined}
          />
        ))}
      </AccordionDetails>
    </Accordion>
  );
}

export function MyProfilePage() {
  const { api } = useAuth();
  const [p, setP] = useState<MyProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<MyScore[]>([]);
  const load = useCallback(() => {
    api!
      .myProfile()
      .then(setP)
      .catch((e) => setError((e as Error).message));
    // the score per cycle, for "לפי מחזור" (moved here from "משימות", 2.73)
    api!.myScores().then(setCycles, () => setCycles([]));
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

      <IconSection title="פרטים מקובץ כוח האדם" icon={<DetailsIcon />} tone="info">
        <Row label="שם · מסגרת" value={`${p.full_name} · ${p.gaf ?? "—"}`} />
        <Row
          label="דרגה · טלפון"
          value={
            <>
              {`${p.rank ?? "—"}${p.appointed ? " (מינוי)" : ""} · `}
              <span dir="ltr">{p.phone ? p.phone.replace(/^972/, "0") : "—"}</span>
            </>
          }
        />
        <Row
          label="סוג שירות"
          value={
            <Stack direction="row" component="span" sx={{ gap: 1, alignItems: "center" }}>
              <Chip size="small" color={TONE[p.service]} variant="outlined" label={SERVICE[p.service]} />
              {p.career_start_date ? `כניסה לקבע ${dmy(p.career_start_date)}` : null}
            </Stack>
          }
        />
        <Row
          label="גיוס · תום שירות · קליטה ביחידה"
          value={`${dmy(p.enlistment_date)} · ${dmy(p.release_date)} · ${dmy(p.unit_join_date)}`}
          sub={p.grace_until ? `בהכשרה עד ${dmy(p.grace_until)} – בלי שיבוץ אוטומטי` : undefined}
        />
      </IconSection>

      <IconSection title="מה משפיע על השיבוץ שלך" icon={<AffectsIcon />} tone="primary">
        <Row label="ת״ש" value={t.value} sub={t.means} />
        <Row
          label="הורה · מקדם הקלה"
          value={`${p.parent ? "כן" : "לא"} · ${p.relief ? `${p.relief.name} ×${p.relief.factor}` : "אין הקלה"}`}
          sub={
            [
              p.parent && "פתוחה לך גם המשימה המזכה, בעדיפות",
              p.relief && `מקבל בערך ${Math.round(p.relief.factor * 100)}% מהעומס${p.relief.until ? ` · עד ${dmy(p.relief.until)}` : ""}`,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        {p.shachar && <Row label="שח״ר" value="כן" sub="משובץ רק למשימות שמתאימות לשח״ר" />}
        {p.second_role_signed_at && <Row label="תפקיד שני" value={`נחתם ${dmy(p.second_role_signed_at)}`} />}
        <Row
          label="פטורים והיעדרויות"
          value={
            p.away.length ? (
              <Stack direction="row" component="span" sx={{ gap: 0.75, flexWrap: "wrap", mt: 0.25 }}>
                {p.away.map((a, i) => (
                  <Chip
                    key={i}
                    size="small"
                    variant="outlined"
                    color={a.status === "pending" ? TONE.pending : a.kind === "absence" ? TONE.absence : TONE.exemption}
                    label={`${a.name ?? (a.kind === "absence" ? "היעדרות" : "פטור")} · ${dmy(a.from)}–${dmy(a.to)}${a.status === "pending" ? " · ממתין" : ""}`}
                  />
                ))}
              </Stack>
            ) : (
              "אין"
            )
          }
          action={
            <Link component={RouterLink} to="/requests" variant="body2" sx={{ whiteSpace: "nowrap" }}>
              לבקשות
            </Link>
          }
        />
      </IconSection>

      <RangeCard />

      {p.cycle && (
        <IconSection title={`המשימות שלך – ${p.cycle.name}`} icon={<TasksIcon />} tone="success">
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
        </IconSection>
      )}

      {s && p.cycle && (
        <IconSection title="הניקוד שלך" icon={<ScoreIcon />} tone="warning">
          <ScoreBar
            total={Number(s.earlier) + Number(s.cycle_points ?? 0)}
            avg={s.group_avg != null ? Number(s.group_avg) : null}
            label={p.cycle.published ? "הניקוד שלך" : "הניקוד שלך לפני המחזור"}
            group={`${p.service === "career" ? "עובדי קבע" : "עובדי חובה"} שנמדדים איתך (${s.group_size})`}
          />
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
          {cycles.length > 0 && <ByCycle rows={cycles} />}
          <Link component={RouterLink} to="/scoring" variant="body2" sx={{ display: "inline-block", pt: 1 }}>
            איך מחושב הניקוד?
          </Link>
        </IconSection>
      )}

      <ContactCard />
      <Typography variant="body2" color="text.secondary">
        מספר העובד שלך לא שמור במערכת בגלוי, והמערכת לא שומרת מידע רפואי. הערות פנימיות של הסגל לא מוצגות כאן.
      </Typography>
    </Stack>
  );
}

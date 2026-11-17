import { Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { ErrorState } from "../components/EmptyState";
import { Mascot } from "../components/Mascot";
import { isSoldier } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dayLabel } from "../lib/dates";
import type { MyDuty } from "../lib/me";
import { buildExamples, num, tasksByCategory, type ScoringRules } from "../lib/scoringRules";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Typography variant="h3" sx={{ fontWeight: 800, mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/** The formula as three blocks: weight + addition, then × call-up. */
function Formula({ r }: { r: ScoringRules }) {
  const block = (label: string, sub: string, color: string) => (
    <Box sx={{ border: 2, borderColor: color, borderRadius: 2, px: { xs: 0.75, sm: 1.5 }, py: { xs: 0.5, sm: 1 }, textAlign: "center", minWidth: { xs: 0, sm: 110 }, flexShrink: 1 }}>
      <Typography sx={{ fontWeight: 800, fontSize: { xs: 13, sm: 16 }, lineHeight: 1.3 }}>{label}</Typography>
      {/* on a phone the lines under the formula say the same */}
      <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
        {sub}
      </Typography>
    </Box>
  );
  const op = (t: string) => (
    <Typography sx={{ fontWeight: 800, fontSize: { xs: 17, sm: 22 }, px: { xs: 0, sm: 0.5 }, flexShrink: 0 }} aria-hidden>
      {t}
    </Typography>
  );
  return (
    <Stack direction="row" sx={{ alignItems: "center", flexWrap: "nowrap", gap: { xs: 0.5, sm: 1 }, justifyContent: "center", my: 1 }}>
      {op(")")}
      {block("משקל התורנות", "קבוע לכל סוג תורנות", "primary.main")}
      {op("+")}
      {block("תוספת יום", "הגבוהה שחלה, פעם אחת", "secondary.main")}
      {op("(")}
      {op("×")}
      {block(`הקפצה ×${num(r.surprise_multiplier)}`, `רק בפחות מ-${r.surprise_notice_hours} שעות`, "warning.main")}
    </Stack>
  );
}

/** "איך מחושב הניקוד": the formula in plain words, the live weights, worked examples and how fairness is kept. */
export function ScoringPage() {
  const { api, me } = useAuth();
  const soldier = isSoldier(me);
  const [rules, setRules] = useState<ScoringRules | null>(null);
  const [duties, setDuties] = useState<MyDuty[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api!.scoringRules().then(setRules, (e) => setError((e as Error).message));
    if (soldier) api!.myDuties().then(setDuties, () => setDuties([]));
  }, [api, soldier]);

  if (error) return <ErrorState text={error} onRetry={() => window.location.reload()} />;
  if (!rules)
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  const examples = buildExamples(rules);
  const mine = duties
    .filter((d) => d.role === "performer")
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, 5);

  return (
    <Stack spacing={2} sx={{ maxWidth: 880, mx: "auto", width: "100%" }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Mascot pose="clipboard" height={96} />
        <Box>
          <Typography variant="h1">איך מחושב הניקוד</Typography>
          <Typography variant="body2" color="text.secondary">
            כל תורנות שווה נקודות. מי שצבר פחות – משובץ קודם. כך מתחלק העומס בצורה הוגנת.
          </Typography>
        </Box>
      </Stack>

      <Section title="הנוסחה">
        <Formula r={rules} />
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          <Typography variant="body2">
            <b>משקל התורנות</b> – כמה התורנות קשה. נקבע לכל סוג תורנות (בטבלה למטה), ושווה לכל התורנות, גם אם היא נמשכת כמה ימים.
          </Typography>
          <Typography variant="body2">
            <b>תוספת יום</b> – אם התורנות נופלת בחג, בערב חג או ביום מיוחד, מוסיפים את התוספת שלו. אם חלות כמה – נספרת רק הגבוהה, פעם אחת.
          </Typography>
          <Typography variant="body2">
            <b>הקפצה</b> – מי ששובץ אחרי פרסום השיבוץ, פחות מ-{rules.surprise_notice_hours} שעות לפני תחילת התורנות, מקבל פי {num(rules.surprise_multiplier)}. השיבוץ הראשון שמתפרסם אף פעם לא נחשב הקפצה.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            עתודה שלא הופעלה לא מקבלת נקודות. עתודה שהופעלה מקבלת את הנקודות של התורנות.
          </Typography>
        </Stack>
      </Section>

      {examples.length > 0 && (
        <Section title="דוגמאות">
          <Stack spacing={1}>
            {examples.map((e) => (
              <Stack key={e.title} direction="row" spacing={1.5} sx={{ alignItems: "center", py: 0.75, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>{e.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {e.note}
                  </Typography>
                </Box>
                {/* arithmetic reads left to right: "15 = (4 + 6) × 1.5" with the chip; dir, not sx – the RTL plugin flips sx direction */}
                <Typography variant="body2" dir="ltr" sx={{ unicodeBidi: "isolate", whiteSpace: "nowrap", color: "text.secondary" }}>
                  = {e.calc}
                </Typography>
                <Chip label={`${num(e.result)} נק׳`} color="primary" sx={{ fontWeight: 700, minWidth: 72 }} />
              </Stack>
            ))}
          </Stack>
        </Section>
      )}

      <Section title="משקלי התורנויות">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>תורנות</TableCell>
              <TableCell align="center" sx={{ width: 90 }}>
                משקל
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tasksByCategory(rules).map(([cat, tasks]) => [
              <TableRow key={`c-${cat}`}>
                <TableCell colSpan={2} sx={{ bgcolor: "action.hover", fontWeight: 700 }}>
                  {cat}
                </TableCell>
              </TableRow>,
              ...tasks.map((t) => (
                <TableRow key={t.name}>
                  <TableCell>
                    {t.name}
                    {t.includes_holidays && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                        · המשקל כבר כולל חגים, בלי תוספת
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700 }}>
                    {num(t.weight)}
                  </TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </Section>

      {rules.additions.length > 0 && (
        <Section title="תוספות לימים מיוחדים">
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
            {rules.additions.map((a) => (
              <Chip key={a.name} variant="outlined" color="secondary" label={`${a.name} +${num(a.value)}`} />
            ))}
          </Stack>
        </Section>
      )}

      <Section title="איך נשמר הצדק">
        <Box component="ul" sx={{ m: 0, pr: 2.5, pl: 0, "& li + li": { mt: 0.75 } }}>
          <Typography component="li" variant="body2">
            <b>משווים רק בין מי שיכולים לעשות אותן תורנויות.</b> חייל לא נמדד מול מי שזכאי לתורנויות אחרות לגמרי.
          </Typography>
          <Typography component="li" variant="body2">
            <b>הזיכרון הוא {rules.window_months} חודשים.</b> נקודות מהמחזורים הקודמים בחלון הזה נכנסות לחשבון, כך שמי שעשה הרבה במחזור הקודם יקבל פחות עכשיו.
          </Typography>
          <Typography component="li" variant="body2">
            <b>מי שלא היה ביחידה שלא מבחירה לא נענש.</b> על ימים של קורס או מחלה ארוכים, פטור מלא, או לפני הגיוס ואחרי השחרור, מקבלים זיכוי לפי הממוצע של הקבוצה – כדי שלא תחכה ערימת תורנויות בחזרה. חופשה או חו״ל הם בחירה, ולכן לא מזכים: את העומס משלימים אחר כך.
          </Typography>
          <Typography component="li" variant="body2">
            <b>תפקיד עמוס ביחידה נלקח בחשבון.</b> למי שמוגדר בתפקיד כזה הנקודות נספרות לפי מקדם התפקיד, כך שהוא משובץ פחות.
          </Typography>
          <Typography component="li" variant="body2">
            <b>סופי שבוע וחגים מאוזנים בנפרד.</b> מי שעשה חג בשנה האחרונה יעשה את הבא רק אחרי מי שלא עשה. גם עתודות, סופי שבוע רצופים ושתי תורנויות באותו שבוע מתחלקים בצורה שווה ככל האפשר.
          </Typography>
          <Typography component="li" variant="body2">
            <b>חריגה מסומנת.</b> מי שרחוק ביותר מ-{num(rules.fairness_tolerance_pct)}% מהממוצע של הקבוצה שלו מסומן אצל נע״ת התורנויות לבדיקה.
          </Typography>
        </Box>
      </Section>

      {soldier && (
        <Section title="למה קיבלתי את התורנות הזו?">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            ליד כל תורנות שלך נשמרת הסיבה. אפשר לראות אותה גם ב״התורנויות שלי״, בלחיצה על התורנות.
          </Typography>
          {mine.length === 0 ? (
            <Typography variant="body2">עוד אין לך תורנויות בלוח שפורסם.</Typography>
          ) : (
            <Stack spacing={1}>
              {mine.map((d) => (
                <Box key={d.assignment_id} sx={{ borderInlineStart: 3, borderColor: "secondary.main", pr: 1.5, py: 0.5 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {d.task_name} · {dayLabel(d.starts_at)} · {num(d.points)} נק׳
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {d.explanation ?? "שובץ ידנית על ידי נע״ת התורנויות."}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Section>
      )}
    </Stack>
  );
}

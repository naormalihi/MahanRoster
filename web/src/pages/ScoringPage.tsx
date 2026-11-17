import { Box, Chip, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { ErrorState } from "../components/EmptyState";
import { Mascot } from "../components/Mascot";
import { isSoldier } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dayLabel } from "../lib/dates";
import type { MyDuty } from "../lib/me";
import { buildExamples, num, type ScoringRules } from "../lib/scoringRules";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Typography variant="h3" sx={{ fontWeight: 800, mb: 1.25 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/** The formula as three blocks: (weight + addition) × call-up. */
function Formula({ r }: { r: ScoringRules }) {
  const block = (label: ReactNode, color: string) => (
    <Box sx={{ border: 2, borderColor: color, borderRadius: 2, px: { xs: 1, sm: 1.5 }, py: 0.75, flexShrink: 1 }}>
      <Typography sx={{ fontWeight: 800, fontSize: { xs: 14, sm: 16 }, textAlign: "center" }}>{label}</Typography>
    </Box>
  );
  const op = (t: string) => (
    <Typography sx={{ fontWeight: 800, fontSize: { xs: 18, sm: 22 }, flexShrink: 0 }} aria-hidden>
      {t}
    </Typography>
  );
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: { xs: 0.5, sm: 1 }, justifyContent: "center", my: 0.5 }}>
      {/* in an RTL row the opening bracket sits on the right, so it is drawn as ")" */}
      {op(")")}
      {block("משקל", "primary.main")}
      {op("+")}
      {block("תוספת חג", "secondary.main")}
      {op("(")}
      {op("×")}
      {block(
        <>
          הקפצה{" "}
          <Box component="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
            ×{num(r.surprise_multiplier)}
          </Box>
        </>,
        "warning.main",
      )}
    </Stack>
  );
}

const Line = ({ b, children }: { b: string; children: ReactNode }) => (
  <Typography variant="body2">
    <b>{b}</b> – {children}
  </Typography>
);

/** "איך מחושב הניקוד": short and to the point – the formula, examples, the numbers, fairness, and why I got it. */
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
    .slice(0, 3);

  return (
    <Stack spacing={2} sx={{ maxWidth: 720, mx: "auto", width: "100%" }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Mascot pose="clipboard" height={84} />
        <Box>
          <Typography variant="h1">איך מחושב הניקוד</Typography>
          <Typography variant="body2" color="text.secondary">
            כל תורנות שווה נקודות. מי שצבר פחות – משובץ קודם.
          </Typography>
        </Box>
      </Stack>

      <Section title="הנוסחה">
        <Formula r={rules} />
        <Stack spacing={0.5} sx={{ mt: 1.25 }}>
          <Line b="משקל">לפי סוג התורנות.</Line>
          <Line b="תוספת חג">בחג או ביום מיוחד. אם חלות כמה – רק הגבוהה.</Line>
          <Line b="הקפצה">
            שיבוץ אחרי הפרסום, פחות מ-{rules.surprise_notice_hours} שעות לפני התורנות.
          </Line>
        </Stack>
      </Section>

      {examples.length > 0 && (
        <Section title="לדוגמה">
          <Stack spacing={0.75}>
            {examples.map((e) => (
              <Stack key={e.title} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Typography sx={{ flex: 1, minWidth: 0 }}>{e.title}</Typography>
                {/* arithmetic reads left to right ("15 = (4 + 6) × 1.5"); dir, not sx – the RTL plugin flips sx direction */}
                <Typography variant="body2" dir="ltr" sx={{ unicodeBidi: "isolate", whiteSpace: "nowrap", color: "text.secondary" }}>
                  = {e.calc}
                </Typography>
                <Chip label={`${num(e.result)} נק׳`} color="primary" size="small" sx={{ fontWeight: 700, minWidth: 64 }} />
              </Stack>
            ))}
          </Stack>
        </Section>
      )}

      <Section title="המספרים">
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
          {rules.tasks.map((t) => (
            <Chip key={t.name} variant="outlined" label={`${t.name} · ${num(t.weight)}`} />
          ))}
        </Stack>
        {rules.additions.length > 0 && (
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, mt: 1.25 }}>
            {rules.additions.map((a) => (
              <Chip key={a.name} variant="outlined" color="secondary" label={`${a.name} +${num(a.value)}`} />
            ))}
          </Stack>
        )}
      </Section>

      <Section title="למה זה הוגן">
        <Stack spacing={0.5}>
          <Line b="משווים נכון">רק מול מי שיכולים לעשות אותן תורנויות.</Line>
          <Line b="יש זיכרון">נספרות גם הנקודות של {rules.window_months} החודשים האחרונים.</Line>
          <Line b="היעדרות לא מבחירה">קורס או מחלה ארוכים מזכים – לא חוזרים לערימה.</Line>
          <Line b="חגים וסופי שבוע">מתחלקים בתורות. מי שעשה חג – אחרון לבא.</Line>
        </Stack>
      </Section>

      {soldier && mine.length > 0 && (
        <Section title="למה קיבלתי?">
          <Stack spacing={1}>
            {mine.map((d) => (
              <Box key={d.assignment_id} sx={{ borderInlineStart: 3, borderColor: "secondary.main", pr: 1.5 }}>
                <Typography sx={{ fontWeight: 600 }}>
                  {d.task_name} · {dayLabel(d.starts_at)} · {num(d.points)} נק׳
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {d.explanation ?? "שובץ ידנית על ידי נע״ת התורנויות."}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

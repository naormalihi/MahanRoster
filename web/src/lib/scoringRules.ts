/** "איך מחושב הניקוד": the rules as the server gives them, and worked examples built from them. */
export interface ScoringRules {
  tasks: { name: string; weight: number; includes_holidays: boolean; category: string | null }[];
  /** day additions (holidays, eves, special days); the highest one that applies is added once */
  additions: { name: string; value: number }[];
  surprise_multiplier: number;
  surprise_notice_hours: number;
  window_months: number;
  fairness_tolerance_pct: number;
}

export interface ScoringExample {
  title: string;
  /** the calculation as shown, e.g. "(4 + 6) × 1.5" */
  calc: string;
  result: number;
  note: string;
}

/** 1.5 → "1.5", 4 → "4", 2.25 → "2.25" */
export const num = (n: number) => String(Math.round(n * 100) / 100);

const round = (n: number) => Math.round(n * 100) / 100;

/** A task to show the examples on: a middle weight among those that take holiday additions. */
export function exampleTask(rules: ScoringRules) {
  const pool = rules.tasks.filter((t) => !t.includes_holidays);
  const list = (pool.length ? pool : rules.tasks).slice().sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "he"));
  return list.length ? list[Math.floor((list.length - 1) / 2)] : null;
}

export function buildExamples(rules: ScoringRules): ScoringExample[] {
  const t = exampleTask(rules);
  if (!t) return [];
  const w = t.weight;
  const s = rules.surprise_multiplier;
  const h = rules.surprise_notice_hours;
  const adds = rules.additions.slice().sort((a, b) => b.value - a.value);
  const top = adds[0];
  const out: ScoringExample[] = [
    { title: `${t.name} ביום רגיל`, calc: num(w), result: round(w), note: "רק המשקל של התורנות." },
  ];
  if (top) {
    out.push({
      title: `${t.name} ב${top.name}`,
      calc: `${num(w)} + ${num(top.value)}`,
      result: round(w + top.value),
      note: `התוספת של ${top.name} מתווספת למשקל.`,
    });
  }
  if (adds.length > 1) {
    const second = adds[1];
    out.push({
      title: `${t.name} כשחלים גם ${top.name} וגם ${second.name}`,
      calc: `${num(w)} + ${num(top.value)}`,
      result: round(w + top.value),
      note: `נספרת רק התוספת הגבוהה (${num(top.value)}), פעם אחת – לא ${num(top.value)} + ${num(second.value)}.`,
    });
  }
  out.push({
    title: `${t.name} בהקפצה`,
    calc: `${num(w)} × ${num(s)}`,
    result: round(w * s),
    note: `שובצת פחות מ-${h} שעות לפני תחילת התורנות, אחרי שהשיבוץ כבר פורסם.`,
  });
  if (top) {
    out.push({
      title: `${t.name} ב${top.name}, בהקפצה`,
      calc: `(${num(w)} + ${num(top.value)}) × ${num(s)}`,
      result: round((w + top.value) * s),
      note: "קודם מחברים את התוספת, ואז מכפילים בהקפצה.",
    });
  }
  return out;
}

/** The tasks grouped by category, for the weights table. */
export function tasksByCategory(rules: ScoringRules): [string, ScoringRules["tasks"]][] {
  const m = new Map<string, ScoringRules["tasks"]>();
  for (const t of rules.tasks) {
    const k = t.category ?? "אחר";
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return [...m.entries()];
}

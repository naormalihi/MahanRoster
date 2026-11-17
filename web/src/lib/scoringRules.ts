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

/** Three examples on one task: a regular day, a holiday (the highest addition), and a holiday call-up. */
export function buildExamples(rules: ScoringRules): ScoringExample[] {
  const t = exampleTask(rules);
  if (!t) return [];
  const w = t.weight;
  const s = rules.surprise_multiplier;
  const top = rules.additions.slice().sort((a, b) => b.value - a.value)[0];
  if (!top) {
    return [
      { title: `${t.name} ביום רגיל`, calc: num(w), result: round(w) },
      { title: `${t.name} בהקפצה`, calc: `${num(w)} × ${num(s)}`, result: round(w * s) },
    ];
  }
  return [
    { title: `${t.name} ביום רגיל`, calc: num(w), result: round(w) },
    { title: `${t.name} ב${top.name}`, calc: `${num(w)} + ${num(top.value)}`, result: round(w + top.value) },
    { title: `${t.name} ב${top.name}, בהקפצה`, calc: `(${num(w)} + ${num(top.value)}) × ${num(s)}`, result: round((w + top.value) * s) },
  ];
}

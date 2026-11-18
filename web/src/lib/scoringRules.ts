/** "איך מחושב הניקוד": the rules as the server gives them, and worked examples built from them. */
export interface ScoringRules {
  tasks: { name: string; weight: number; includes_holidays: boolean; weekend_type?: boolean; category: string | null }[];
  /** day additions (weekend, holidays, eves, חול המועד); the highest one that applies is added once */
  additions: { name: string; value: number }[];
  surprise_multiplier: number;
  surprise_notice_hours: number;
  window_months: number;
  fairness_tolerance_pct: number;
  /** a long absence not by choice counts from this many days */
  credit_min_days?: number;
  /** the absence types credited as "not by choice" (קורס, מחלה…), as named in the settings */
  credit_absences?: string[];
}

/** "קורס, מחלה או מילואים" */
export function orList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} או ${names[names.length - 1]}`;
}

export interface ScoringExample {
  title: string;
  /** the calculation as shown, e.g. "(4 + 6) × 1.3" */
  calc: string;
  result: number;
}

/** 1.5 → "1.5", 4 → "4", 2.25 → "2.25" */
export const num = (n: number) => String(Math.round(n * 100) / 100);

const round = (n: number) => Math.round(n * 100) / 100;

/** "פסח · ערב חג" → "ערב פסח", "פסח · החג" → "פסח", "פסח · חול המועד" → "חול המועד פסח"; any other name as is. */
export function additionLabel(name: string): string {
  const m = /^(.+?)\s*·\s*(ערב חג|החג|חול המועד)$/.exec(name.trim());
  if (!m) return name;
  if (m[2] === "ערב חג") return `ערב ${m[1]}`;
  if (m[2] === "חול המועד") return `חול המועד ${m[1]}`;
  return m[1];
}

/** The additions by value, highest first: [{ value: 6, names: ["ערב ראש השנה", …] }, …] */
export function additionsByValue(rules: ScoringRules): { value: number; names: string[] }[] {
  const m = new Map<number, string[]>();
  for (const a of rules.additions) m.set(a.value, [...(m.get(a.value) ?? []), additionLabel(a.name)]);
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([value, names]) => ({ value, names }));
}

/** What a duty's weight already covers: no weekend addition, no holiday additions, or neither. */
export function taskNote(t: ScoringRules["tasks"][number]): string | null {
  if (t.includes_holidays && t.weekend_type) return "קבוע, בלי תוספות";
  if (t.includes_holidays) return "בלי תוספת חג";
  if (t.weekend_type) return "בלי תוספת סוף שבוע";
  return null;
}

/**
 * The duty to show the examples on: one that takes every addition, with the middle weight
 * among the distinct weights (so neither the lightest nor the heaviest).
 */
export function exampleTask(rules: ScoringRules) {
  const plain = rules.tasks.filter((t) => !t.includes_holidays && !t.weekend_type);
  const pool = plain.length ? plain : rules.tasks;
  if (!pool.length) return null;
  const weights = [...new Set(pool.map((t) => t.weight))].sort((a, b) => a - b);
  const w = weights[Math.floor((weights.length - 1) / 2)];
  return pool.filter((t) => t.weight === w).sort((a, b) => a.name.localeCompare(b.name, "he"))[0];
}

/** Three examples on one duty: a regular day, the day with the highest addition, and that day as a call-up. */
export function buildExamples(rules: ScoringRules): ScoringExample[] {
  const t = exampleTask(rules);
  if (!t) return [];
  const w = t.weight;
  const s = rules.surprise_multiplier;
  const top = rules.additions.slice().sort((a, b) => b.value - a.value)[0];
  const regular = { title: `${t.name} ביום רגיל`, calc: num(w), result: round(w) };
  if (!top) return [regular, { title: `${t.name} בהקפצה`, calc: `${num(w)} × ${num(s)}`, result: round(w * s) }];
  const day = additionLabel(top.name);
  return [
    regular,
    { title: `${t.name} ב${day}`, calc: `${num(w)} + ${num(top.value)}`, result: round(w + top.value) },
    { title: `${t.name} ב${day}, בהקפצה`, calc: `(${num(w)} + ${num(top.value)}) × ${num(s)}`, result: round((w + top.value) * s) },
  ];
}

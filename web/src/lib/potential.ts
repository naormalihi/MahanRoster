/** Potential matrix (מטריצת הפוטנציאל): soldier × duty category. */

export interface PotentialCell {
  soldier_id: string;
  category_id: string;
  value: number; // computed: 1, 0 or a share of the cycle days
  best_task_type_id: string;
  reasons: string[]; // why the cell is 0
  available_days: number;
  cycle_days: number;
  override_value: number | null;
  override_reason: string | null;
}

export interface SnapshotSoldier {
  soldier_id: string;
  rank_name: string;
  service_type: "mandatory" | "career";
  is_parent: boolean;
  qualifies_day_only: boolean;
  balance_population: string;
  baseline_score: number;
  /** Soldiers who can share load inside the population (connected duty categories). */
  fairness_group?: string | null;
  fairness_label?: string | null;
  /** Availability credit of the last run: days out of the unit not by choice, and their points. */
  credit_days?: number;
  credit?: number;
}

export interface DailyAvailability {
  day: string;
  category_id: string;
  available: number;
}

export const REASON_LABEL: Record<string, string> = {
  service: "התורנות מוגבלת לחובה או לקבע",
  population: "האוכלוסייה לא זכאית",
  rank: "הדרגה מחוץ לטווח",
  gender: "מגדר",
  qualifying_only: "משרת הורה או פטור מזכה – רק ממלכ\"ת יום",
  not_qualifying: "ממלכ\"ת יום – רק לאוכלוסיות שהוגדרו לה, למשרתי הורה ולבעלי פטור מזכה",
  shachar: "שח\"ר – התורנות לא מסומנת מתאימה",
  home_nightly: "ת\"ש 7 – לן בבית, והתורנות כוללת לילה",
  unavailable: "לא זמין בכל המחזור (היעדרות, פטור, גיוס/שחרור או חודש חסד)",
  weapon_range: "מטווח לא בתוקף ביום התורנות",
  not_enlisted: "לפני תאריך הגיוס",
  released: "אחרי תאריך השחרור",
  grace: "חודש חסד",
  exemption: "פטור מאושר",
  absence: "היעדרות",
  date_block: "חסימת תאריך",
  personal_constraint: "אילוץ אישי",
  penalty_other: "משבצת קנס של חייל אחר",
  busy: "משובץ בתורנות סמוכה (כולל מנוחה)",
  at_cap: "בתקרה החודשית",
  gaf_rule: "עתודת חובה – רק מגף המבצע",
  other_role: "כבר משובץ בתורנות הזו בתפקיד אחר",
};

export const reasonText = (reasons: string[]) => reasons.map((r) => REASON_LABEL[r] ?? r).join(" · ");

export const effective = (c: Pick<PotentialCell, "value" | "override_value">) => c.override_value ?? c.value;

/** How a cell is shown: "1", "" (not eligible) or "0.67". */
export const cellText = (v: number) => (v === 0 ? "" : v === 1 ? "1" : v.toFixed(2));

export interface CategorySummary {
  category_id: string;
  total: number; // sum of the cells (soldier-equivalents for the whole cycle)
  full: number; // cells equal to 1
  partial: number; // 0 < cell < 1
  overrides: number;
}

export function summarize(cells: PotentialCell[], categoryIds: string[]): CategorySummary[] {
  const by = new Map<string, CategorySummary>(categoryIds.map((id) => [id, { category_id: id, total: 0, full: 0, partial: 0, overrides: 0 }]));
  for (const c of cells) {
    const s = by.get(c.category_id);
    if (!s) continue;
    const v = effective(c);
    s.total += v;
    if (v === 1) s.full++;
    else if (v > 0) s.partial++;
    if (c.override_value !== null) s.overrides++;
  }
  for (const s of by.values()) s.total = Math.round(s.total * 100) / 100;
  return categoryIds.map((id) => by.get(id)!);
}

export function overrideProblems(value: number, reason: string): string | null {
  if (!(value >= 0 && value <= 1)) return "ערך בין 0 ל-1";
  if (Math.round(value * 100) !== value * 100) return "עד שתי ספרות אחרי הנקודה";
  if (!reason.trim()) return "חובה לכתוב נימוק";
  return null;
}

// ---------------------------------------------------------------------------
// Export to the base: a summary per category and a list of names
// ---------------------------------------------------------------------------

export interface ExportSoldier {
  id: string;
  full_name: string;
  gaf_name: string;
  rank_name: string;
}

export function exportSheets(
  soldiers: ExportSoldier[],
  categories: { id: string; name: string }[],
  cells: PotentialCell[],
  cycleName: string,
) {
  const at = new Map(cells.map((c) => [`${c.soldier_id}|${c.category_id}`, effective(c)]));
  const summary = summarize(cells, categories.map((c) => c.id));
  const summaryRows: (string | number)[][] = [
    [`פוטנציאל – ${cycleName}`],
    [],
    ["קטגוריה", "סה\"כ פוטנציאל", "זמינים לכל המחזור", "זמינים חלקית"],
    ...categories.map((c, i) => [c.name, summary[i].total, summary[i].full, summary[i].partial]),
  ];
  const names = soldiers
    .filter((s) => categories.some((c) => (at.get(`${s.id}|${c.id}`) ?? 0) > 0))
    .sort((a, b) => a.gaf_name.localeCompare(b.gaf_name, "he") || a.full_name.localeCompare(b.full_name, "he"));
  const nameRows: (string | number | null)[][] = [
    ["שם מלא", "גף", "דרגה", ...categories.map((c) => c.name)],
    ...names.map((s) => [
      s.full_name,
      s.gaf_name,
      s.rank_name,
      ...categories.map((c) => {
        const v = at.get(`${s.id}|${c.id}`) ?? 0;
        return v === 0 ? null : v;
      }),
    ]),
  ];
  return { summaryRows, nameRows };
}

// ---------------------------------------------------------------------------
// Availability heat map: weeks × categories
// ---------------------------------------------------------------------------

export interface WeekCell {
  week_start: string;
  min: number; // fewest available soldiers on a day of that week
  worst_day: string;
}

/** Weeks start on Sunday, as in Israel. */
export function weekly(daily: DailyAvailability[], categoryId: string): WeekCell[] {
  const weeks = new Map<string, WeekCell>();
  for (const d of daily.filter((x) => x.category_id === categoryId).sort((a, b) => a.day.localeCompare(b.day))) {
    const dt = new Date(d.day + "T12:00:00Z");
    dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
    const key = dt.toISOString().slice(0, 10);
    const w = weeks.get(key);
    if (!w) weeks.set(key, { week_start: key, min: d.available, worst_day: d.day });
    else if (d.available < w.min) Object.assign(w, { min: d.available, worst_day: d.day });
  }
  return [...weeks.values()];
}

/** 0 (worst) … 1 (best) relative to the category's own range, for colouring. */
export function heat(value: number, all: number[]): number {
  const lo = Math.min(...all), hi = Math.max(...all);
  return hi === lo ? 1 : (value - lo) / (hi - lo);
}

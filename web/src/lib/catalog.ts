/** Duty catalog, scoring multipliers and the holiday calendar – what נע"ת manages on the settings screen. */

import { HebrewCalendar } from "@hebcal/core";

export type ServiceRestriction = "any" | "mandatory" | "career";

export interface TaskType {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  weight: number;
  min_rest_hours: number;
  service_restriction: ServiceRestriction;
  requires_weapon: boolean;
  is_weekend_type: boolean;
  shachar_compatible: boolean;
  qualifying_duty: boolean;
  eligible_populations: string[];
  rank_min_id: string | null;
  rank_max_id: string | null;
  gender: "male" | "female" | null;
  default_start_time: string | null; // HH:MM
  default_end_time: string | null;
  /** hours by start weekday ("0" = Sunday … "6", "after_holiday"), "HH:MM-HH:MM"; overrides the defaults */
  weekday_hours: Record<string, string> | null;
  color: string | null;
  is_active: boolean;
}

export type TaskTypeInput = Omit<TaskType, "id">;

export interface Population {
  code: string;
  name: string;
}

export const SERVICE_LABEL: Record<ServiceRestriction, string> = { any: "כולם", mandatory: "חובה", career: "קבע" };

export function taskTypeProblems(t: TaskTypeInput, others: Pick<TaskType, "id" | "code" | "name">[], selfId?: string): string[] {
  const p: string[] = [];
  const rest = others.filter((o) => o.id !== selfId);
  if (!t.name.trim()) p.push("חסר שם");
  else if (rest.some((o) => o.name.trim() === t.name.trim())) p.push("כבר יש תורנות בשם הזה");
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(t.code)) p.push("קוד: אותיות לטיניות קטנות, ספרות וקו תחתון");
  else if (rest.some((o) => o.code === t.code)) p.push("כבר יש תורנות עם הקוד הזה");
  if (!(t.weight > 0) || t.weight > 99) p.push("משקל חייב להיות גדול מ-0 (עד 99)");
  if (!Number.isInteger(t.min_rest_hours) || t.min_rest_hours < 0) p.push("שעות מנוחה – מספר שלם, 0 ומעלה");
  if (!!t.default_start_time !== !!t.default_end_time) p.push("שעת התחלה וסיום – שתיהן או אף אחת");
  if (t.weekday_hours && Object.values(t.weekday_hours).some((w) => !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d(\+1)?$/.test(w)))
    p.push("שעות לפי יום בתבנית 08:00-17:00 (או 06:00-08:00+1 לסיום למחרת)");
  return p;
}

// ---------------------------------------------------------------------------
// Scoring settings
// ---------------------------------------------------------------------------

export interface ScoringSettings {
  weekend_multiplier: number;
  holiday_multiplier: number;
  night_multiplier: number;
  night_window: string; // "22:00-06:00"
  weekend_weekdays: number[]; // ISO: 1 = Monday … 7 = Sunday
}

export const SCORING_KEYS = ["weekend_multiplier", "holiday_multiplier", "night_multiplier", "night_window", "weekend_weekdays"] as const;

export const ISO_DAY_LABEL: Record<number, string> = { 7: "ראשון", 1: "שני", 2: "שלישי", 3: "רביעי", 4: "חמישי", 5: "שישי", 6: "שבת" };

export function scoringProblems(s: ScoringSettings): string[] {
  const p: string[] = [];
  for (const [k, label] of [
    ["weekend_multiplier", "סוף שבוע"],
    ["holiday_multiplier", "חג"],
    ["night_multiplier", "לילה"],
  ] as const)
    if (!(s[k] >= 1) || s[k] > 5) p.push(`מקדם ${label} – בין 1 ל-5`);
  if (!/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(s.night_window)) p.push("חלון לילה בתבנית 22:00-06:00");
  if (!s.weekend_weekdays.length) p.push("בחר לפחות יום אחד של סוף שבוע");
  return p;
}

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

export type DayType = "holiday" | "holiday_eve" | "memorial" | "weekend" | "weekday";

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  holiday: "חג",
  holiday_eve: "ערב חג",
  memorial: "יום זיכרון",
  weekend: "סופ\"ש",
  weekday: "חול",
};

export interface CalendarDay {
  day: string; // YYYY-MM-DD
  day_type: DayType;
  source: "hebcal" | "manual";
  note: string | null;
}

/**
 * Days that count in Israel. Holidays and their eves get the holiday multiplier;
 * memorial days are marked for information only. חול המועד is not marked.
 */
const HOLIDAY_RULES: { match: (desc: string) => boolean; type: DayType; note: string }[] = [
  { match: (d) => d === "Erev Rosh Hashana", type: "holiday_eve", note: "ערב ראש השנה" },
  { match: (d) => /^Rosh Hashana \d+$/.test(d), type: "holiday", note: "ראש השנה א׳" },
  { match: (d) => d === "Rosh Hashana II", type: "holiday", note: "ראש השנה ב׳" },
  { match: (d) => d === "Erev Yom Kippur", type: "holiday_eve", note: "ערב יום כיפור" },
  { match: (d) => d === "Yom Kippur", type: "holiday", note: "יום כיפור" },
  { match: (d) => d === "Erev Sukkot", type: "holiday_eve", note: "ערב סוכות" },
  { match: (d) => d === "Sukkot I", type: "holiday", note: "סוכות" },
  { match: (d) => d === "Sukkot VII (Hoshana Raba)", type: "holiday_eve", note: "הושענא רבה (ערב שמיני עצרת)" },
  { match: (d) => d === "Shmini Atzeret", type: "holiday", note: "שמיני עצרת / שמחת תורה" },
  { match: (d) => d === "Erev Pesach", type: "holiday_eve", note: "ערב פסח" },
  { match: (d) => d === "Pesach I", type: "holiday", note: "פסח" },
  { match: (d) => d === "Pesach VI (CH''M)", type: "holiday_eve", note: "ערב שביעי של פסח" },
  { match: (d) => d === "Pesach VII", type: "holiday", note: "שביעי של פסח" },
  { match: (d) => d === "Erev Shavuot", type: "holiday_eve", note: "ערב שבועות" },
  { match: (d) => d === "Shavuot", type: "holiday", note: "שבועות" },
  { match: (d) => d === "Yom HaShoah", type: "memorial", note: "יום השואה" },
  { match: (d) => d === "Yom HaZikaron", type: "memorial", note: "יום הזיכרון" },
  { match: (d) => d === "Yom HaAtzma'ut", type: "holiday", note: "יום העצמאות" },
];

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Israeli holidays, eves and memorial days between two dates (inclusive). */
export function israeliHolidays(fromIso: string, toIso: string): CalendarDay[] {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const events = HebrewCalendar.calendar({
    start: new Date(fy, fm - 1, fd),
    end: new Date(ty, tm - 1, td),
    il: true,
    noMinorFast: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
  });
  const out = new Map<string, CalendarDay>();
  for (const e of events) {
    const rule = HOLIDAY_RULES.find((r) => r.match(e.getDesc()));
    if (!rule) continue;
    const day = isoOf(e.getDate().greg());
    const prev = out.get(day);
    // a holiday wins over an eve on the same day
    if (prev && prev.day_type === "holiday") continue;
    out.set(day, { day, day_type: rule.type, source: "hebcal", note: rule.note });
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Merge generated days into the existing calendar: manual entries are never
 * overwritten; generated ones are added or refreshed.
 */
export function mergeHolidays(existing: CalendarDay[], generated: CalendarDay[]) {
  const byDay = new Map(existing.map((d) => [d.day, d]));
  const toWrite: CalendarDay[] = [];
  let keptManual = 0;
  for (const g of generated) {
    const cur = byDay.get(g.day);
    if (cur?.source === "manual") {
      keptManual++;
      continue;
    }
    if (cur && cur.day_type === g.day_type && cur.note === g.note) continue;
    toWrite.push(g);
  }
  return { toWrite, keptManual };
}

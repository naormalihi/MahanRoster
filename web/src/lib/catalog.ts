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

/** General scoring settings; the multipliers themselves are ScoreMultiplier rows. */
export interface ScoringSettings {
  night_window: string; // "22:00-06:00" – who sleeps at home is not given duties in it
  weekend_weekdays: number[]; // ISO: 1 = Monday … 7 = Sunday – for weekend balancing
}

export const SCORING_KEYS = ["night_window", "weekend_weekdays"] as const;

export const ISO_DAY_LABEL: Record<number, string> = { 7: "ראשון", 1: "שני", 2: "שלישי", 3: "רביעי", 4: "חמישי", 5: "שישי", 6: "שבת" };
export const ISO_WEEK = [7, 1, 2, 3, 4, 5, 6];

const WINDOW_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function scoringProblems(s: ScoringSettings): string[] {
  const p: string[] = [];
  if (!WINDOW_RE.test(s.night_window)) p.push("חלון לילה בתבנית 22:00-06:00");
  if (!s.weekend_weekdays.length) p.push("בחר לפחות יום אחד של סוף שבוע");
  return p;
}

/**
 * A scoring multiplier. It applies to a day unit of a duty when all of its conditions hold;
 * when several apply, the highest one counts.
 */
export interface ScoreMultiplierInput {
  name: string;
  value: number;
  day_types: string[]; // calendar day types (any of)
  weekdays: number[]; // ISO (any of)
  time_window: string | null; // duty < 24h, most hours in the window
  date_from: string | null;
  date_to: string | null;
  skip_shabbat_types: boolean;
  is_active: boolean;
}
export interface ScoreMultiplier extends ScoreMultiplierInput {
  id: string;
}

export const EMPTY_MULTIPLIER: ScoreMultiplierInput = {
  name: "",
  value: 1.5,
  day_types: [],
  weekdays: [],
  time_window: null,
  date_from: null,
  date_to: null,
  skip_shabbat_types: false,
  is_active: true,
};

export function multiplierProblems(m: ScoreMultiplierInput, all: ScoreMultiplier[], id?: string): string[] {
  const p: string[] = [];
  const name = m.name.trim();
  if (!name) p.push("חסר שם");
  else if (all.some((x) => x.id !== id && x.name.trim() === name)) p.push("כבר יש מקדם בשם הזה");
  if (!(m.value >= 1) || m.value > 5) p.push("ערך המקדם – בין 1 ל-5");
  if (m.time_window !== null && !WINDOW_RE.test(m.time_window)) p.push("חלון שעות בתבנית 22:00-06:00");
  if (m.date_from && m.date_to && m.date_from > m.date_to) p.push("תאריך הסיום לפני תאריך ההתחלה");
  if (!m.day_types.length && !m.weekdays.length && !m.time_window && !m.date_from && !m.date_to)
    p.push("בחר לפחות תנאי אחד: סוג יום, ימים בשבוע, חלון שעות או תאריכים");
  return p;
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** "חג, ערב חג · שישי, שבת · 22:00–06:00 · 01/01/2027–31/01/2027" */
export function describeMultiplier(m: ScoreMultiplierInput, dayTypeName: (code: string) => string): string {
  const parts: string[] = [];
  if (m.day_types.length) parts.push(m.day_types.map(dayTypeName).join(", "));
  if (m.weekdays.length) parts.push(ISO_WEEK.filter((d) => m.weekdays.includes(d)).map((d) => ISO_DAY_LABEL[d]).join(", "));
  // ⁦…⁩ keeps times and dates left-to-right inside the Hebrew line
  if (m.time_window) parts.push(`שעות \u2066${m.time_window.replace("-", "–")}\u2069 (תורנות קצרה מ-24 ש׳)`);
  if (m.date_from || m.date_to) parts.push(`תאריכים \u2066${m.date_from ? dmy(m.date_from) : "…"}–${m.date_to ? dmy(m.date_to) : "…"}\u2069`);
  return parts.join(" · ") + (m.skip_shabbat_types ? " · לא על תורנויות שבת" : "");
}

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

/** The built-in calendar day types; more can be added in the settings. */
export type DayType = string;

export interface DayTypeRef {
  code: string;
  name: string;
}

/** Day types that are marked on the calendar (weekday/weekend are by the day of the week). */
export const MARKABLE = (t: DayTypeRef) => t.code !== "weekday" && t.code !== "weekend";

export const DAY_TYPE_LABEL: Record<string, string> = {
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

/** Duty catalog, scoring multipliers and the holiday calendar – what אחראי השיבוצים manages on the settings screen. */

import { HebrewCalendar } from "@hebcal/core";

export type ServiceRestriction = "any" | "mandatory" | "career";

/** What the base's poster says for a duty: when and where to come before it, and whom to call. */
export interface Briefing {
  /** briefing = תדריך, report = התייצבות, by_call = תדריך לפי הזימון (no fixed time) */
  kind: "briefing" | "report" | "by_call";
  /** same_day = on the day the duty starts, day_before, weekday = the last such weekday before the start */
  rule?: "same_day" | "day_before" | "weekday";
  /** 0 = Sunday … 6 */
  weekday?: number;
  time?: string; // HH:MM
  place?: string;
  contact_name?: string;
  contact_phone?: string;
  note?: string;
}

export const BRIEFING_KIND_LABEL: Record<Briefing["kind"], string> = { briefing: "תדריך", report: "התייצבות", by_call: "תדריך לפי הזימון" };
const DAY_NAME = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** "תדריך שלישי שלפני 13:00 · מסגרת אבטחה פיזית" */
export function briefingLabel(b: Briefing | null | undefined): string {
  if (!b) return "";
  if (b.kind === "by_call") return [BRIEFING_KIND_LABEL.by_call, b.place].filter(Boolean).join(" · ");
  const when = b.rule === "day_before" ? "יום לפני" : b.rule === "weekday" ? `${DAY_NAME[b.weekday ?? 0]} שלפני` : "ביום המשימה";
  return [`${BRIEFING_KIND_LABEL[b.kind]} ${when} ${b.time ?? ""}`.trim(), b.place].filter(Boolean).join(" · ");
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function briefingProblems(b: Briefing | null | undefined): string[] {
  if (!b) return [];
  const p: string[] = [];
  if (b.kind !== "by_call") {
    if (!b.time || !TIME_RE.test(b.time)) p.push("שעת התדריך / ההתייצבות בתבנית 13:00");
    if (b.rule === "weekday" && !(Number.isInteger(b.weekday) && b.weekday! >= 0 && b.weekday! <= 6)) p.push("בחר יום בשבוע לתדריך");
  }
  if ((b.place ?? "").length > 120) p.push("מיקום התדריך – עד 120 תווים");
  if ((b.contact_name ?? "").length > 80) p.push("שם איש הקשר – עד 80 תווים");
  if ((b.contact_phone ?? "").length > 30) p.push("טלפון איש הקשר – עד 30 תווים");
  if ((b.note ?? "").length > 300) p.push("ההערה לעובד – עד 300 תווים");
  return p;
}

/** Only the fields the kind and rule use, trimmed; empty texts dropped. */
export function cleanBriefing(b: Briefing | null | undefined): Briefing | null {
  if (!b) return null;
  const out: Briefing = { kind: b.kind };
  if (b.kind !== "by_call") {
    out.rule = b.rule ?? "same_day";
    out.time = b.time;
    if (out.rule === "weekday") out.weekday = b.weekday ?? 2;
  }
  for (const k of ["place", "contact_name", "contact_phone", "note"] as const) {
    const v = (b[k] ?? "").trim();
    if (v) out[k] = v;
  }
  return out;
}

export interface TaskType {
  id: string;
  /** internal id for imports and the engine; generated, not shown */
  code: string;
  name: string;
  category_id: string | null;
  weight: number;
  min_rest_hours: number;
  service_restriction: ServiceRestriction;
  requires_weapon: boolean;
  is_weekend_type: boolean;
  /** the weight already covers holidays (a week-long task): no holiday multiplier */
  includes_holidays: boolean;
  /** hidden type that carries a special call-up (הקפצה מיוחדת); not in the catalog */
  is_special?: boolean;
  shachar_compatible: boolean;
  /** only mandatory-service שח"ר soldiers may do it (implies shachar_compatible) */
  shachar_only: boolean;
  /** auto = by night hours; home = fit for הת"ש (never a night on base); closed = not for הת"ש */
  tash_rule: "auto" | "home" | "closed";
  qualifying_duty: boolean;
  /** ranks that may do it (any of them); null = every rank */
  allowed_rank_ids: string[] | null;
  gender: "male" | "female" | null;
  default_start_time: string | null; // HH:MM
  default_end_time: string | null;
  /** hours by start weekday ("0" = Sunday … "6", "after_holiday"), "HH:MM-HH:MM"; overrides the defaults */
  weekday_hours: Record<string, string> | null;
  color: string | null;
  /** תדריך / התייצבות before the duty, from the base's poster; null = none */
  briefing?: Briefing | null;
  is_active: boolean;
}

export type TaskTypeInput = Omit<TaskType, "id">;

export interface Population {
  code: string;
  name: string;
}

/** A new duty type's internal code. */
export const newTaskCode = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** "סג״מ, סגן, סרן" – or "רס״ל … סרן (6)" when long; ranks in their order. */
export function rankListLabel(ids: string[] | null, ranks: { id: string; name: string }[]): string {
  if (!ids) return "";
  const names = ranks.filter((r) => ids.includes(r.id)).map((r) => r.name);
  return names.length > 4 ? `${names[0]} … ${names[names.length - 1]} (${names.length})` : names.join(", ");
}

export const SERVICE_LABEL: Record<ServiceRestriction, string> = { any: "כולם", mandatory: "חובה", career: "קבע" };

export function taskTypeProblems(t: TaskTypeInput, others: Pick<TaskType, "id" | "code" | "name">[], selfId?: string): string[] {
  const p: string[] = [];
  const rest = others.filter((o) => o.id !== selfId);
  if (!t.name.trim()) p.push("חסר שם");
  else if (rest.some((o) => o.name.trim() === t.name.trim())) p.push("כבר יש משימה בשם הזה");
  if (t.allowed_rank_ids && !t.allowed_rank_ids.length) p.push("בחר לפחות דרגה אחת, או \"כל הדרגות\"");
  if (!(t.weight > 0) || t.weight > 99) p.push("משקל חייב להיות גדול מ-0 (עד 99)");
  if (!Number.isInteger(t.min_rest_hours) || t.min_rest_hours < 0) p.push("שעות מנוחה – מספר שלם, 0 ומעלה");
  if (!!t.default_start_time !== !!t.default_end_time) p.push("שעת התחלה וסיום – שתיהן או אף אחת");
  if (t.weekday_hours && Object.values(t.weekday_hours).some((w) => !/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d(\+1)?$/.test(w)))
    p.push("שעות לפי יום בתבנית 08:00-17:00 (או 06:00-08:00+1 לסיום למחרת)");
  p.push(...briefingProblems(t.briefing));
  return p;
}

// ---------------------------------------------------------------------------
// Scoring settings
// ---------------------------------------------------------------------------

/** General scoring settings; the multipliers themselves are ScoreMultiplier rows. */
export interface ScoringSettings {
  night_window: string; // "22:00-06:00" – who sleeps at home is not given duties in it
  weekend_weekdays: number[]; // ISO: 1 = Monday … 7 = Sunday – for weekend balancing
  surprise_multiplier: number; // a soldier put on a duty at short notice (הקפצה)
  surprise_notice_hours: number; // "short notice": less than this many hours before the duty starts
  exemption_deadline_days: number; // a new cycle's constraints close this many days before it starts
  fairness_tolerance_pct: number; // the load screen flags a soldier further than this % from his peers' mean
  grace_days: number; // a new soldier's training period: no duties for this many days from his first cycle
  briefing_reminder_hours: number; // the reminder of a briefing goes this many hours before it
  ack_reminder_hours: number; // "עוד לא אישרת" this many hours before the duty (0 = off)
  ack_escalation_hours: number; // the gaf commander hears this many hours before (0 = off)
  range_validity_months: number; // מטווח: valid this many months after the last range
  range_warning_days: number; // "עומד לפוג" this many days before the validity ends
  range_notice_days: number; // a planned range is for those whose validity ends before it + this many days
}

export const SCORING_KEYS = ["night_window", "weekend_weekdays", "surprise_multiplier", "surprise_notice_hours", "exemption_deadline_days", "fairness_tolerance_pct", "grace_days", "briefing_reminder_hours", "ack_reminder_hours", "ack_escalation_hours", "range_validity_months", "range_warning_days", "range_notice_days"] as const;

export const ISO_DAY_LABEL: Record<number, string> = { 7: "ראשון", 1: "שני", 2: "שלישי", 3: "רביעי", 4: "חמישי", 5: "שישי", 6: "שבת" };
export const ISO_WEEK = [7, 1, 2, 3, 4, 5, 6];

const WINDOW_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function scoringProblems(s: ScoringSettings): string[] {
  const p: string[] = [];
  if (!WINDOW_RE.test(s.night_window)) p.push("חלון לילה בתבנית 22:00-06:00");
  if (!s.weekend_weekdays.length) p.push("בחר לפחות יום אחד של סוף שבוע");
  if (!(s.surprise_multiplier >= 1) || s.surprise_multiplier > 10) p.push("מקדם הקפצה – בין 1 ל-10");
  if (!Number.isInteger(s.surprise_notice_hours) || s.surprise_notice_hours < 1 || s.surprise_notice_hours > 336)
    p.push("סף הקפצה – בין 1 ל-336 שעות");
  if (!(s.fairness_tolerance_pct >= 1) || s.fairness_tolerance_pct > 100) p.push("טווח הוגנות – בין 1% ל-100%");
  for (const [k, label] of [["ack_reminder_hours", "תזכורת לאישור"], ["ack_escalation_hours", "עדכון למפקד המסגרת"]] as const)
    if (!Number.isInteger(s[k]) || s[k] < 0 || s[k] > 168) p.push(`${label} – בין 0 ל-168 שעות`);
  if (!Number.isInteger(s.briefing_reminder_hours) || s.briefing_reminder_hours < 2 || s.briefing_reminder_hours > 72)
    p.push("תזכורת תדריך – בין 2 ל-72 שעות לפני");
  if (!Number.isInteger(s.grace_days) || s.grace_days < 0 || s.grace_days > 365) p.push("תקופת הכשרה – בין 0 ל-365 ימים");
  if (!Number.isInteger(s.exemption_deadline_days) || s.exemption_deadline_days < 1 || s.exemption_deadline_days > 180)
    p.push("סגירת אילוצים – בין 1 ל-180 יום לפני המחזור");
  if (!Number.isInteger(s.range_validity_months) || s.range_validity_months < 1 || s.range_validity_months > 36)
    p.push("תוקף מטווח – בין 1 ל-36 חודשים");
  if (!Number.isInteger(s.range_warning_days) || s.range_warning_days < 1 || s.range_warning_days > 90)
    p.push("תזכורת לפני שהמטווח פג – בין 1 ל-90 ימים");
  if (!Number.isInteger(s.range_notice_days) || s.range_notice_days < 0 || s.range_notice_days > 180)
    p.push("מי מוזמן למטווח – בין 0 ל-180 ימים אחריו");
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
  holidays: HolidayKey[]; // which holidays (any of); empty = any holiday when a kind is chosen
  holiday_kinds: HolidayKind[]; // which day of the holiday (any of); empty = every day of it
  weekdays: number[]; // ISO (any of)
  time_window: string | null; // duty < 24h, most hours in the window
  date_from: string | null;
  date_to: string | null;
  skip_shabbat_types: boolean;
  is_active: boolean;
  /** a cell of the "multiplier per holiday day" table (one holiday, one day of it) */
  holiday_cell?: boolean;
}
export interface ScoreMultiplier extends ScoreMultiplierInput {
  id: string;
}

export const EMPTY_MULTIPLIER: ScoreMultiplierInput = {
  name: "",
  value: 1.5,
  day_types: [],
  holidays: [],
  holiday_kinds: [],
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
  if (!(m.value >= 1) || m.value > 10) p.push("ערך המקדם – בין 1 ל-10");
  if (m.time_window !== null && !WINDOW_RE.test(m.time_window)) p.push("חלון שעות בתבנית 22:00-06:00");
  if (m.date_from && m.date_to && m.date_from > m.date_to) p.push("תאריך הסיום לפני תאריך ההתחלה");
  if (!m.day_types.length && !m.holidays.length && !m.holiday_kinds.length && !m.weekdays.length && !m.time_window && !m.date_from && !m.date_to)
    p.push("בחר לפחות תנאי אחד: חגים, סוג יום, ימים בשבוע, חלון שעות או תאריכים");
  return p;
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** "חג, ערב חג · שישי, שבת · 22:00–06:00 · 01/01/2027–31/01/2027" */
export function describeMultiplier(m: ScoreMultiplierInput, dayTypeName: (code: string) => string): string {
  const parts: string[] = [];
  if (m.holidays.length || m.holiday_kinds.length) parts.push(holidayPhrase(m.holidays, m.holiday_kinds));
  if (m.day_types.length) parts.push(m.day_types.map(dayTypeName).join(", "));
  if (m.weekdays.length) parts.push(ISO_WEEK.filter((d) => m.weekdays.includes(d)).map((d) => ISO_DAY_LABEL[d]).join(", "));
  // ⁦…⁩ keeps times and dates left-to-right inside the Hebrew line
  if (m.time_window) parts.push(`שעות \u2066${m.time_window.replace("-", "–")}\u2069 (משימה קצרה מ-24 ש׳)`);
  if (m.date_from || m.date_to) parts.push(`תאריכים \u2066${m.date_from ? dmy(m.date_from) : "…"}–${m.date_to ? dmy(m.date_to) : "…"}\u2069`);
  return parts.join(" · ") + (m.skip_shabbat_types ? " · לא על משימות שבת" : "");
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

/** Day types that are holidays (weekend balancing, the holiday calendar of the base file). */
export const HOLIDAY_TYPES = new Set(["holiday", "holiday_eve", "major_holiday", "major_holiday_eve"]);

/** Day types that are marked on the calendar (weekday/weekend are by the day of the week). */
export const MARKABLE = (t: DayTypeRef) => t.code !== "weekday" && t.code !== "weekend";

export const DAY_TYPE_LABEL: Record<string, string> = {
  holiday: "חג",
  holiday_eve: "ערב חג",
  major_holiday: "חג מרכזי",
  major_holiday_eve: "ערב חג מרכזי",
  chol_hamoed: "חול המועד",
  observance: "מועד (לא שבתון)",
  memorial: "יום זיכרון",
  weekend: "סופ\"ש",
  weekday: "חול",
};

export interface CalendarDay {
  day: string; // YYYY-MM-DD
  day_type: DayType;
  source: "hebcal" | "manual";
  note: string | null;
  /** which holiday the day belongs to, and which day of it */
  holiday?: HolidayKey | null;
  holiday_kind?: HolidayKind | null;
}

// ---------------------------------------------------------------------------
// Holidays by name
// ---------------------------------------------------------------------------

export type HolidayKey =
  | "rosh_hashana"
  | "yom_kippur"
  | "sukkot"
  | "pesach"
  | "shavuot"
  | "independence"
  // observances that are not rest days (מועדים שאינם שבתון)
  | "hanukkah"
  | "purim"
  | "fast"
  | "minor";
export type HolidayKind = "eve" | "day" | "chol_hamoed";

/** The holidays a multiplier can name; סוכות includes שמיני עצרת, פסח includes שביעי של פסח. */
export const HOLIDAYS: { key: HolidayKey; name: string; kinds: HolidayKind[]; observance?: boolean }[] = [
  { key: "rosh_hashana", name: "ראש השנה", kinds: ["eve", "day"] },
  { key: "yom_kippur", name: "יום כיפור", kinds: ["eve", "day"] },
  { key: "sukkot", name: "סוכות", kinds: ["eve", "day", "chol_hamoed"] },
  { key: "pesach", name: "פסח", kinds: ["eve", "day", "chol_hamoed"] },
  { key: "shavuot", name: "שבועות", kinds: ["eve", "day"] },
  { key: "independence", name: "יום העצמאות", kinds: ["day"] },
  { key: "hanukkah", name: "חנוכה", kinds: ["eve", "day"], observance: true },
  { key: "purim", name: "פורים", kinds: ["eve", "day"], observance: true },
  { key: "fast", name: "צומות", kinds: ["eve", "day"], observance: true },
  { key: "minor", name: "מועדים נוספים", kinds: ["day"], observance: true },
];
/** With no holiday chosen, a multiplier means the rest-day holidays – not the observances. */
export const REST_HOLIDAYS = HOLIDAYS.filter((h) => !h.observance).map((h) => h.key);
export const HOLIDAY_NAME = Object.fromEntries(HOLIDAYS.map((h) => [h.key, h.name])) as Record<HolidayKey, string>;
export const HOLIDAY_KINDS: { key: HolidayKind; name: string }[] = [
  { key: "eve", name: "ערב חג" },
  { key: "day", name: "החג" },
  { key: "chol_hamoed", name: "חול המועד" },
];
export const HOLIDAY_KIND_NAME = Object.fromEntries(HOLIDAY_KINDS.map((k) => [k.key, k.name])) as Record<HolidayKind, string>;

/** "ערב חג · ראש השנה, סוכות" / "חול המועד · כל החגים" */
export function holidayPhrase(holidays: HolidayKey[], kinds: HolidayKind[]): string {
  const k = kinds.length ? HOLIDAY_KINDS.filter((x) => kinds.includes(x.key)).map((x) => x.name).join(", ") : "כל ימי החג";
  const h = holidays.length ? HOLIDAYS.filter((x) => holidays.includes(x.key)).map((x) => x.name).join(", ") : "כל החגים (שבתון)";
  return `${k} · ${h}`;
}

/** Does a multiplier's calendar part (day types, holidays, day of the holiday) hold on this day? */
export function calendarMatch(m: Pick<ScoreMultiplierInput, "day_types" | "holidays" | "holiday_kinds">, d: CalendarDay | undefined): boolean {
  if (m.day_types.length && !(d && m.day_types.includes(d.day_type))) return false;
  if (m.holidays.length || m.holiday_kinds.length) {
    if (!d?.holiday || !d.holiday_kind) return false;
    if (!(m.holidays.length ? m.holidays : REST_HOLIDAYS).includes(d.holiday)) return false;
    if (m.holiday_kinds.length && !m.holiday_kinds.includes(d.holiday_kind)) return false;
  }
  return true;
}

/** A multiplier's value is added to the duty's weight (the highest that applies, once): "+3". */
export const multiplierValueLabel = (m: Pick<ScoreMultiplierInput, "value">) => `+${m.value}`;

/** A multiplier that depends on the calendar only (no weekdays, hours or dates). */
export const calendarOnly = (m: ScoreMultiplierInput) =>
  (m.day_types.length > 0 || m.holidays.length > 0 || m.holiday_kinds.length > 0) && !m.weekdays.length && !m.time_window && !m.date_from && !m.date_to;

/**
 * Days that count in Israel. Holidays and their eves get the holiday multiplier; ראש השנה,
 * יום כיפור and פסח (with their eves), and ערב סוכות, are "major" with a multiplier of their own;
 * memorial days are marked for information only. חול המועד is marked, not as a holiday.
 */
const HOLIDAY_RULES: { match: (desc: string) => boolean; type: DayType; note: string; h?: [HolidayKey, HolidayKind] }[] = [
  { match: (d) => d === "Erev Rosh Hashana", type: "major_holiday_eve", note: "ערב ראש השנה", h: ["rosh_hashana", "eve"] },
  { match: (d) => /^Rosh Hashana \d+$/.test(d), type: "major_holiday", note: "ראש השנה א׳", h: ["rosh_hashana", "day"] },
  { match: (d) => d === "Rosh Hashana II", type: "major_holiday", note: "ראש השנה ב׳", h: ["rosh_hashana", "day"] },
  { match: (d) => d === "Erev Yom Kippur", type: "major_holiday_eve", note: "ערב יום כיפור", h: ["yom_kippur", "eve"] },
  { match: (d) => d === "Yom Kippur", type: "major_holiday", note: "יום כיפור", h: ["yom_kippur", "day"] },
  { match: (d) => d === "Erev Sukkot", type: "major_holiday_eve", note: "ערב סוכות", h: ["sukkot", "eve"] },
  { match: (d) => d === "Sukkot I", type: "holiday", note: "סוכות", h: ["sukkot", "day"] },
  { match: (d) => d === "Sukkot VII (Hoshana Raba)", type: "holiday_eve", note: "הושענא רבה (ערב שמיני עצרת)", h: ["sukkot", "eve"] },
  { match: (d) => /^Sukkot (II|III|IV|V|VI) \(CH''M\)$/.test(d), type: "chol_hamoed", note: "חול המועד סוכות", h: ["sukkot", "chol_hamoed"] },
  { match: (d) => d === "Shmini Atzeret", type: "holiday", note: "שמיני עצרת / שמחת תורה", h: ["sukkot", "day"] },
  { match: (d) => d === "Erev Pesach", type: "major_holiday_eve", note: "ערב פסח", h: ["pesach", "eve"] },
  { match: (d) => d === "Pesach I", type: "major_holiday", note: "פסח", h: ["pesach", "day"] },
  { match: (d) => /^Pesach (II|III|IV|V) \(CH''M\)$/.test(d), type: "chol_hamoed", note: "חול המועד פסח", h: ["pesach", "chol_hamoed"] },
  { match: (d) => d === "Pesach VI (CH''M)", type: "major_holiday_eve", note: "ערב שביעי של פסח", h: ["pesach", "eve"] },
  { match: (d) => d === "Pesach VII", type: "major_holiday", note: "שביעי של פסח", h: ["pesach", "day"] },
  { match: (d) => d === "Erev Shavuot", type: "holiday_eve", note: "ערב שבועות", h: ["shavuot", "eve"] },
  { match: (d) => d === "Shavuot", type: "holiday", note: "שבועות", h: ["shavuot", "day"] },
  { match: (d) => d === "Yom HaShoah", type: "memorial", note: "יום השואה" },
  { match: (d) => d === "Yom HaZikaron", type: "memorial", note: "יום הזיכרון" },
  // observances that are not rest days
  { match: (d) => d === "Tzom Gedaliah", type: "observance", note: "צום גדליה", h: ["fast", "day"] },
  { match: (d) => d === "Asara B'Tevet", type: "observance", note: "עשרה בטבת", h: ["fast", "day"] },
  { match: (d) => d === "Ta'anit Esther", type: "observance", note: "תענית אסתר", h: ["fast", "day"] },
  { match: (d) => d === "Tzom Tammuz", type: "observance", note: "צום י״ז בתמוז", h: ["fast", "day"] },
  { match: (d) => d === "Erev Tish'a B'Av", type: "observance", note: "ערב תשעה באב", h: ["fast", "eve"] },
  { match: (d) => d === "Tish'a B'Av", type: "observance", note: "תשעה באב", h: ["fast", "day"] },
  { match: (d) => d === "Chanukah: 1 Candle", type: "observance", note: "ערב חנוכה (נר ראשון)", h: ["hanukkah", "eve"] },
  { match: (d) => /^Chanukah: (\d Candles|8th Day)$/.test(d), type: "observance", note: "חנוכה", h: ["hanukkah", "day"] },
  { match: (d) => d === "Erev Purim", type: "observance", note: "ערב פורים", h: ["purim", "eve"] },
  { match: (d) => d === "Purim", type: "observance", note: "פורים", h: ["purim", "day"] },
  { match: (d) => d === "Shushan Purim", type: "observance", note: "שושן פורים", h: ["purim", "day"] },
  { match: (d) => d === "Tu BiShvat", type: "observance", note: "ט״ו בשבט", h: ["minor", "day"] },
  { match: (d) => d === "Lag BaOmer", type: "observance", note: "ל״ג בעומר", h: ["minor", "day"] },
  { match: (d) => d === "Yom Yerushalayim", type: "observance", note: "יום ירושלים", h: ["minor", "day"] },
  { match: (d) => d === "Tu B'Av", type: "observance", note: "ט״ו באב", h: ["minor", "day"] },
  { match: (d) => d === "Yom HaAtzma'ut", type: "holiday", note: "יום העצמאות", h: ["independence", "day"] },
];

const DAY_RANK = (t: DayType) =>
  ({ major_holiday: 0, holiday: 0, major_holiday_eve: 1, holiday_eve: 1, chol_hamoed: 2, memorial: 3, observance: 4 })[t] ?? 5;

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
    noMinorFast: false,
    noRoshChodesh: true,
    noSpecialShabbat: true,
  });
  const out = new Map<string, CalendarDay>();
  for (const e of events) {
    const rule = HOLIDAY_RULES.find((r) => r.match(e.getDesc()));
    if (!rule) continue;
    const day = isoOf(e.getDate().greg());
    const prev = out.get(day);
    // one row a day: a rest day wins over an eve, an eve over חול המועד, a memorial day or an
    // observance; between observances the first (a fast before ערב פורים on the same day)
    if (prev && DAY_RANK(prev.day_type) <= DAY_RANK(rule.type)) continue;
    out.set(day, { day, day_type: rule.type, source: "hebcal", note: rule.note, holiday: rule.h?.[0] ?? null, holiday_kind: rule.h?.[1] ?? null });
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
    if (cur && cur.day_type === g.day_type && cur.note === g.note && (cur.holiday ?? null) === (g.holiday ?? null) && (cur.holiday_kind ?? null) === (g.holiday_kind ?? null)) continue;
    toWrite.push(g);
  }
  return { toWrite, keptManual };
}

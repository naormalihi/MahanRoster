/** "הפרטים שלי": what the system knows about the employee and uses to schedule them. */

export interface FixRequest {
  id: string;
  field: string;
  requested: string;
  status: "open" | "fixed" | "dismissed";
  reply: string | null;
  created_at: string;
  handled_at: string | null;
}

/** staff's view of a request */
export interface StaffFixRequest extends FixRequest {
  soldier_id: string;
  current: string | null;
}

export interface MyProfile {
  full_name: string;
  gaf: string | null;
  rank: string | null;
  appointed: boolean;
  phone: string | null;
  service: "mandatory" | "career";
  career_start_date: string | null;
  enlistment_date: string | null;
  release_date: string | null;
  unit_join_date: string | null;
  grace_until: string | null;
  tash_level: number;
  home_nightly: boolean;
  parent: boolean;
  shachar: boolean;
  second_role_signed_at: string | null;
  relief: { name: string; factor: number; until: string | null } | null;
  range_valid_until: string | null;
  away: { kind: "exemption" | "absence"; name: string | null; from: string; to: string; status: string; partial: boolean }[];
  fixes: FixRequest[];
  cycle?: { id: string; name: string; start_date: string; end_date: string; published: boolean };
  tasks?: { name: string; ok: boolean; reason: string | null }[];
  score?: {
    earlier: number;
    group: string;
    group_size: number;
    group_avg: number | null;
    switch: { at: string; to: string; score: number } | null;
    opening: number | null;
    corrections: { points: number; note: string | null; at: string; by: string | null }[];
    cycle_points: number | null;
    cycle_duties: number | null;
  };
}

export const dmy = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/** ת"ש in words */
export function tashText(level: number, homeNightly: boolean): { value: string; means: string } {
  if (homeNightly || level >= 7) return { value: "ת״ש 7", means: "לא משובץ למשימות עם שעות לילה" };
  if (!level) return { value: "אין", means: "בלי הגבלת לילות" };
  return { value: `סוג ${level}`, means: `עד ${7 - level} לילות בשבוע בבסיס` };
}

/** the score's parts, for the breakdown (the earlier score = switch/opening + corrections + duties before) */
export function scoreTotal(s: NonNullable<MyProfile["score"]>): number {
  return Number(s.earlier) + Number(s.cycle_points ?? 0);
}

/** the request fields the employee picks from */
export const FIX_FIELDS = [
  "שם",
  "מסגרת",
  "דרגה",
  "טלפון",
  "סוג שירות · כניסה לקבע",
  "גיוס · תום שירות",
  "תאריך קליטה",
  "ת״ש",
  "הורה",
  "הקלה בעומס",
  "תפקיד שני",
  "המשימות שלי",
  "הניקוד",
  "אחר",
] as const;

/** Where the score stands against the group's average, in words (2.73). */
export function scoreWords(total: number, avg: number | null): string | null {
  if (avg == null) return null;
  const d = total - avg;
  const near = Math.max(Math.abs(avg) * 0.02, 0.05);
  if (Math.abs(d) < near) return "בדיוק בממוצע – המנוע ישבץ אותך כמו את כולם.";
  const slight = Math.abs(d) <= Math.max(Math.abs(avg) * 0.1, 1);
  return d > 0
    ? `${slight ? "מעט " : ""}מעל הממוצע – המנוע ישבץ אותך ${slight ? "קצת " : ""}פחות בהמשך.`
    : `${slight ? "מעט " : ""}מתחת לממוצע – סביר שתשובץ ${slight ? "קצת " : ""}יותר בהמשך.`;
}

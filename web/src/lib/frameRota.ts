/** "תורנויות מסגרת": a monthly duty that passes between the frames (not a task – no scheduling). */

export interface FrameRotaMonth {
  month: string; // YYYY-MM-01
  gaf_id: string | null;
  gaf_name: string | null;
  commander: string | null;
  overridden: boolean;
}

export interface FrameRotaDay {
  planned: string; // YYYY-MM-DD
  actual: string; // the next working day when the planned one is a holiday / eve
  why: string | null;
}

export interface FrameRota {
  id: string;
  name: string;
  weekday: number; // 0 = ראשון
  at_time: string; // HH:MM
  place: string | null;
  details: string | null;
  is_active: boolean;
  gaf_order: string[];
  start_month: string; // YYYY-MM-01
  /** this month and the 11 after it */
  months: FrameRotaMonth[];
}

export type FrameRotaInput = Omit<FrameRota, "id" | "months"> & { id?: string };

export interface FrameRotasAdmin {
  gafs: { id: string; name: string }[];
  rotas: FrameRota[];
}

export type MyFrameRotaMonth = FrameRotaMonth & { mine: boolean; days: FrameRotaDay[] };

export interface MyFrameRota {
  id: string;
  name: string;
  weekday: number;
  at_time: string;
  place: string | null;
  /** only to the frame on duty (this month or next) */
  details: string | null;
  current: MyFrameRotaMonth;
  next: MyFrameRotaMonth;
}

export interface FrameRotaStatus {
  id: string;
  name: string;
  current: FrameRotaMonth;
  next: FrameRotaMonth;
}

export const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const MONTH_NAMES = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
export function addMonths(month: string, k: number): string {
  const d = utc(monthStart(month));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1)));
}
export const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];
export const monthLabel = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
export const weekdayOf = (day: string) => WEEKDAYS[utc(day).getUTCDay()];
/** 4.10 */
export const dm = (day: string) => `${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}`;

/** the frame on duty in a month: an override, else the order (repeating, also before the start) – as the server */
export function rotaGaf(order: string[], startMonth: string, month: string, overrides: Record<string, string> = {}): string | null {
  const m = monthStart(month);
  if (overrides[m]) return overrides[m];
  if (!order.length) return null;
  const idx = (y: string) => Number(y.slice(0, 4)) * 12 + Number(y.slice(5, 7));
  const n = order.length;
  return order[(((idx(m) - idx(startMonth)) % n) + n) % n];
}

/**
 * The duty's days in a month: each `weekday`; a day that is not a working day (Friday, Saturday,
 * a holiday or holiday eve) moves to the next working one – as the server.
 * `off(day)` answers the holiday's name for a holiday / eve, "" for a weekend, null for a working day.
 */
export function rotaDays(weekday: number, month: string, off: (day: string) => string | null): FrameRotaDay[] {
  const m = utc(monthStart(month));
  const out: FrameRotaDay[] = [];
  const d = new Date(m);
  d.setUTCDate(1 + ((weekday - m.getUTCDay() + 7) % 7));
  while (d.getUTCMonth() === m.getUTCMonth()) {
    const planned = iso(d);
    const a = new Date(d);
    const why: string[] = [];
    for (let i = 0; i < 21; i++) {
      const w = off(iso(a));
      if (w === null) break;
      if (w) why.push(w);
      a.setUTCDate(a.getUTCDate() + 1);
    }
    out.push({ planned, actual: iso(a), why: why.length ? why.join(", ") : null });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** the frame card shows until its last day has passed */
export const rotaMonthOver = (days: FrameRotaDay[], today: string) => days.every((d) => d.actual < today);

/** the next day of the duty, from today on */
export const nextRotaDay = (days: FrameRotaDay[], today: string) => days.find((d) => d.actual >= today) ?? null;

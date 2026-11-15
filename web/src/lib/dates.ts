export const TZ = "Asia/Jerusalem";

const dayFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long", day: "numeric", month: "numeric" });
const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const shortFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" });

/** yyyy-mm-dd of an instant, in the unit's time zone. */
export const dayKey = (iso: string | Date) => keyFmt.format(typeof iso === "string" ? new Date(iso) : iso);
export const dayLabel = (iso: string | Date) => dayFmt.format(typeof iso === "string" ? new Date(iso) : iso);
export const timeLabel = (iso: string) => timeFmt.format(new Date(iso));
/** "יום ה׳, 1.7" – short day with date. */
export const shortDayLabel = (iso: string | Date) => shortFmt.format(typeof iso === "string" ? new Date(iso) : iso);

/** "08:00 – 16:00", "08:00 – 08:00 למחרת", "08:00 – 08:00, יום א׳ 7.1" */
export function spanLabel(startIso: string, endIso: string) {
  const days = Math.round((Date.parse(dayKey(endIso)) - Date.parse(dayKey(startIso))) / 86_400_000);
  const tail = days === 0 ? "" : days === 1 ? " למחרת" : `, ${shortFmt.format(new Date(endIso))}`;
  return `${timeLabel(startIso)} – ${timeLabel(endIso)}${tail}`;
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Thursday evening to Saturday night of the coming weekend (or the current one, if inside it). */
export function upcomingWeekend(now = new Date()): [Date, Date] {
  const d = startOfDay(now);
  const dow = d.getDay(); // Sun=0 … Sat=6
  const thursday = addDays(d, dow === 6 ? -2 : dow === 5 ? -1 : 4 - dow);
  const from = new Date(thursday);
  from.setHours(17, 0, 0, 0);
  const to = addDays(thursday, 3); // Sunday 00:00
  return [from, to];
}

export function weekOf(now = new Date()): [Date, Date] {
  const sunday = addDays(startOfDay(now), -startOfDay(now).getDay());
  return [sunday, addDays(sunday, 7)];
}

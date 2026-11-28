import { addDays, dayKey } from "./dates";

export interface WeekDay {
  /** yyyy-mm-dd, Israel time */
  key: string;
  duties: number;
  /** duties with no performer */
  unstaffed: number;
}

/**
 * The coming seven days, today first, each with its published duties and how many lack a performer –
 * the rows of "השבוע הקרוב" (2.75). A duty counts on the day it starts; one past the seventh day is left out.
 */
export function weekDays(rows: { starts_at: string; performers: string[] }[], now: Date): WeekDay[] {
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({ key: dayKey(addDays(now, i)), duties: 0, unstaffed: 0 }));
  const at = new Map(days.map((d) => [d.key, d]));
  for (const r of rows) {
    const d = at.get(dayKey(r.starts_at));
    if (!d) continue;
    d.duties++;
    if (!r.performers.length) d.unstaffed++;
  }
  return days;
}

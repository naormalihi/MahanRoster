/**
 * The WhatsApp message about duties, for a soldier without an account (or one who has not
 * pressed "ראיתי"). אחראי השיבוצים presses once, the server returns the duties (and a fresh join code
 * when he has no account), and this builds the text. Lines without data are left out.
 */
import { dayKey, shortDayLabel, timeLabel } from "./dates";
import { joinLink } from "./invites";

export interface MessageDuty {
  assignment_id: string;
  task_name: string;
  role: "performer" | "reserve";
  starts_at: string;
  ends_at: string;
  /** "התייצבות יום ב׳ 24.11 07:30, שער ראשי. איש קשר: …" or null */
  brief: string | null;
}

export interface DutyMessage {
  soldier_id: string;
  full_name: string;
  phone: string | null;
  has_account: boolean;
  /** a fresh join code (XXXXX-XXXXX), only for a soldier without an account */
  code: string | null;
  duties: MessageDuty[];
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

const day = (iso: string) => shortDayLabel(iso).replace(",", "");

/** "מטבח – יום ב׳ 24.11, 08:00–20:00 (מבצע)"; overnight "… 20:00–08:00 למחרת"; longer "… 12:00 עד יום א׳ 22.11 08:00" */
export function dutyLine(d: MessageDuty): string {
  const days = Math.round((Date.parse(dayKey(d.ends_at)) - Date.parse(dayKey(d.starts_at))) / 86_400_000);
  const span =
    days === 0
      ? `${timeLabel(d.starts_at)}–${timeLabel(d.ends_at)}`
      : days === 1
        ? `${timeLabel(d.starts_at)}–${timeLabel(d.ends_at)} למחרת`
        : `${timeLabel(d.starts_at)} עד ${day(d.ends_at)} ${timeLabel(d.ends_at)}`;
  return `${d.task_name} – ${day(d.starts_at)}, ${span} (${d.role === "reserve" ? "עתודה" : "מבצע"})`;
}

export function dutyMessageText(m: DutyMessage, origin: string): string {
  const many = m.duties.length > 1;
  const lines: string[] = [`היי ${firstName(m.full_name)}, ${many ? "שובצת לתורנויות:" : "שובצת לתורנות:"}`];
  for (const d of m.duties) {
    if (many) lines.push("");
    lines.push(dutyLine(d));
    if (d.brief) lines.push(d.brief);
  }
  lines.push("");
  if (m.code) lines.push(`אפשר לראות את התורנויות שלך ולקבל תזכורות בתורנצ׳יק (הקוד שלך כבר ממולא): ${joinLink(origin, m.code)}`);
  else if (m.has_account) lines.push(`אפשר לאשר גם בלחיצה על "ראיתי" בתורנצ׳יק: ${origin}`);
  lines.push(`נא לאשר שקיבלת – תענה "קיבלתי".`);
  return lines.join("\n");
}

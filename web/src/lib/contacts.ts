/** "למי לפנות": the contacts נע"ת chose to show soldiers. */
import { normalizePhone } from "./phone";

export interface MyContact {
  display_name: string;
  role_label: string;
  /** 9725XXXXXXXX, or null when none was given */
  phone: string | null;
  kind: "staff" | "gaf";
}

/** one row of the settings list */
export interface ContactEntry {
  user_id: string;
  display_name: string;
  /** written for the contact list; when empty, the one on his soldier card is used */
  phone: string | null;
  card_phone?: string | null;
  role?: string | null;
}

export const ROLE_LABEL: Record<string, string> = { coordinator: 'נע"ת', deputy: 'מ"מ', gaf_commander: "מפקד מסגרת" };

/** What is wrong with the list before saving (empty = fine). */
export function contactProblems(list: ContactEntry[]): string[] {
  const out: string[] = [];
  list.forEach((c, i) => {
    if (!c.display_name.trim()) out.push(`שורה ${i + 1}: חסר שם`);
    if (normalizePhone(c.phone) === "invalid") out.push(`${c.display_name || `שורה ${i + 1}`}: מספר טלפון לא תקין`);
  });
  return out;
}

/** the list as the server wants it: the phone as 9725XXXXXXXX or null */
export const toSave = (list: ContactEntry[]) =>
  list.map((c) => {
    const p = normalizePhone(c.phone);
    return { user_id: c.user_id, display_name: c.display_name.trim(), phone: p === "invalid" ? null : p };
  });

export const telHref = (phone: string) => `tel:+${phone}`;
export const waHref = (phone: string) => `https://wa.me/${phone}`;

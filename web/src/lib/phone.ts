/**
 * Soldiers' mobile numbers: stored as 9725XXXXXXXX (what wa.me wants), typed and imported in any
 * common form – 050-1234567, 0501234567, +972 50 123 4567, 00972501234567, or 501234567 (Excel drops
 * the leading zero of a number cell).
 */
export type PhoneParse = string | null | "invalid";

/** null for an empty value, "invalid" for something that is not an Israeli mobile number. */
export function normalizePhone(raw: unknown): PhoneParse {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/[^\d\s()+\-.]/.test(s)) return "invalid";
  let d = s.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("972")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? `972${d}` : "invalid";
}

/** 972501234567 → 050-123-4567 */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored || !/^9725\d{8}$/.test(stored)) return stored ?? "";
  const local = `0${stored.slice(3)}`;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

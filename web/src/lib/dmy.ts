/** dd/mm/yyyy <-> ISO, for the date fields (the app's dates are always day first). */

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-25" -> "25/11/2026"; "2026-11-25T08:30" -> "25/11/2026 08:30"; "" -> "" */
export function isoToDmy(iso: string | null | undefined): string {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}`;
}

/**
 * "25/11/2026", "25.11.26", "25-11-2026" or "25112026" -> "2026-11-25" (with withTime also
 * " 08:30" / "0830" -> "2026-11-25T08:30"). Not a real date: null.
 */
export function dmyToIso(text: string, withTime = false): string | null {
  const t = text.trim();
  const m =
    t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:[\s,]+(\d{1,2}):?(\d{2}))?$/) ??
    t.match(/^(\d{2})(\d{2})(\d{4})(?:\s*(\d{2}):?(\d{2}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const day = `${y}-${pad(mo)}-${pad(d)}`;
  if (!withTime) return m[4] === undefined ? day : null;
  if (m[4] === undefined) return null;
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (h > 23 || mi > 59) return null;
  return `${day}T${pad(h)}:${pad(mi)}`;
}

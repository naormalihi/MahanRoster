/** מטווח: the employee's own validity and the planned ranges (staff). */

export interface PlannedRange {
  id: string;
  day: string; // YYYY-MM-DD
  starts: string | null; // HH:MM
  ends: string | null;
  place: string | null;
  note: string | null;
}

export type PlannedRangeInput = Omit<PlannedRange, "id"> & { id?: string };

export interface MyRange {
  valid_until: string | null;
  self_updated_at: string | null;
  validity_months: number;
  warning_days: number;
  next: Omit<PlannedRange, "id"> | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** last range + months – the same as the server (Postgres month arithmetic clamps to the month's end) */
export function validUntil(lastIso: string, months: number): string {
  const [y, m, d] = lastIso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

export function plannedRangeProblems(r: PlannedRangeInput, today: string): string[] {
  const p: string[] = [];
  if (!r.day) p.push("צריך תאריך");
  else if (r.day < today) p.push("התאריך כבר עבר");
  if (r.starts && r.ends && r.ends <= r.starts) p.push("שעת הסיום לפני ההתחלה");
  if ((r.place ?? "").length > 80) p.push("מקום – עד 80 תווים");
  if ((r.note ?? "").length > 200) p.push("הערה – עד 200 תווים");
  return p;
}

export function rangeWhen(r: Pick<PlannedRange, "day" | "starts" | "ends" | "place">): string {
  const [y, m, d] = r.day.split("-");
  return `${d}/${m}/${y}${r.starts ? ` ${r.starts}${r.ends ? `–${r.ends}` : ""}` : ""}${r.place ? `, ${r.place}` : ""}`;
}

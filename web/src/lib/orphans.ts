/**
 * Requests that fall in no cycle. The constraints screens show a cycle's dates only, so an
 * exemption, absence or date block for days no cycle covers yet is invisible there – until a
 * cycle is opened for them. The home screen lists them so נע"ת knows to open (or stretch) one.
 */
import { absenceDays, type Absence, type DateBlock, type Exemption } from "./cycles";

export interface Orphan {
  kind: "exemption" | "absence" | "block";
  id: string;
  soldier_id: string;
  from: string;
  to: string;
  pending: boolean;
}

type Span = { start_date: string; end_date: string };
const covered = (from: string, to: string, cycles: Span[]) => cycles.some((c) => c.start_date <= to && c.end_date >= from);

export function orphanRequests(ex: Exemption[], abs: Absence[], blocks: DateBlock[], cycles: Span[], today: string): Orphan[] {
  const out: Orphan[] = [];
  for (const e of ex)
    if ((e.status === "pending" || e.status === "approved") && e.end_date >= today && !covered(e.start_date, e.end_date, cycles))
      out.push({ kind: "exemption", id: e.id, soldier_id: e.soldier_id, from: e.start_date, to: e.end_date, pending: e.status === "pending" });
  for (const a of abs) {
    if (a.status !== "active") continue;
    const d = absenceDays(a);
    if (d.to >= today && !covered(d.from, d.to, cycles)) out.push({ kind: "absence", id: a.id, soldier_id: a.soldier_id, from: d.from, to: d.to, pending: false });
  }
  for (const b of blocks)
    if (b.status === "active" && b.day >= today && !covered(b.day, b.day, cycles))
      out.push({ kind: "block", id: b.id, soldier_id: b.soldier_id, from: b.day, to: b.day, pending: false });
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** Is there a cycle for these days at all? (the soldier's form warns when not) */
export function inSomeCycle(from: string, to: string, cycles: Span[]): boolean {
  return covered(from, to || from, cycles);
}

export const ORPHAN_KIND: Record<Orphan["kind"], string> = { exemption: "פטור", absence: "היעדרות", block: "חסימת יום" };

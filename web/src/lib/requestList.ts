/**
 * "הבקשות שלי" as one list: every request of the soldier – exemption, date block, absence –
 * the coming ones first, the ones whose days passed folded under "קודמות". Plain functions,
 * tested without a browser.
 */
import { dayKey } from "./dates";
import type { InputCycle, MyRequests } from "./me";

export type RequestKind = "exemption" | "block" | "absence";
export const KIND_LABEL: Record<RequestKind, string> = { exemption: "פטור", block: "חסימת תאריך", absence: "היעדרות" };

export interface RequestItem {
  key: string;
  id: string;
  kind: RequestKind;
  /** the exemption or absence type; empty for a block */
  type: string;
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd, inclusive
  /** exemptions: pending / approved / …; blocks and absences take effect at once */
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "active";
  urgent: boolean;
  /** entered by אחראי השיבוצים, not by the soldier */
  byStaff: boolean;
  reason: string | null;
  /** the soldier may cancel it */
  cancellable: boolean;
  past: boolean;
}

export function requestItems(mine: MyRequests, today: string): { current: RequestItem[]; past: RequestItem[] } {
  const all: RequestItem[] = [
    ...mine.exemptions.map((e) => ({
      key: `e${e.id}`, id: e.id, kind: "exemption" as const, type: e.type, from: e.start_date.slice(0, 10), to: e.end_date.slice(0, 10),
      status: e.status, urgent: e.is_urgent, byStaff: !e.mine, reason: e.status === "approved" ? null : e.decision_reason,
      cancellable: e.mine && e.status === "pending", past: false,
    })),
    ...mine.blocks.map((b) => ({
      key: `b${b.id}`, id: b.id, kind: "block" as const, type: "", from: b.day, to: b.day, status: "active" as const, urgent: false,
      byStaff: !b.mine, reason: null, cancellable: b.mine && b.open, past: false,
    })),
    ...mine.absences.map((a) => ({
      key: `a${a.id}`, id: a.id, kind: "absence" as const, type: a.type, from: dayKey(a.starts_at), to: dayKey(new Date(Date.parse(a.ends_at) - 1)),
      status: "active" as const, urgent: false, byStaff: !a.mine, reason: null, cancellable: a.mine && a.open, past: false,
    })),
  ].map((r) => ({ ...r, past: r.to < today }));
  const current = all.filter((r) => !r.past).sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));
  const past = all.filter((r) => r.past).sort((a, b) => b.to.localeCompare(a.to));
  return { current, past };
}

/** Blocks the soldier himself put in a month (yyyy-mm), against the monthly quota. */
export const blocksInMonth = (mine: MyRequests, month: string) => mine.blocks.filter((b) => b.mine && b.day.slice(0, 7) === month).length;

/** The cycle a day falls in. */
export const cycleOf = (day: string, cycles: InputCycle[]) => cycles.find((c) => c.start_date <= day && day <= c.end_date);

/**
 * When the cycle of the coming days has closed its deadline: one sentence on what can be done
 * now, and the next cycle still open, if any.
 */
export function closedNotice(cycles: InputCycle[], today: string): { closed: InputCycle; next: InputCycle | null } | null {
  const sorted = [...cycles].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const closed = sorted.find((c) => !c.open && c.end_date >= today);
  if (!closed) return null;
  return { closed, next: sorted.find((c) => c.open && c.start_date > closed.start_date) ?? null };
}

/** Swaps between soldiers: a handover (he takes my duty) or a mutual trade (we exchange duties). */
import type { MyDuty } from "./me";

export interface SwapOptions {
  handover: { soldier_id: string; name: string }[];
  mutual: { soldier_id: string; name: string; assignment_id: string; task: string; starts_at: string; ends_at: string }[];
}

export type SwapStatus = "pending_peer" | "approved" | "rejected" | "cancelled";

export interface MySwap {
  id: string;
  kind: "handover" | "mutual";
  status: SwapStatus;
  /** I asked (true) or I was asked (false) */
  mine: boolean;
  other_name: string;
  /** the requester's duty */
  give_task: string;
  give_starts_at: string;
  give_ends_at: string;
  /** the other soldier's duty, in a mutual trade */
  take_task: string | null;
  take_starts_at: string | null;
  take_ends_at: string | null;
  reason: string | null;
  created_at: string;
  /** still open but too close to the duty: can no longer go through */
  expired: boolean;
}

export interface SwapLogRow {
  id: string;
  kind: "handover" | "mutual";
  status: SwapStatus;
  requester: string;
  target: string;
  give_task: string;
  give_starts_at: string;
  take_task: string | null;
  take_starts_at: string | null;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Hours before a duty after which only נע"ת changes it (the server's setting has the last word). */
export const SWAP_CUTOFF_HOURS = 24;

export function canAskSwap(d: Pick<MyDuty, "status" | "starts_at">, now: number): boolean {
  return (d.status === "assigned" || d.status === "reserve_idle") && Date.parse(d.starts_at) - now >= SWAP_CUTOFF_HOURS * 3600_000;
}

export function swapStatusLabel(s: Pick<MySwap, "status" | "expired" | "mine">): { text: string; tone: "warning" | "success" | "default" | "error" } {
  if (s.status === "pending_peer") return s.expired ? { text: "פג תוקף", tone: "default" } : { text: s.mine ? "ממתין לתשובה" : "מחכה לך", tone: "warning" };
  if (s.status === "approved") return { text: "בוצעה", tone: "success" };
  if (s.status === "rejected") return { text: "נדחתה", tone: "error" };
  return { text: "בוטלה", tone: "default" };
}

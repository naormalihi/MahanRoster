/** Version 2.1: a soldier's own account – joining with an invite code, his duties and his score. */

export type InviteState = "open" | "used" | "revoked" | "expired";

/** A soldier's account and newest invite code, as the soldiers screen shows them. */
export interface SoldierAccount {
  soldier_id: string;
  username: string | null;
  is_locked: boolean | null;
  invited_at: string | null;
  invite_expires_at: string | null;
  invite_state: InviteState | null;
}

export interface MyDuty {
  assignment_id: string;
  cycle_id: string;
  cycle_name: string;
  task_name: string;
  starts_at: string;
  ends_at: string;
  role: "performer" | "reserve";
  status: string;
  points: number;
  explanation: string | null;
  report_at: string | null;
  report_place: string | null;
  briefing_at: string | null;
  briefing_place: string | null;
  equipment: string | null;
}

export interface MyScore {
  cycle_id: string;
  cycle_name: string;
  start_date: string;
  end_date: string;
  duties: number;
  points: number;
  group_label: string | null;
  group_size: number;
  group_mean: number | null;
}

/** How a soldier's account stands, in a few words. */
export function accountLabel(a: SoldierAccount | undefined, today: string): { text: string; tone: "success" | "info" | "warning" | "default" } {
  if (a?.username) return { text: a.is_locked ? `${a.username} · נעול` : a.username, tone: a.is_locked ? "warning" : "success" };
  if (a?.invite_state === "open" && a.invite_expires_at && a.invite_expires_at.slice(0, 10) >= today)
    return { text: `הוזמן · עד ${a.invite_expires_at.slice(5, 10).split("-").reverse().join("/")}`, tone: "info" };
  if (a?.invite_state === "expired" || (a?.invite_state === "open" && a.invite_expires_at)) return { text: "הקוד פג", tone: "warning" };
  return { text: "—", tone: "default" };
}

/** The code as typed: letters and digits only, upper case (the dash and spaces do not matter). */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Upcoming duties first (soonest first), then the past (latest first). */
export function splitDuties(duties: MyDuty[], now: number): { upcoming: MyDuty[]; past: MyDuty[] } {
  const upcoming = duties.filter((d) => Date.parse(d.ends_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = duties.filter((d) => Date.parse(d.ends_at) <= now).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { upcoming, past };
}

// ----- stage 2.2: the soldier enters his own constraints -----

export interface InputCycle {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  deadline: string | null;
  /** self-entry of blocks and absences still open (before the deadline, not published) */
  open: boolean;
}

export interface InputOptions {
  exemption_types: { id: string; name: string }[];
  absence_types: { id: string; name: string }[];
  block_quota_per_month: number;
  cycles: InputCycle[];
}

export interface MyRequests {
  exemptions: {
    id: string;
    type: string;
    start_date: string;
    end_date: string;
    status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
    is_urgent: boolean;
    mine: boolean;
    decision_reason: string | null;
  }[];
  blocks: { id: string; day: string; mine: boolean; open: boolean }[];
  absences: { id: string; type: string; starts_at: string; ends_at: string; mine: boolean; open: boolean }[];
}

/** Is self-entry open on this day? Closed when a cycle that holds it is past its deadline or published. */
export function entryOpen(day: string, cycles: InputCycle[]): boolean {
  return !cycles.some((c) => c.start_date <= day && day <= c.end_date && !c.open);
}

/** The cycle still collecting with the nearest deadline, for "open until". */
export function openCycle(cycles: InputCycle[]): InputCycle | undefined {
  return cycles.filter((c) => c.open).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
}

import { dayKey } from "./dates";
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
  /** when אחראי השיבוצים marked the newest code as handed out (WhatsApp, print) */
  invite_sent_at?: string | null;
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
  /** the briefing is by call (מפקד תורן), no fixed time */
  briefing_by_call?: boolean;
  /** from the duty's catalog: whom to call, and a note to the soldier */
  contact_name?: string | null;
  contact_phone?: string | null;
  briefing_note?: string | null;
  /** the duty's own note (third column of the duties file, or written by hand) */
  note?: string | null;
  /** the duty type's color (the catalog), for the stripe beside it; null: none chosen */
  task_color?: string | null;
  /** when he pressed "ראיתי" (or אחראי השיבוצים marked a phone call); null: still waiting */
  acked_at?: string | null;
}

/** A duty of the coming days that its soldier has not acknowledged yet (אחראי השיבוצים, gaf commander). */
export interface UnackedDuty {
  assignment_id: string;
  soldier_id: string;
  full_name: string;
  gaf_name: string | null;
  has_account: boolean;
  phone: string | null;
  task_name: string;
  role: "performer" | "reserve";
  starts_at: string;
  ends_at: string;
  /** "עוד לא אישרת" was already sent */
  reminded: boolean;
}

/** A duty still waiting for the soldier's "ראיתי": live, not over, not acknowledged. */
export function needsAck(d: Pick<MyDuty, "acked_at" | "status" | "ends_at">, now: number): boolean {
  return !d.acked_at && ["assigned", "reserve_idle", "reserve_activated"].includes(d.status) && Date.parse(d.ends_at) > now;
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
  if (a?.invite_state === "open" && a.invite_expires_at && a.invite_expires_at.slice(0, 10) >= today) {
    const until = a.invite_expires_at.slice(5, 10).split("-").reverse().join("/");
    return a.invite_sent_at ? { text: `נשלח · עד ${until}`, tone: "info" } : { text: `הוזמן · לא נשלח · עד ${until}`, tone: "warning" };
  }
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
  /** the board is out (2.72) */
  published?: boolean;
  published_at?: string | null;
}

export interface InputOptions {
  exemption_types: { id: string; name: string; requires_duty_list?: boolean }[];
  /** the duties the employee is eligible for – a פטור חלקי names some of them */
  eligible_tasks?: { id: string; name: string }[];
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

export interface CycleRequests {
  /** null = the days no cycle covers yet */
  cycle: InputCycle | null;
  exemptions: MyRequests["exemptions"];
  blocks: MyRequests["blocks"];
  absences: MyRequests["absences"];
}

/**
 * The soldier's requests by cycle: the current cycle and the next (a later one only when it
 * already holds a request), each with what falls in it, and a last group for days no cycle
 * covers yet. A request across two cycles shows in both;
 * one that ended before the cycles listed is left out.
 */
export function requestsByCycle(mine: MyRequests, cycles: InputCycle[], today: string): CycleRequests[] {
  const absDays = (a: { starts_at: string; ends_at: string }) => ({
    from: dayKey(a.starts_at),
    to: dayKey(new Date(Date.parse(a.ends_at) - 1)),
  });
  const hit = (from: string, to: string, c: InputCycle) => c.start_date <= to && c.end_date >= from;
  const groups: CycleRequests[] = cycles.map((c) => ({
    cycle: c,
    exemptions: mine.exemptions.filter((e) => hit(e.start_date, e.end_date, c)),
    blocks: mine.blocks.filter((b) => hit(b.day, b.day, c)),
    absences: mine.absences.filter((a) => {
      const d = absDays(a);
      return hit(d.from, d.to, c);
    }),
  }));
  const none = (from: string, to: string) => to >= today && !cycles.some((c) => hit(from, to, c));
  const orphan: CycleRequests = {
    cycle: null,
    exemptions: mine.exemptions.filter((e) => none(e.start_date, e.end_date)),
    blocks: mine.blocks.filter((b) => none(b.day, b.day)),
    absences: mine.absences.filter((a) => {
      const d = absDays(a);
      return none(d.from, d.to);
    }),
  };
  // the cycle today falls in and the one after it; a later cycle only when something is already in it
  const sorted = groups.sort((x, y) => x.cycle!.start_date.localeCompare(y.cycle!.start_date));
  const shown = sorted.filter((g, i) => i < 2 || g.exemptions.length + g.blocks.length + g.absences.length > 0);
  return orphan.exemptions.length + orphan.blocks.length + orphan.absences.length ? [...shown, orphan] : shown;
}

/**
 * "המחזור הבא" (2.72): the one cycle after today's – the only one whose stage still changes. Its
 * step for the employee, and where his requests for it stand (pending / in force / rejected).
 */
export function nextCycleInfo(cycles: InputCycle[], req: MyRequests | null, today: string) {
  const c = [...cycles].sort((a, b) => a.start_date.localeCompare(b.start_date)).find((x) => x.start_date > today);
  if (!c) return null;
  const stage: "open" | "preparing" | "published" = c.published ? "published" : c.open ? "open" : "preparing";
  const touches = (from: string, to: string) => from.slice(0, 10) <= c.end_date && to.slice(0, 10) >= c.start_date;
  const ex = (req?.exemptions ?? []).filter((e) => touches(e.start_date, e.end_date));
  const blocks = (req?.blocks ?? []).filter((b) => touches(b.day, b.day)).length;
  const absences = (req?.absences ?? []).filter((a) => touches(a.starts_at, a.ends_at)).length;
  return {
    name: c.name,
    stage,
    deadline: c.deadline,
    published_at: c.published_at ?? null,
    mine: {
      pending: ex.filter((e) => e.status === "pending").length,
      approved: ex.filter((e) => e.status === "approved").length + blocks + absences,
      rejected: ex.filter((e) => e.status === "rejected").length,
    },
  };
}

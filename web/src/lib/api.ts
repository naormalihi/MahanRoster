/**
 * The app's only door to data. Two implementations: Supabase (real) and Demo
 * (in-memory fictitious unit, for previews and screenshots without a backend).
 */

import type { CalendarDay, DayTypeRef, Population, ScoreMultiplier, ScoreMultiplierInput, ScoringSettings, TaskType, TaskTypeInput } from "./catalog";
import type {
  Absence,
  AbsenceInput,
  AbsenceType,
  Cycle,
  CycleInput,
  DateBlock,
  DateBlockInput,
  Exemption,
  ExemptionDecision,
  ExemptionInput,
  ExemptionType,
  StageState,
} from "./cycles";
import type { Alias, NewSlot, RankRef, SlotDraft, SlotRow } from "./baseSchedule";
import type { AppUser } from "./users";
import type { Candidate, DraftAssignment, Role as DraftRole } from "./draft";
import type { ScheduleJob } from "./schedule";
import type { DailyAvailability, PotentialCell, SnapshotSoldier } from "./potential";
import type { ExistingSoldier, RosterPlan } from "./roster";
import type { LoadRoleRef, SoldierDetail, SoldierLoadRole, SoldierPatch } from "./soldiers";

export type Role = "coordinator" | "deputy" | "viewer" | "gaf_commander" | "gaf_rep" | "unit_commander" | "soldier";

export interface Me {
  userId: string;
  username: string;
  roles: Role[];
  mustChangePassword: boolean;
}

export const isStaff = (me: Me | null) => !!me && (me.roles.includes("coordinator") || me.roles.includes("deputy"));
/** Gaf commanders: read-only access to the whole unit. */
export const isCommander = (me: Me | null) => !!me && me.roles.includes("gaf_commander");
/** Sees the planning screens (staff edit, commanders only read). */
export const canRead = (me: Me | null) => isStaff(me) || isCommander(me);

export interface MfaState {
  /** signed in with password only, and a TOTP factor exists */
  needsVerify: boolean;
  /** staff without any TOTP factor yet */
  needsEnroll: boolean;
  factorId?: string;
}

export interface BoardRow {
  slot_id: string;
  starts_at: string;
  ends_at: string;
  task_name: string;
  category_name: string | null;
  color: string | null;
  performers: string[];
  reserves: string[];
  gafim: string[];
  report_at: string | null;
  report_place: string | null;
  briefing_at: string | null;
  briefing_place: string | null;
  updated_at: string;
  changed_after_publish: boolean;
  instructions?: string | null;
  /** The gaf of each performer / reserve, in the order of the names. */
  performer_gafim?: string[];
  reserve_gafim?: string[];
  cycle_id?: string;
  /** performers who came in as an activated reserve, and the performers they replaced */
  activated?: string[];
  replaced?: string[];
}

/** The people of one published duty, for the actions on it (staff). */
export interface SlotPerson {
  id: string; // assignment id
  name: string;
  role: "performer" | "reserve";
  status: string;
  replaced_id: string | null; // an activated reserve: the performer he replaced
}
export interface SlotPeople {
  slot: { id: string; cycle_id: string; starts_at: string; ends_at: string; task_name: string; published: boolean };
  people: SlotPerson[];
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface ApplyResult {
  added: number;
  updated: number;
  deactivated: number;
  gafimCreated: number;
}

export interface Api {
  readonly demo: boolean;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  me(): Promise<Me | null>;
  mfaState(): Promise<MfaState>;
  mfaEnroll(): Promise<{ factorId: string; qrSvg: string; secret: string }>;
  mfaVerify(factorId: string, code: string): Promise<void>;
  changePassword(newPassword: string): Promise<void>;
  board(fromIso: string, toIso: string): Promise<BoardRow[]>;
  /** Start of the first published duty from a moment on (null = none). */
  nextPublished(fromIso: string): Promise<string | null>;
  soldiers(): Promise<ExistingSoldier[]>;
  gafim(): Promise<NamedRef[]>;
  ranks(): Promise<NamedRef[]>;
  unitKeyCheck(): Promise<string | null>;
  setUnitKeyCheck(value: string): Promise<void>;
  /** A forgotten unit key: moves the approved soldiers to keys made with the new one, and stores its fingerprint. */
  rekeySoldiers(pairs: { id: string; key: string }[], check: string): Promise<number>;
  /** The people of a published duty with their assignment ids (staff). */
  slotPeople(slotId: string): Promise<SlotPeople | null>;
  /** Undoes a reserve activation while the duty has not started. */
  undoReserveActivation(reserveId: string): Promise<void>;
  /** Deletes a duty that waits for staffing and has nothing published on it. */
  deletePendingSlot(slotId: string): Promise<void>;
  applyRoster(plan: RosterPlan): Promise<ApplyResult>;
  soldierDetails(): Promise<SoldierDetail[]>;
  updateSoldiers(ids: string[], patch: SoldierPatch): Promise<void>;
  loadRoles(): Promise<LoadRoleRef[]>;
  saveLoadRole(id: string | null, role: { name: string; factor: number }): Promise<void>;
  /** Only a role no soldier has. */
  deleteLoadRole(id: string): Promise<void>;
  /** Replace the soldier's load-role periods with the given list. */
  setSoldierLoadRoles(soldierId: string, roles: Omit<SoldierLoadRole, "name" | "factor">[]): Promise<void>;
  // settings screen
  taskTypes(): Promise<TaskType[]>;
  /** Create (id null) or update a duty type. */
  saveTaskType(id: string | null, t: TaskTypeInput): Promise<void>;
  /** Only a duty type nothing uses; otherwise the error says to make it inactive. */
  deleteTaskType(id: string): Promise<void>;
  dutyCategories(): Promise<NamedRef[]>;
  populations(): Promise<Population[]>;
  scoringSettings(): Promise<ScoringSettings>;
  saveScoringSettings(s: ScoringSettings): Promise<void>;
  scoreMultipliers(): Promise<ScoreMultiplier[]>;
  saveScoreMultiplier(id: string | null, m: ScoreMultiplierInput): Promise<void>;
  deleteScoreMultiplier(id: string): Promise<void>;
  dayTypes(): Promise<DayTypeRef[]>;
  /** A new calendar day type (e.g. "כוננות מוגברת"); returns its code. */
  addDayType(name: string): Promise<string>;
  /** Only a type נע"ת added, and only while no calendar day uses it. */
  deleteDayType(code: string): Promise<void>;
  calendarDays(fromIso: string, toIso: string): Promise<CalendarDay[]>;
  saveCalendarDays(days: CalendarDay[]): Promise<void>;
  deleteCalendarDay(day: string): Promise<void>;
  // cycles
  cycles(): Promise<Cycle[]>;
  saveCycle(id: string | null, c: CycleInput): Promise<void>;
  /** Each stage of the cycle with its state (done / warn / todo / busy) and a note. */
  cycleStages(cycleId: string): Promise<StageState[]>;
  /** Moves every cycle to the stage its facts put it in (staff); returns how many moved. */
  refreshCycleStages(): Promise<number>;
  // constraints
  exemptionTypes(): Promise<ExemptionType[]>;
  absenceTypes(): Promise<AbsenceType[]>;
  blockQuota(): Promise<number>;
  /** Exemptions that overlap the range. */
  exemptions(fromIso: string, toIso: string): Promise<Exemption[]>;
  addExemption(e: ExemptionInput): Promise<void>;
  /** Mark the paper proof as seen (outside the system). */
  markProofChecked(id: string): Promise<void>;
  decideExemption(id: string, d: ExemptionDecision): Promise<void>;
  /** Absences that overlap the range (days, inclusive). */
  absences(fromIso: string, toIso: string): Promise<Absence[]>;
  addAbsences(rows: AbsenceInput[]): Promise<void>;
  cancelAbsence(id: string, reason: string): Promise<void>;
  dateBlocks(fromIso: string, toIso: string): Promise<DateBlock[]>;
  addDateBlocks(rows: DateBlockInput[], cycleId: string | null): Promise<void>;
  cancelDateBlock(id: string): Promise<void>;
  // potential
  /** Freeze ranks/populations for the cycle (snapshot) and stamp the time. */
  computePotential(cycleId: string): Promise<number>;
  potentialMatrix(cycleId: string): Promise<PotentialCell[]>;
  potentialDaily(cycleId: string): Promise<DailyAvailability[]>;
  snapshotSoldiers(cycleId: string): Promise<SnapshotSoldier[]>;
  /** ת"ש 7 soldiers of the cycle (home every night), and whether only for part of it */
  cycleHomeNightly(cycleId: string): Promise<{ soldier_id: string; partial: boolean }[]>;
  setPotentialOverride(cycleId: string, soldierId: string, categoryId: string, value: number, reason: string): Promise<void>;
  clearPotentialOverride(cycleId: string, soldierId: string, categoryId: string): Promise<void>;
  // base schedule
  rankRefs(): Promise<RankRef[]>;
  taskTypeAliases(): Promise<Alias[]>;
  saveTaskTypeAliases(aliases: Alias[]): Promise<void>;
  deleteTaskTypeAlias(alias: string): Promise<void>;
  cycleSlots(cycleId: string): Promise<SlotRow[]>;
  /** Insert the slots; with replace, first delete the cycle's slots that have no real assignments. */
  importSlots(cycleId: string, slots: SlotDraft[], replace: boolean, fileName: string): Promise<{ inserted: number; deleted: number }>;
  deleteSlots(ids: string[]): Promise<void>;
  // scheduling runs
  scheduleJobs(cycleId: string): Promise<ScheduleJob[]>;
  /** "stability" keeps every published assignment and fills the rest (e.g. duties added after publishing). */
  requestSchedule(cycleId: string, kind?: "full" | "stability"): Promise<string>;
  /** A duty added by hand to a cycle (after publishing: then filled by a stability run). */
  addSlot(cycleId: string, slot: NewSlot): Promise<void>;
  /** Approve the engine's draft for duties added after publishing; the cycle stays published. */
  publishAdditions(cycleId: string): Promise<number>;
  /**
   * The reserve takes over a published duty: from its start (the performer is dropped) or from
   * day unit fromUnit of a multi-day duty (each keeps the points of their days).
   */
  activateReserve(reserveId: string, fromUnit: number, performerId: string | null, note: string | null): Promise<void>;
  redispatchSchedule(jobId: string): Promise<string>;
  cancelScheduleJob(jobId: string): Promise<void>;
  dispatchConfigured(): Promise<boolean>;
  dispatchResponse(jobId: string): Promise<{ status_code: number | null; error: string | null; body: string | null } | null>;
  // draft editor
  draftAssignments(cycleId: string): Promise<DraftAssignment[]>;
  slotCandidates(slotId: string): Promise<Candidate[]>;
  manualAssign(slotId: string, role: DraftRole, soldierId: string, replaceId: string | null, reason: string): Promise<string>;
  /** Staffs a waiting duty of a published cycle straight onto the board (reason when a rule is broken). */
  assignPublished(slotId: string, role: DraftRole, soldierId: string, reason: string | null): Promise<string>;
  removeAssignment(assignmentId: string, reason: string): Promise<void>;
  publishCycle(cycleId: string): Promise<number>;
  /** Back to draft; only before the cycle starts, by the coordinator. */
  unpublishCycle(cycleId: string): Promise<number>;

  listUsers(): Promise<AppUser[]>;
  /** A gaf-commander account with a temporary password, linked to a soldier record. */
  createUser(username: string, password: string, soldierId: string | null): Promise<string>;
  resetUserPassword(userId: string, password: string): Promise<void>;
  setUserLocked(userId: string, locked: boolean): Promise<void>;
  setUserSoldier(userId: string, soldierId: string | null): Promise<void>;
}

/**
 * Username → the synthetic e-mail Supabase Auth stores (no real mailbox exists).
 * A full e-mail address is used as is – for staff accounts created with a real address.
 */
export const usernameToEmail = (username: string) => {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@users.invalid`;
};

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function passwordProblems(pw: string, username: string): string | null {
  if (pw.length < 10) return "לפחות 10 תווים";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "צריכה לכלול אותיות וספרות";
  if (pw.toLowerCase().includes(username.toLowerCase())) return "אסור שתכיל את שם המשתמש";
  return null;
}

let instance: Api | null = null;

export async function getApi(): Promise<Api> {
  if (instance) return instance;
  const env = import.meta.env;
  if (env.VITE_DEMO === "1" || (env.DEV && !env.VITE_SUPABASE_URL)) {
    const { DemoApi } = await import("../demo/demoApi");
    instance = new DemoApi();
  } else {
    // A production build without its settings must fail loudly, not fall back to fake data.
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)
      throw new Error("ההגדרות VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY חסרות בבנייה");
    const { SupabaseApi } = await import("./supabaseApi");
    instance = new SupabaseApi(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  }
  return instance;
}

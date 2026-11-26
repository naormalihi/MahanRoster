import type { MyProfile, StaffFixRequest } from "./profile";
import type { MyRange, PlannedRange, PlannedRangeInput } from "./range";
import type { Inversion } from "./fairness";
import type { PotentialWhy } from "./potential";
import type { FeedbackDraft, FeedbackItem, FeedbackStatus } from "./feedback";
import type { FrameworkSelection } from "./frameworks";
import type { AddSoldierResult, AddSoldierRow } from "./addSoldier";
import type { DutyMessage } from "./dutyMessage";
import type { ContactEntry, MyContact } from "./contacts";
import type { MySwap, SwapLogRow, SwapOptions } from "./swaps";
import type { ScoringRules } from "./scoringRules";
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
  ExemptionUpdate,
  ExemptionType,
  StageState,
} from "./cycles";
import type { AppNotification } from "./notifications";
import type { UnitDashboard } from "./dashboard";
import type { InputOptions, MyDuty, MyRequests, MyScore, SoldierAccount, UnackedDuty } from "./me";
import type { Alias, NewSlot, RankRef, SlotDraft, SlotRow } from "./baseSchedule";
import type { AppUser, CreatableRole } from "./users";
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
  /** the look saved with the account (light / dark / auto), if any */
  uiTheme?: string | null;
  /** notices on new exemption requests (staff, gaf commanders); on unless turned off */
  requestAlerts?: boolean;
  /**
   * "צפייה כעובד" (2.63): staff, or a gaf commander for his own people, see the app as this
   * employee – read only. While it is on, roles are just "soldier".
   */
  viewAs?: { soldierId: string; name: string; until: string } | null;
}

export const isStaff = (me: Me | null) => !!me && (me.roles.includes("coordinator") || me.roles.includes("deputy"));
/** Gaf commanders: read-only access to the whole unit. */
export const isCommander = (me: Me | null) => !!me && (me.roles.includes("gaf_commander") || me.roles.includes("unit_commander"));
/** The unit commander (version 2.0, stage 2.6): reads everything, and has the dashboard as his home. */
export const isUnitCommander = (me: Me | null) => !!me && me.roles.includes("unit_commander");
/** Sees the planning screens (staff edit, commanders only read). */
export const canRead = (me: Me | null) => isStaff(me) || isCommander(me);
/** A soldier with his own account (version 2.1): his duties and the published board. */
export const isSoldier = (me: Me | null) => !!me && me.roles.includes("soldier");

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
  /** a special call-up: the points entered for it */
  special_points?: number | null;
  /** the duty's briefing is by call (no fixed time) */
  briefing_by_call?: boolean;
}

/** The people of one published duty, for the actions on it (staff). */
export interface NoAccountRow {
  soldier_id: string;
  full_name: string;
  gaf_name: string | null;
  phone: string | null;
  duties: number;
  first_at: string;
  /** a message went out since the cycle was published */
  sent: boolean;
}

export interface SlotPerson {
  id: string; // assignment id
  name: string;
  role: "performer" | "reserve";
  status: string;
  replaced_id: string | null; // an activated reserve: the performer he replaced
  is_surprise?: boolean; // put on it less than the notice hours before it starts (הקפצה)
}
export interface SlotPeople {
  slot: { id: string; cycle_id: string; starts_at: string; ends_at: string; task_name: string; published: boolean; fixed_points?: number | null; special_name?: string | null; note?: string | null };
  people: SlotPerson[];
}

/** A score corrected by hand (staff), counted from the cycle it was given for. */
export interface ScoreCorrection {
  id: string;
  soldier_id: string;
  cycle_id: string | null;
  cycle_name: string | null;
  points: number;
  reason: string;
  created_by_name: string | null;
  created_at: string;
}

export interface NamedRef {
  id: string;
  name: string;
}

/** A rank: a neutral name (חובה 3), the military names it is read from in files, and whether it does duties. */
export interface RankItem extends NamedRef {
  aliases?: string[];
  in_duties?: boolean;
}

export interface ApplyResult {
  added: number;
  updated: number;
  deactivated: number;
  gafimCreated: number;
}

export interface HolidayDuty {
  soldier_id: string;
  day: string;
  task_name: string;
}

export interface SpecDocument {
  version: string;
  body: string;
  updated_at: string;
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
  /** His own username. On the first sign-in no password is needed; later – the current one, once a week. */
  renameMe(username: string, password: string | null): Promise<void>;
  board(fromIso: string, toIso: string): Promise<BoardRow[]>;
  /** Start of the first published duty from a moment on (null = none). */
  nextPublished(fromIso: string): Promise<string | null>;
  soldiers(): Promise<ExistingSoldier[]>;
  gafim(): Promise<NamedRef[]>;
  ranks(): Promise<RankItem[]>;
  /** keep the chosen look with the account */
  setMyTheme(choice: "auto" | "light" | "dark"): Promise<void>;
  /** "הצעה לשיפור" – anyone signed in; up to 5 a day */
  submitFeedback(d: FeedbackDraft): Promise<void>;
  /** "הצעות ומשוב" – אחראי השיבוצים, מ"מ and the unit commander */
  feedbackList(): Promise<FeedbackItem[]>;
  feedbackNewCount(): Promise<number>;
  /** "מסמך האפיון" – staff and commanders (gaf and unit); null in the demo */
  specDocument(): Promise<SpecDocument | null>;
  updateFeedback(id: string, status: FeedbackStatus, note: string | null, reply: string | null): Promise<void>;
  setMyRequestAlerts(on: boolean): Promise<void>;
  /** "למי לפנות": up to two of אחראי השיבוצים / מ"מ and the commander of my gaf, as אחראי השיבוצים chose */
  myContacts(): Promise<MyContact[]>;
  soldierContactsList(): Promise<ContactEntry[]>;
  setSoldierContacts(list: { user_id: string; display_name: string; phone: string | null }[]): Promise<void>;
  unitKeyCheck(): Promise<string | null>;
  /** one soldier by hand (the employee number already hashed); an existing one is reported, not duplicated */
  addSoldier(row: AddSoldierRow): Promise<AddSoldierResult>;
  reactivateSoldier(soldierId: string, joinDate: string): Promise<void>;
  /** inactive from a day; his live duties from it are dropped (slots to fill). Returns how many. */
  removeFromUnit(soldierId: string, fromDay: string): Promise<number>;
  /** "הוצאה מהיחידה" for several employees; an inactive one is skipped */
  removeFromUnitMany(soldierIds: string[], fromDay: string): Promise<{ removed: number; duties_dropped: number }>;
  /** "מחיקה לצמיתות": one with duties on a published board is kept (blocked) */
  deleteSoldiers(soldierIds: string[]): Promise<{ deleted: number; accounts: number; blocked: { id: string; name: string }[] }>;
  futureDuties(soldierId: string, fromDay: string): Promise<number>;
  setUnitKeyCheck(value: string): Promise<void>;
  /** "מסגרות לטעינה": the frameworks chosen at the last personnel load (null = never chosen) */
  rosterFrameworks(): Promise<FrameworkSelection | null>;
  setRosterFrameworks(sel: FrameworkSelection): Promise<void>;
  /** A forgotten unit key: moves the approved soldiers to keys made with the new one, and stores its fingerprint. */
  rekeySoldiers(pairs: { id: string; key: string }[], check: string): Promise<number>;
  /** The people of a published duty with their assignment ids (staff). */
  slotPeople(slotId: string): Promise<SlotPeople | null>;
  /** Undoes a reserve activation while the duty has not started. */
  undoReserveActivation(reserveId: string): Promise<void>;
  /** Takes a performer or an idle reserve off a published duty that has not started (reason required). */
  unassignPublished(assignmentId: string, reason: string): Promise<void>;
  /** Deletes a duty that waits for staffing and has nothing published on it. */
  deletePendingSlot(slotId: string): Promise<void>;
  /** Deletes a duty before it starts, also with published people (they come off, with their points); a reason is required then. */
  deleteSlot(slotId: string, reason?: string): Promise<void>;
  applyRoster(plan: RosterPlan): Promise<ApplyResult>;
  soldierDetails(): Promise<SoldierDetail[]>;
  updateSoldiers(ids: string[], patch: SoldierPatch): Promise<void>;
  loadRoles(): Promise<LoadRoleRef[]>;
  saveLoadRole(id: string | null, role: { name: string; factor: number }): Promise<void>;
  /** Only a role no soldier has. */
  deleteLoadRole(id: string): Promise<void>;
  /** Replace the soldier's load-role periods with the given list. */
  setSoldierLoadRoles(soldierId: string, roles: Omit<SoldierLoadRole, "name" | "factor">[]): Promise<void>;
  /** The frameworks whose employees a gaf commander updates (phone, range, relief roles, join codes). */
  myCommandedGafs(): Promise<string[]>;
  /** Whether the tour opens by itself now (first three sign-ins, not dismissed); counts the opening. */
  tourAutoOpen(): Promise<boolean>;
  /** "הבנתי, אל תציג לי שוב", or the tour gone through to its end. */
  tourDismiss(): Promise<void>;
  /** Hand corrections of the score (staff): all, or one employee's. */
  scoreCorrections(soldierId?: string): Promise<ScoreCorrection[]>;
  addScoreCorrection(soldierId: string, cycleId: string, points: number, reason: string): Promise<void>;
  deleteScoreCorrection(id: string): Promise<void>;
  /** Phone and/or range date – staff, or a gaf commander for his own people. A field left out stays. */
  updateSoldiersAdmin(ids: string[], patch: { phone?: string | null; range_valid_until?: string | null }): Promise<void>;
  /** Relief roles – staff, or a gaf commander for his own people (אחראי השיבוצים is told). */
  setSoldierLoadRolesAdmin(soldierId: string, roles: Omit<SoldierLoadRole, "name" | "factor">[]): Promise<void>;
  // settings screen
  taskTypes(): Promise<TaskType[]>;
  /** Create (id null) or update a duty type. */
  saveTaskType(id: string | null, t: TaskTypeInput): Promise<void>;
  /** Only a duty type nothing uses; otherwise the error says to make it inactive. */
  deleteTaskType(id: string): Promise<void>;
  dutyCategories(): Promise<NamedRef[]>;
  /** Rename a duty category (id) or add a new one (no id). */
  saveDutyCategory(name: string, id?: string): Promise<void>;
  populations(): Promise<Population[]>;
  scoringSettings(): Promise<ScoringSettings>;
  saveScoringSettings(s: ScoringSettings): Promise<void>;
  scoreMultipliers(): Promise<ScoreMultiplier[]>;
  saveScoreMultiplier(id: string | null, m: ScoreMultiplierInput): Promise<void>;
  deleteScoreMultiplier(id: string): Promise<void>;
  dayTypes(): Promise<DayTypeRef[]>;
  /** A new calendar day type (e.g. "כוננות מוגברת"); returns its code. */
  addDayType(name: string): Promise<string>;
  /** Only a type אחראי השיבוצים added, and only while no calendar day uses it. */
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
  /** פטור חלקי: the duties the employee can't do */
  setExemptionDuties(id: string, taskTypeIds: string[]): Promise<void>;
  /** staff-only note ("" clears it) */
  setExemptionNote(id: string, note: string): Promise<void>;
  /** staff edit a pending or approved exemption; a new type on an approved one needs proofRechecked */
  /** "רענון חי": a counter that grows on every change of the unit's data */
  dataVersion(): Promise<number>;
  /** "צפייה כעובד": start (2 hours) / back to my own account */
  viewAsStart(soldierId: string): Promise<void>;
  viewAsStop(): Promise<void>;
  updateExemption(u: ExemptionUpdate): Promise<void>;
  /** the duties an employee is eligible for (rank, service, populations…) */
  eligibleTaskTypes(soldierId: string): Promise<string[]>;
  /** delete outright (staff) – logged in the audit log */
  deleteExemption(id: string): Promise<void>;
  deleteAbsence(id: string): Promise<void>;
  deleteDateBlock(id: string): Promise<void>;
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
  /** duties given out of turn: a lower-scored soldier of the group was free and allowed */
  orderInversions(cycleId: string): Promise<Inversion[]>;
  /** why a cell is a fraction: the missing days, cause by cause */
  potentialCellWhy(cycleId: string, soldierId: string, taskTypeId: string): Promise<PotentialWhy[]>;
  potentialDaily(cycleId: string): Promise<DailyAvailability[]>;
  snapshotSoldiers(cycleId: string): Promise<SnapshotSoldier[]>;
  /** The last duty on a holiday (or its eve) per soldier since a date, in published cycles. */
  recentHolidayDuties(sinceIso: string): Promise<HolidayDuty[]>;
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
  /** "update" starts from the current draft: keeps it where it holds, repairs the rest, balances. */
  requestSchedule(cycleId: string, kind?: "full" | "stability" | "update"): Promise<string>;
  /** A duty added by hand to a cycle (after publishing: then filled by a stability run). */
  addSlot(cycleId: string, slot: NewSlot): Promise<void>;
  /** The duty's note (≤ 300); on a published board its holders are told. Staff. */
  setSlotNote(slotId: string, note: string | null): Promise<void>;
  /** Renames a special call-up or changes its points (before it starts); re-scores who is on it. */
  updateSpecialSlot(slotId: string, name: string, points: number): Promise<void>;
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
  /** a qualifying duty (ממלכ"ת יום): who has priority for it – empty for any other duty */
  qualifyingPriority(slotId: string): Promise<string[]>;
  manualAssign(slotId: string, role: DraftRole, soldierId: string, replaceId: string | null, reason: string): Promise<string>;
  /** Staffs a waiting duty of a published cycle straight onto the board (reason when a rule is broken). */
  assignPublished(slotId: string, role: DraftRole, soldierId: string, reason: string | null): Promise<string>;
  removeAssignment(assignmentId: string, reason: string): Promise<void>;
  publishCycle(cycleId: string): Promise<number>;
  /** Back to draft; only before the cycle starts, by the coordinator. */
  unpublishCycle(cycleId: string): Promise<number>;
  // version 2.1 – soldier accounts
  /** One-time join codes for the soldiers (active, no account yet); each code is returned once. */
  createSoldierInvites(soldierIds: string[], days: number): Promise<{ soldier_id: string; code: string }[]>;
  /** the newest codes of these soldiers were handed out (WhatsApp, print) */
  markInvitesSent(soldierIds: string[]): Promise<void>;
  revokeSoldierInvites(soldierIds: string[]): Promise<number>;
  soldierAccounts(): Promise<SoldierAccount[]>;
  /** The join screen, before signing in: returns the username. */
  redeemInvite(code: string, username: string, password: string): Promise<string>;
  myDuties(): Promise<MyDuty[]>;
  myScores(): Promise<MyScore[]>;
  /** "ראיתי" on duties of mine; returns how many were marked */
  ackDuties(assignmentIds: string[]): Promise<number>;
  /** אחראי השיבוצים: "spoke with him on the phone" */
  staffAck(assignmentId: string): Promise<void>;
  /** duties of the coming hours not acknowledged yet (a gaf commander: his gaf) */
  unackedDuties(hours?: number): Promise<UnackedDuty[]>;
  /** the WhatsApp message about one duty (assignment) or all his coming duties in a cycle; a fresh join code if he has no account */
  dutyMessage(q: { soldierId?: string; assignmentId?: string; cycleId?: string }): Promise<DutyMessage>;
  /** after publishing: soldiers with duties in the cycle and no account */
  noAccountDuties(cycleId: string): Promise<NoAccountRow[]>;
  /** swaps between soldiers: whom I can give a duty of mine to, or trade it with */
  swapOptions(assignmentId: string): Promise<SwapOptions>;
  requestSwap(assignmentId: string, targetSoldierId: string, counterAssignmentId?: string | null): Promise<string>;
  answerSwap(requestId: string, accept: boolean): Promise<{ status: string; reason?: string }>;
  cancelSwap(requestId: string): Promise<void>;
  mySwaps(): Promise<MySwap[]>;
  /** for אחראי השיבוצים and commanders: the swaps of the last weeks */
  swapLog(): Promise<SwapLogRow[]>;
  /** the scoring rules for "איך מחושב הניקוד" – every signed-in user, soldiers too */
  scoringRules(): Promise<ScoringRules>;
  // stage 2.2 – the soldier's own constraints
  myInputOptions(): Promise<InputOptions>;
  myRequests(): Promise<MyRequests>;
  submitExemption(typeId: string, from: string, to: string, taskTypeIds?: string[]): Promise<void>;
  /** הפרטים שלי (null: not an employee) */
  myProfile(): Promise<MyProfile | null>;
  /** "לא נכון?" – to staff */
  requestProfileFix(field: string, current: string | null, text: string): Promise<void>;
  /** staff: open fix requests (all, or one employee's) */
  profileFixes(soldierId?: string): Promise<StaffFixRequest[]>;
  handleProfileFix(id: string, status: "fixed" | "dismissed", reply: string): Promise<void>;
  /** מטווח: the employee's validity and the next planned range (null: not an employee) */
  myRange(): Promise<MyRange | null>;
  /** the date of the last range; returns the new validity */
  updateMyRange(lastIso: string): Promise<string>;
  /** planned ranges from today (staff) */
  plannedRanges(): Promise<PlannedRange[]>;
  savePlannedRange(r: PlannedRangeInput): Promise<void>;
  deletePlannedRange(id: string): Promise<void>;
  withdrawMyExemption(id: string): Promise<void>;
  addMyDateBlock(day: string): Promise<void>;
  cancelMyDateBlock(id: string): Promise<void>;
  addMyAbsence(typeId: string, from: string, to: string): Promise<void>;
  cancelMyAbsence(id: string): Promise<void>;
  // stage 2.6 – the unit commander's dashboard
  unitDashboard(): Promise<UnitDashboard>;
  // stage 2.5 – notifications
  myNotifications(): Promise<AppNotification[]>;
  markNotificationsRead(ids: string[] | null): Promise<void>;
  ackNotification(id: string): Promise<void>;
  vapidPublicKey(): Promise<string | null>;
  savePushSubscription(s: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;

  listUsers(): Promise<AppUser[]>;
  /** A gaf-commander account with a temporary password, linked to a soldier record. */
  createUser(username: string, password: string, soldierId: string | null, role?: CreatableRole): Promise<string>;
  resetUserPassword(userId: string, password: string): Promise<void>;
  /** removes a user's two-step login and signs him out; he sets it up again on his next sign-in */
  resetUserMfa(userId: string): Promise<void>;
  /** a staff role for an existing account (a soldier who became a commander), or taking it away */
  grantUserRole(userId: string, role: CreatableRole): Promise<void>;
  revokeUserRole(userId: string, role: Role): Promise<void>;
  setUserLocked(userId: string, locked: boolean): Promise<void>;
  /** Deletes a gaf commander's account; one whose name is on records is closed and hidden instead. */
  deleteUser(userId: string): Promise<"deleted" | "closed">;
  /** אחראי השיבוצים: a new username (same rules as a new account); the sign-in follows, the password stays */
  renameUser(userId: string, username: string): Promise<void>;
  /** a framework commander's framework: one chosen, or null = his linked employee's */
  setCommanderGaf(userId: string, gafId: string | null): Promise<void>;
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

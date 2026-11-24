import type { Inversion } from "./fairness";
import type { PotentialWhy } from "./potential";
import type { FeedbackDraft, FeedbackItem, FeedbackStatus } from "./feedback";
import type { FrameworkSelection } from "./frameworks";
import type { AddSoldierResult, AddSoldierRow } from "./addSoldier";
import type { DutyMessage } from "./dutyMessage";
import type { ContactEntry, MyContact } from "./contacts";
import { clearOffline, isOfflineError, OfflineError } from "./offline";
import type { MySwap, SwapLogRow, SwapOptions } from "./swaps";
import type { ScoringRules } from "./scoringRules";
import type { AppNotification } from "./notifications";
import type { UnitDashboard } from "./dashboard";
import type { InputOptions, MyDuty, MyRequests, MyScore, SoldierAccount, UnackedDuty } from "./me";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Api, ApplyResult, BoardRow, HolidayDuty, Me, MfaState, NamedRef, NoAccountRow, RankItem, Role, ScoreCorrection, SlotPeople, SpecDocument } from "./api";
import { usernameToEmail } from "./api";
import { SCORING_KEYS, type CalendarDay, type DayTypeRef, type Population, type ScoreMultiplier, type ScoreMultiplierInput, type ScoringSettings, type TaskType, type TaskTypeInput } from "./catalog";
import {
  absenceSpan,
  localMidnight,
  addDaysIso,
  type Absence,
  type AbsenceInput,
  type AbsenceType,
  type Cycle,
  type CycleInput,
  type DateBlock,
  type DateBlockInput,
  type Exemption,
  type ExemptionDecision,
  type ExemptionInput,
  type ExemptionType,
  type StageState,
} from "./cycles";
import type { Alias, NewSlot, RankRef, SlotDraft, SlotRow } from "./baseSchedule";
import type { AppUser, CreatableRole } from "./users";
import type { Candidate, DraftAssignment, Role as DraftRole } from "./draft";
import type { ScheduleJob } from "./schedule";
import type { DailyAvailability, PotentialCell, SnapshotSoldier } from "./potential";
import type { ExistingSoldier, RosterPlan, SoldierRecord } from "./roster";
import type { LoadRoleRef, SoldierDetail, SoldierLoadRole, SoldierPatch } from "./soldiers";
import { setSignInNotice } from "./signInNotice";

/** The server's "permission denied" (a reader reaching a staff action), in words. */
export const READ_ONLY_TEXT = 'צפייה בלבד – הפעולה הזו שמורה לאחראי השיבוצים.';
const errorText = (m: string) => (/permission denied/i.test(m) ? READ_ONLY_TEXT : m);

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(errorText(res.error.message));
  if (res.data === null || res.data === undefined) throw new Error("no data returned");
  return res.data as NonNullable<T>;
}

/** For calls whose answer is not used (a function that returns nothing): only the error counts. */
function run(res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(errorText(res.error.message));
}

/** For queries where "no row" is a valid answer (maybeSingle). */
function maybe<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(errorText(res.error.message));
  return res.data;
}

/**
 * The API returns at most 1,000 rows per request (Supabase's "max rows"), and a longer answer is
 * cut without an error. Reads that can pass that are taken page by page; each needs a stable order.
 */
export const PAGE_SIZE = 1000;
export async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = check(await page(from, from + PAGE_SIZE - 1)) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export class SupabaseApi implements Api {
  readonly demo = false;
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  async signIn(username: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) throw new Error(error.status === 400 ? "שם משתמש או סיסמה שגויים" : error.message);
    const blocked = await this.accessBlocked();
    if (blocked) {
      await this.sb.auth.signOut();
      throw new Error(blocked);
    }
    await this.sb.rpc("touch_last_login");
  }

  /** Why this account may not use the system now (service ended, locked), or null. */
  private async accessBlocked(): Promise<string | null> {
    const { data, error } = await this.sb.rpc("my_access");
    if (error) return null; // the database answers for itself anyway
    if (data === "released") return "השירות שלך הסתיים, ולכן אין אפשרות להתחבר. אם זו טעות – פנה לאחראי השיבוצים.";
    if (data === "locked") return "החשבון נעול. לפתיחה – פנה לאחראי השיבוצים.";
    return null;
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async me(): Promise<Me | null> {
    const { data, error } = await this.sb.auth.getUser();
    // no reception: not "signed out" – the caller may show the copy kept on the device
    if (!data.user && error && isOfflineError(error)) throw new OfflineError();
    if (!data.user) return null;
    const uid = data.user.id;
    const user = maybe(await this.sb.from("app_users").select("username, must_change_password, ui_theme, request_alerts").eq("id", uid).maybeSingle());
    if (!user) return null;
    // a session opened before his service ended: out, with the reason on the sign-in screen
    const blocked = await this.accessBlocked();
    if (blocked) {
      await this.sb.auth.signOut();
      clearOffline(); // his duties kept on the device go with him
      setSignInNotice(blocked);
      return null;
    }
    const now = Date.now();
    const roles = check(await this.sb.from("user_roles").select("role, valid_from, valid_to").eq("user_id", uid)) as {
      role: Role;
      valid_from: string | null;
      valid_to: string | null;
    }[];
    const active = roles
      .filter((r) => (!r.valid_from || Date.parse(r.valid_from) <= now) && (!r.valid_to || Date.parse(r.valid_to) > now))
      .map((r) => r.role);
    return { userId: uid, username: user.username, roles: active, mustChangePassword: user.must_change_password, uiTheme: user.ui_theme, requestAlerts: user.request_alerts ?? true };
  }

  async mfaState(): Promise<MfaState> {
    const aal = check(await this.sb.auth.mfa.getAuthenticatorAssuranceLevel());
    const factors = check(await this.sb.auth.mfa.listFactors());
    const totp = factors.totp.find((f) => f.status === "verified");
    return {
      needsVerify: !!totp && aal.currentLevel !== "aal2",
      needsEnroll: !totp,
      factorId: totp?.id,
    };
  }

  async mfaEnroll() {
    // Drop half-finished enrolments first, so a reload does not pile them up.
    const factors = check(await this.sb.auth.mfa.listFactors());
    for (const f of factors.all.filter((f) => f.status === "unverified")) await this.sb.auth.mfa.unenroll({ factorId: f.id });
    const data = check(await this.sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "MahanRoster" }));
    return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
  }

  async mfaVerify(factorId: string, code: string) {
    const { error } = await this.sb.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new Error("הקוד שגוי או שפג תוקפו");
  }

  async renameMe(username: string, password: string | null) {
    run(await this.sb.rpc("rename_me", { p_username: username, p_password: password }));
  }

  async changePassword(newPassword: string) {
    const { error } = await this.sb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
    maybe(await this.sb.rpc("password_changed"));
  }

  async nextPublished(fromIso: string) {
    const row = maybe(
      await this.sb.from("published_board").select("starts_at").gte("starts_at", fromIso).order("starts_at").limit(1).maybeSingle(),
    ) as { starts_at: string } | null;
    return row?.starts_at ?? null;
  }

  async board(fromIso: string, toIso: string): Promise<BoardRow[]> {
    return allPages<BoardRow>((from, to) =>
      this.sb.from("published_board").select("*").gte("starts_at", fromIso).lt("starts_at", toIso).order("starts_at").order("slot_id").range(from, to),
    );
  }

  async soldiers(): Promise<ExistingSoldier[]> {
    const rows = check(
      await this.sb
        .from("soldiers")
        .select(
          "id, soldier_key, full_name, service_type, gender, enlistment_date, release_date, career_start_date, range_valid_until, parent_status, home_nightly, phone, is_active, gaf:org_units!soldiers_gaf_id_fkey(name), rank:ranks!soldiers_computed_rank_id_fkey(name)",
        ),
    ) as unknown as (Omit<ExistingSoldier, "gaf_name" | "rank_name"> & { gaf: { name: string }; rank: { name: string } | null })[];
    const full = rows.map(({ gaf, rank, ...s }) => ({ ...s, gaf_name: gaf.name, rank_name: rank?.name ?? "" }));
    // a gaf commander reads the details of his own gaf only; everyone else comes by name
    // (draft, board, potential), with no personal details
    const seen = new Set(full.map((s) => s.id));
    const dir = check(await this.sb.rpc("soldier_directory")) as {
      id: string; full_name: string; service_type: string; gender: string; is_active: boolean; gaf_name: string | null; rank_name: string | null;
    }[];
    const others = dir
      .filter((d) => !seen.has(d.id))
      .map(
        (d) =>
          ({
            id: d.id, soldier_key: "", full_name: d.full_name, service_type: d.service_type, gender: d.gender, is_active: d.is_active,
            gaf_name: d.gaf_name ?? "", rank_name: d.rank_name ?? "", enlistment_date: null, release_date: null,
            career_start_date: null, range_valid_until: null, parent_status: false, home_nightly: false, phone: null,
          }) as unknown as ExistingSoldier,
      );
    return [...full, ...others];
  }

  async gafim(): Promise<NamedRef[]> {
    return check(await this.sb.from("org_units").select("id, name").eq("kind", "gaf").is("active_to", null).order("name"));
  }

  async setMyTheme(choice: "auto" | "light" | "dark"): Promise<void> {
    run(await this.sb.rpc("set_my_theme", { p_theme: choice }));
  }

  async setMyRequestAlerts(on: boolean): Promise<void> {
    run(await this.sb.rpc("set_my_request_alerts", { p_on: on }));
  }

  async myContacts(): Promise<MyContact[]> {
    return check(await this.sb.rpc("my_contacts")) as MyContact[];
  }

  async soldierContactsList(): Promise<ContactEntry[]> {
    return check(await this.sb.rpc("soldier_contacts_list")) as ContactEntry[];
  }

  async setSoldierContacts(list: { user_id: string; display_name: string; phone: string | null }[]) {
    run(await this.sb.rpc("set_soldier_contacts", { p: list }));
  }

  async submitFeedback(d: FeedbackDraft): Promise<void> {
    check(
      await this.sb.rpc("submit_feedback", {
        p_kind: d.kind, p_body: d.body, p_anonymous: d.anonymous, p_screen: d.screen, p_version: d.version, p_device: d.device,
      }),
    );
  }

  async feedbackList(): Promise<FeedbackItem[]> {
    return check(await this.sb.rpc("feedback_list", { p_status: null })) as FeedbackItem[];
  }

  async feedbackNewCount(): Promise<number> {
    return Number(check(await this.sb.rpc("feedback_new_count")) ?? 0);
  }

  async specDocument(): Promise<SpecDocument | null> {
    return (check(await this.sb.rpc("spec_document")) as SpecDocument | null) ?? null;
  }

  async updateFeedback(id: string, status: FeedbackStatus, note: string | null, reply: string | null): Promise<void> {
    run(await this.sb.rpc("update_feedback", { p_id: id, p_status: status, p_note: note, p_reply: reply }));
  }

  async ranks(): Promise<RankItem[]> {
    return check(await this.sb.from("ranks").select("id, name, aliases, in_duties").order("sort_order"));
  }

  async unitKeyCheck() {
    const row = maybe(await this.sb.from("settings").select("value").eq("key", "unit_key_check").maybeSingle());
    return (row?.value as string | null) ?? null;
  }

  async setUnitKeyCheck(value: string) {
    maybe(await this.sb.from("settings").upsert({ key: "unit_key_check", value }));
  }

  async rosterFrameworks(): Promise<FrameworkSelection | null> {
    const row = maybe(await this.sb.from("settings").select("value").eq("key", "roster_frameworks").maybeSingle());
    return (row?.value as FrameworkSelection | null) ?? null;
  }

  async setRosterFrameworks(sel: FrameworkSelection) {
    maybe(await this.sb.from("settings").upsert({ key: "roster_frameworks", value: sel }));
  }

  async rekeySoldiers(pairs: { id: string; key: string }[], fingerprint: string): Promise<number> {
    return check(await this.sb.rpc("rekey_soldiers", { p_pairs: pairs, p_check: fingerprint })) as number;
  }

  async applyRoster(plan: RosterPlan): Promise<ApplyResult> {
    let gafimCreated = 0;
    if (plan.unknownGafim.length) {
      const unit = maybe(await this.sb.from("org_units").select("id").eq("kind", "unit").limit(1).maybeSingle());
      maybe(
        await this.sb
          .from("org_units")
          .insert(plan.unknownGafim.map((name) => ({ kind: "gaf", name, parent_id: unit?.id ?? null }))),
      );
      gafimCreated = plan.unknownGafim.length;
    }
    const gafId = new Map((await this.gafim()).map((g) => [g.name, g.id]));
    const rankId = new Map((await this.ranks()).map((r) => [r.name, r.id]));
    const toRow = (r: SoldierRecord) => ({
      soldier_key: r.soldier_key,
      full_name: r.full_name,
      service_type: r.service_type,
      gender: r.gender,
      gaf_id: gafId.get(r.gaf_name),
      computed_rank_id: rankId.get(r.rank_name),
      enlistment_date: r.enlistment_date,
      release_date: r.release_date,
      career_start_date: r.career_start_date,
      range_valid_until: r.range_valid_until,
      parent_status: r.parent_status,
      home_nightly: r.home_nightly ?? undefined, // no column in the file: keep / default
      phone: r.phone ?? undefined, // an empty cell keeps the stored number
      is_active: true,
    });
    // A bulk insert sends one column list for all rows, so a value missing in one row would be sent
    // as null (not the column default): a new soldier with no ת"ש 7 column in the file is "no".
    if (plan.added.length)
      maybe(await this.sb.from("soldiers").insert(plan.added.map((r) => ({ ...toRow(r), home_nightly: r.home_nightly ?? false }))));
    for (const u of plan.updated) {
      const row = toRow(u.after);
      // keep values the file left empty
      const patch = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
      maybe(await this.sb.from("soldiers").update(patch).eq("id", u.id));
    }
    if (plan.removed.length)
      maybe(await this.sb.from("soldiers").update({ is_active: false }).in("id", plan.removed.map((s) => s.id)));
    maybe(
      await this.sb.from("roster_imports").insert({
        kind: "roster",
        status: "applied",
        summary: {
          added: plan.added.length,
          updated: plan.updated.length,
          deactivated: plan.removed.length,
          gafim_created: plan.unknownGafim,
        },
      }),
    );
    return { added: plan.added.length, updated: plan.updated.length, deactivated: plan.removed.length, gafimCreated };
  }

  async soldierDetails(): Promise<SoldierDetail[]> {
    type Row = Omit<SoldierDetail, "gaf_name" | "rank_name" | "load_roles"> & {
      gaf: { name: string };
      rank: { name: string } | null;
      soldier_load_roles: { load_role_id: string; valid_from: string; valid_to: string | null; load_roles: { name: string; factor: number } }[];
    };
    const rows = check(
      await this.sb
        .from("soldiers")
        .select(
          `id, full_name, service_type, gender, gaf_id, appointment_rank_id, appointment_rank_until, enlistment_date, release_date,
           career_start_date, range_valid_until, is_shachar, shachar_start_date, parent_status, parent_override,
           parent_override_reason, parent_override_until, second_role_signed_at, is_active,
           home_nightly, home_nightly_override, home_nightly_override_reason, home_nightly_override_until, tash_level, unit_join_date, opening_score, phone,
           gaf:org_units!soldiers_gaf_id_fkey(name), rank:ranks!soldiers_computed_rank_id_fkey(name),
           soldier_load_roles(load_role_id, valid_from, valid_to, load_roles(name, factor))`,
        )
        .order("full_name"),
    ) as unknown as Row[];
    return rows.map(({ gaf, rank, soldier_load_roles, ...s }) => ({
      ...s,
      gaf_name: gaf.name,
      rank_name: rank?.name ?? "",
      load_roles: soldier_load_roles.map((r) => ({
        load_role_id: r.load_role_id,
        valid_from: r.valid_from,
        valid_to: r.valid_to,
        name: r.load_roles.name,
        factor: Number(r.load_roles.factor),
      })),
    }));
  }

  async updateSoldiers(ids: string[], patch: SoldierPatch) {
    if (!ids.length) return;
    maybe(await this.sb.from("soldiers").update(patch).in("id", ids));
  }

  async saveLoadRole(id: string | null, role: { name: string; factor: number }) {
    const row = { name: role.name.trim(), factor: role.factor };
    if (id) maybe(await this.sb.from("load_roles").update(row).eq("id", id));
    else maybe(await this.sb.from("load_roles").insert(row));
  }

  async deleteLoadRole(id: string) {
    maybe(await this.sb.rpc("delete_load_role", { p_role: id }));
  }

  async loadRoles(): Promise<LoadRoleRef[]> {
    const rows = check(await this.sb.from("load_roles").select("id, name, factor").order("factor"));
    return rows.map((r) => ({ ...r, factor: Number(r.factor) }));
  }

  async setSoldierLoadRoles(soldierId: string, roles: Omit<SoldierLoadRole, "name" | "factor">[]) {
    maybe(await this.sb.from("soldier_load_roles").delete().eq("soldier_id", soldierId));
    if (roles.length)
      maybe(await this.sb.from("soldier_load_roles").insert(roles.map((r) => ({ ...r, soldier_id: soldierId }))));
  }

  async scoreCorrections(soldierId?: string) {
    const rows = (check(await this.sb.rpc("score_corrections", { p_soldier: soldierId ?? null })) ?? []) as ScoreCorrection[];
    return rows.map((r) => ({ ...r, points: Number(r.points) }));
  }

  async addScoreCorrection(soldierId: string, cycleId: string, points: number, reason: string) {
    run(await this.sb.rpc("add_score_correction", { p_soldier: soldierId, p_cycle: cycleId, p_points: points, p_reason: reason }));
  }

  async deleteScoreCorrection(id: string) {
    run(await this.sb.rpc("delete_score_correction", { p_id: id }));
  }

  async myCommandedGafs() {
    return ((check(await this.sb.rpc("my_commanded_gafs")) as string[] | null) ?? []).map(String);
  }

  async updateSoldiersAdmin(ids: string[], patch: { phone?: string | null; range_valid_until?: string | null }) {
    if (!ids.length) return;
    run(
      await this.sb.rpc("update_soldiers_admin", {
        p_soldiers: ids,
        p_set_phone: "phone" in patch,
        p_phone: patch.phone ?? null,
        p_set_range: "range_valid_until" in patch,
        p_range: patch.range_valid_until ?? null,
      }),
    );
  }

  async setSoldierLoadRolesAdmin(soldierId: string, roles: Omit<SoldierLoadRole, "name" | "factor">[]) {
    run(await this.sb.rpc("set_soldier_load_roles_admin", { p_soldier: soldierId, p_roles: roles }));
  }

  async taskTypes(): Promise<TaskType[]> {
    const rows = check(await this.sb.from("task_types").select("*").order("name")) as TaskType[];
    const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
    return rows.map((r) => ({
      ...r,
      weight: Number(r.weight),
      default_start_time: hhmm(r.default_start_time),
      default_end_time: hhmm(r.default_end_time),
    }));
  }

  async saveTaskType(id: string | null, t: TaskTypeInput) {
    if (id) maybe(await this.sb.from("task_types").update(t).eq("id", id));
    else maybe(await this.sb.from("task_types").insert(t));
  }

  async deleteTaskType(id: string) {
    maybe(await this.sb.rpc("delete_task_type", { p_task: id }));
  }

  async dutyCategories(): Promise<NamedRef[]> {
    return check(await this.sb.from("duty_categories").select("id, name").order("name"));
  }

  async saveDutyCategory(name: string, id?: string) {
    if (id) maybe(await this.sb.from("duty_categories").update({ name }).eq("id", id));
    else maybe(await this.sb.from("duty_categories").insert({ name }));
  }

  async populations(): Promise<Population[]> {
    return check(await this.sb.from("populations").select("code, name").order("priority"));
  }

  async scoringSettings(): Promise<ScoringSettings> {
    const rows = check(await this.sb.from("settings").select("key, value").in("key", [...SCORING_KEYS])) as { key: string; value: unknown }[];
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      night_window: String(v.night_window),
      weekend_weekdays: (v.weekend_weekdays as number[]) ?? [],
      surprise_multiplier: v.surprise_multiplier == null ? 1.5 : Number(v.surprise_multiplier),
      surprise_notice_hours: v.surprise_notice_hours == null ? 72 : Number(v.surprise_notice_hours),
      exemption_deadline_days: v.exemption_deadline_days == null ? 40 : Number(v.exemption_deadline_days),
      fairness_tolerance_pct: v.fairness_tolerance_pct == null ? 20 : Number(v.fairness_tolerance_pct),
      grace_days: v.grace_days == null ? 90 : Number(v.grace_days),
      briefing_reminder_hours: v.briefing_reminder_hours == null ? 24 : Number(v.briefing_reminder_hours),
      ack_reminder_hours: v.ack_reminder_hours == null ? 48 : Number(v.ack_reminder_hours),
      ack_escalation_hours: v.ack_escalation_hours == null ? 24 : Number(v.ack_escalation_hours),
    };
  }

  async saveScoringSettings(s: ScoringSettings) {
    maybe(await this.sb.from("settings").upsert(SCORING_KEYS.map((key) => ({ key, value: s[key] }))));
  }

  async scoreMultipliers(): Promise<ScoreMultiplier[]> {
    const rows = check(
      await this.sb
        .from("score_multipliers")
        .select("id, name, value, day_types, holidays, holiday_kinds, weekdays, time_window, date_from, date_to, skip_shabbat_types, is_active, holiday_cell")
        .order("sort_order")
        .order("name"),
    ) as ScoreMultiplier[];
    return rows.map((r) => ({ ...r, value: Number(r.value) }));
  }

  async saveScoreMultiplier(id: string | null, m: ScoreMultiplierInput) {
    const row = { ...m, name: m.name.trim() };
    if (id) maybe(await this.sb.from("score_multipliers").update(row).eq("id", id));
    else maybe(await this.sb.from("score_multipliers").insert({ ...row, sort_order: 100 }));
  }

  async deleteScoreMultiplier(id: string) {
    maybe(await this.sb.from("score_multipliers").delete().eq("id", id));
  }

  async dayTypes(): Promise<DayTypeRef[]> {
    return check(await this.sb.from("day_types").select("code, name").order("name")) as DayTypeRef[];
  }

  async deleteDayType(code: string) {
    maybe(await this.sb.rpc("delete_day_type", { p_code: code }));
  }

  async addDayType(name: string) {
    const code = `custom_${Date.now().toString(36)}`;
    maybe(await this.sb.from("day_types").insert({ code, name: name.trim() }));
    return code;
  }

  async calendarDays(fromIso: string, toIso: string): Promise<CalendarDay[]> {
    return allPages<CalendarDay>((from, to) =>
      this.sb.from("calendar_days").select("day, day_type, source, note, holiday, holiday_kind").gte("day", fromIso).lte("day", toIso).order("day").range(from, to),
    );
  }

  async saveCalendarDays(days: CalendarDay[]) {
    if (days.length) maybe(await this.sb.from("calendar_days").upsert(days));
  }

  async deleteCalendarDay(day: string) {
    maybe(await this.sb.from("calendar_days").delete().eq("day", day));
  }

  // ----- cycles -----

  private async uid() {
    const { data } = await this.sb.auth.getUser();
    return data.user?.id ?? null;
  }

  async cycles(): Promise<Cycle[]> {
    return check(
      await this.sb.from("cycles").select("id, name, start_date, end_date, exemption_deadline, status, published_at, potential_computed_at").order("start_date", { ascending: false }),
    ) as Cycle[];
  }

  async saveCycle(id: string | null, c: CycleInput) {
    if (id) maybe(await this.sb.from("cycles").update(c).eq("id", id));
    else maybe(await this.sb.from("cycles").insert(c));
  }

  async cycleStages(cycleId: string): Promise<StageState[]> {
    return check(await this.sb.rpc("cycle_stages", { p_cycle: cycleId })) as StageState[];
  }

  async refreshCycleStages(): Promise<number> {
    return check(await this.sb.rpc("refresh_cycle_stages")) as number;
  }

  // ----- constraints -----

  async exemptionTypes(): Promise<ExemptionType[]> {
    return check(
      await this.sb.from("exemption_types").select("id, name, qualifies_day_only, allows_partial_restriction, home_nightly").order("name"),
    ) as ExemptionType[];
  }

  async absenceTypes(): Promise<AbsenceType[]> {
    return check(await this.sb.from("absence_types").select("id, name").order("name"));
  }

  async blockQuota() {
    const row = maybe(await this.sb.from("settings").select("value").eq("key", "block_quota_per_month").maybeSingle());
    return Number(row?.value ?? 1);
  }

  async exemptions(fromIso: string, toIso: string): Promise<Exemption[]> {
    return check(
      await this.sb
        .from("exemptions")
        .select(
          "id, soldier_id, exemption_type_id, kind, start_date, end_date, excluded_task_type_ids, restricted_hours, is_urgent, status, source, proof_checked_at, decided_at, decision_reason, received_via, received_at",
        )
        .lte("start_date", toIso)
        .gte("end_date", fromIso)
        .order("start_date"),
    ) as Exemption[];
  }

  async addExemption(e: ExemptionInput) {
    maybe(
      await this.sb.from("exemptions").insert({
        ...e,
        excluded_task_type_ids: e.kind === "partial" && e.excluded_task_type_ids?.length ? e.excluded_task_type_ids : null,
        restricted_hours: e.kind === "partial" ? e.restricted_hours : null,
        status: "pending",
        source: "coordinator",
        received_at: new Date().toISOString(),
      }),
    );
  }

  async markProofChecked(id: string) {
    maybe(await this.sb.from("exemptions").update({ proof_checked_at: new Date().toISOString(), proof_checked_by: await this.uid() }).eq("id", id));
  }

  async decideExemption(id: string, d: ExemptionDecision) {
    const base = { decided_at: new Date().toISOString(), decided_by: await this.uid() };
    const patch =
      d.action === "approve"
        ? { ...base, status: "approved", decision_reason: null }
        : { ...base, status: d.action === "reject" ? "rejected" : "cancelled", decision_reason: d.reason };
    maybe(await this.sb.from("exemptions").update(patch).eq("id", id));
  }

  async absences(fromIso: string, toIso: string): Promise<Absence[]> {
    return check(
      await this.sb
        .from("absences")
        .select("id, soldier_id, absence_type_id, starts_at, ends_at, status, cancel_reason, received_via")
        .lt("starts_at", localMidnight(addDaysIso(toIso, 1)))
        .gt("ends_at", localMidnight(fromIso))
        .order("starts_at"),
    ) as Absence[];
  }

  async addAbsences(rows: AbsenceInput[]) {
    if (!rows.length) return;
    const now = new Date().toISOString();
    maybe(
      await this.sb.from("absences").insert(
        rows.map((a) => ({
          soldier_id: a.soldier_id,
          absence_type_id: a.absence_type_id,
          ...absenceSpan(a),
          received_via: a.received_via,
          received_at: now,
        })),
      ),
    );
  }

  async cancelAbsence(id: string, reason: string) {
    maybe(await this.sb.from("absences").update({ status: "cancelled", cancel_reason: reason, cancelled_by: await this.uid() }).eq("id", id));
  }

  async dateBlocks(fromIso: string, toIso: string): Promise<DateBlock[]> {
    return check(
      await this.sb
        .from("date_blocks")
        .select("id, soldier_id, cycle_id, day, status, received_via")
        .gte("day", fromIso)
        .lte("day", toIso)
        .order("day"),
    ) as DateBlock[];
  }

  async addDateBlocks(rows: DateBlockInput[], cycleId: string | null) {
    if (!rows.length) return;
    const now = new Date().toISOString();
    const { error } = await this.sb
      .from("date_blocks")
      .insert(rows.map((b) => ({ ...b, cycle_id: cycleId, received_at: now })));
    if (error) throw new Error(error.code === "23505" ? "לעובד כבר יש חסימה בחודש הזה" : error.message);
  }

  async cancelDateBlock(id: string) {
    maybe(await this.sb.from("date_blocks").update({ status: "cancelled" }).eq("id", id));
  }

  // ----- potential -----

  async computePotential(cycleId: string) {
    return Number(check(await this.sb.rpc("compute_potential", { p_cycle: cycleId })));
  }

  async potentialCellWhy(cycleId: string, soldierId: string, taskTypeId: string): Promise<PotentialWhy[]> {
    return check(await this.sb.rpc("potential_cell_why", { p_cycle: cycleId, p_soldier: soldierId, p_task_type: taskTypeId })) as PotentialWhy[];
  }

  async orderInversions(cycleId: string): Promise<Inversion[]> {
    return check(await this.sb.rpc("order_inversions", { p_cycle: cycleId })) as Inversion[];
  }

  async potentialMatrix(cycleId: string): Promise<PotentialCell[]> {
    const rows = await allPages<PotentialCell>((from, to) =>
      this.sb.rpc("potential_matrix", { p_cycle: cycleId }).order("soldier_id").order("category_id").range(from, to),
    );
    return rows.map((r) => ({
      ...r,
      value: Number(r.value),
      override_value: r.override_value === null ? null : Number(r.override_value),
      // a gaf commander gets no reasons for soldiers of other gafs (null): no reasons to show
      reasons: r.reasons ?? [],
    }));
  }

  async potentialDaily(cycleId: string): Promise<DailyAvailability[]> {
    // a half-year × the categories is ~1,500 rows: past one page
    return allPages<DailyAvailability>((from, to) =>
      this.sb.rpc("potential_daily", { p_cycle: cycleId }).order("day").order("category_id").range(from, to),
    );
  }

  async recentHolidayDuties(sinceIso: string): Promise<HolidayDuty[]> {
    return check(await this.sb.rpc("recent_holiday_duties", { p_since: sinceIso })) as HolidayDuty[];
  }

  async snapshotSoldiers(cycleId: string): Promise<SnapshotSoldier[]> {
    const [rows, credits] = await Promise.all([
      this.sb
        .from("cycle_soldier_snapshot")
        .select("soldier_id, service_type, is_parent, qualifies_day_only, balance_population, baseline_score, fairness_group, fairness_label, rank:ranks(name)")
        .eq("cycle_id", cycleId)
        .then(check) as Promise<(Omit<SnapshotSoldier, "rank_name"> & { rank: { name: string } | null })[]>,
      this.sb.from("cycle_credits").select("soldier_id, days, points").eq("cycle_id", cycleId).then(check) as Promise<
        { soldier_id: string; days: number; points: number }[]
      >,
    ]);
    const cr = new Map(credits.map((c) => [c.soldier_id, c]));
    return rows.map(({ rank, ...r }) => ({
      ...r,
      baseline_score: Number(r.baseline_score),
      rank_name: rank?.name ?? "",
      credit_days: cr.get(r.soldier_id)?.days ?? 0,
      credit: Number(cr.get(r.soldier_id)?.points ?? 0),
    }));
  }

  async setPotentialOverride(cycleId: string, soldierId: string, categoryId: string, value: number, reason: string) {
    maybe(
      await this.sb.from("potential_overrides").upsert({
        cycle_id: cycleId,
        soldier_id: soldierId,
        category_id: categoryId,
        value,
        reason,
        created_by: await this.uid(),
        created_at: new Date().toISOString(),
      }),
    );
  }

  async clearPotentialOverride(cycleId: string, soldierId: string, categoryId: string) {
    maybe(
      await this.sb.from("potential_overrides").delete().eq("cycle_id", cycleId).eq("soldier_id", soldierId).eq("category_id", categoryId),
    );
  }

  // ----- base schedule -----

  async rankRefs(): Promise<RankRef[]> {
    return check(await this.sb.from("ranks").select("id, name, sort_order, aliases").order("sort_order")) as RankRef[];
  }

  async taskTypeAliases(): Promise<Alias[]> {
    return check(await this.sb.from("task_type_aliases").select("alias, task_type_id")) as Alias[];
  }

  async saveTaskTypeAliases(aliases: Alias[]) {
    if (aliases.length) maybe(await this.sb.from("task_type_aliases").upsert(aliases));
  }

  async cycleSlots(cycleId: string): Promise<SlotRow[]> {
    // a half-year of a larger unit passes 1,000 duties
    const rows = (await allPages((from, to) =>
      this.sb
        .from("slots")
        .select(
          "id, task_type_id, starts_at, ends_at, performers_needed, reserves_needed, allowed_rank_ids, gender, instructions, notes, source_line, prefer_home_nightly, daily_hours, briefing_at, is_surprise, special_name, fixed_points, assignments(status)",
        )
        .eq("cycle_id", cycleId)
        .is("cancelled_at", null)
        .order("starts_at")
        .order("id")
        .range(from, to),
    )) as unknown as (Omit<SlotRow, "assigned"> & { assignments: { status: string }[] })[];
    return rows.map(({ assignments, ...r }) => ({ ...r, assigned: assignments.filter((a) => a.status !== "draft").length }));
  }

  async importSlots(cycleId: string, slots: SlotDraft[], replace: boolean, fileName: string) {
    let deleted = 0;
    if (replace) {
      const free = (await this.cycleSlots(cycleId)).filter((s) => s.assigned === 0).map((s) => s.id);
      for (let i = 0; i < free.length; i += 200) maybe(await this.sb.from("slots").delete().in("id", free.slice(i, i + 200)));
      deleted = free.length;
    }
    const imp = check(
      await this.sb
        .from("roster_imports")
        .insert({ kind: "base_slots", status: "applied", summary: { file: fileName, slots: slots.length, replaced: deleted, cycle_id: cycleId } })
        .select("id")
        .single(),
    ) as { id: string };
    const rows = slots.map((d) => ({
      cycle_id: cycleId,
      task_type_id: d.task_type_id,
      starts_at: d.starts_at,
      ends_at: d.ends_at,
      performers_needed: d.performers_needed,
      reserves_needed: d.reserves_needed,
      allowed_rank_ids: d.allowed_rank_ids,
      prefer_home_nightly: d.prefer_home_nightly,
      daily_hours: d.daily_hours,
      briefing_at: d.briefing_at,
      gender: d.gender,
      instructions: d.instructions,
      notes: d.notes,
      import_id: imp.id,
      source_line: d.line,
    }));
    for (let i = 0; i < rows.length; i += 200) maybe(await this.sb.from("slots").insert(rows.slice(i, i + 200)));
    return { inserted: rows.length, deleted };
  }

  async deleteTaskTypeAlias(alias: string) {
    maybe(await this.sb.from("task_type_aliases").delete().eq("alias", alias));
  }

  async deleteSlots(ids: string[]) {
    if (ids.length) maybe(await this.sb.from("slots").delete().in("id", ids));
  }

  // ----- scheduling runs -----

  async scheduleJobs(cycleId: string): Promise<ScheduleJob[]> {
    const rows = check(
      await this.sb
        .from("schedule_jobs")
        .select(
          "id, status, kind, progress, created_at, started_at, finished_at, error, params, result_status:result->>status, wall_time:result->wall_time_seconds, unfilled:result->unfilled, warnings:result->warnings, diagnosis:result->>diagnosis, pools:result->pools",
        )
        .eq("cycle_id", cycleId)
        .order("created_at", { ascending: false })
        .limit(10),
    ) as unknown as ScheduleJob[];
    return rows.map((r) => ({ ...r, wall_time: r.wall_time === null ? null : Number(r.wall_time) }));
  }

  async requestSchedule(cycleId: string, kind: "full" | "stability" | "update" = "full") {
    return String(check(await this.sb.rpc("request_schedule", { p_cycle: cycleId, p_kind: kind })));
  }

  async addSlot(cycleId: string, k: NewSlot) {
    maybe(await this.sb.from("slots").insert({ ...k, cycle_id: cycleId }));
  }

  async setSlotNote(slotId: string, note: string | null) {
    run(await this.sb.rpc("set_slot_note", { p_slot: slotId, p_note: note }));
  }

  async updateSpecialSlot(slotId: string, name: string, points: number) {
    run(await this.sb.rpc("update_special_slot", { p_slot: slotId, p_name: name, p_points: points }));
  }

  async slotPeople(slotId: string): Promise<SlotPeople | null> {
    const { data: sl, error } = await this.sb
      .from("slots")
      .select("id, cycle_id, starts_at, ends_at, special_name, fixed_points, instructions, task_types(name), cycles(status)")
      .eq("id", slotId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sl) return null;
    const rows = check(
      await this.sb.from("assignments").select("id, role, status, replaced_assignment_id, is_surprise, soldiers(full_name)").eq("slot_id", slotId).neq("status", "draft"),
    ) as unknown as { id: string; role: "performer" | "reserve"; status: string; replaced_assignment_id: string | null; is_surprise: boolean; soldiers: { full_name: string } | null }[];
    const s = sl as unknown as { id: string; cycle_id: string; starts_at: string; ends_at: string; special_name: string | null; fixed_points: number | null; instructions: string | null; task_types: { name: string } | null; cycles: { status: string } | null };
    return {
      slot: {
        id: s.id,
        cycle_id: s.cycle_id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        task_name: s.special_name ?? s.task_types?.name ?? "",
        special_name: s.special_name,
        fixed_points: s.fixed_points === null ? null : Number(s.fixed_points),
        published: s.cycles?.status === "published",
        note: s.instructions,
      },
      people: rows.map((r) => ({ id: r.id, name: r.soldiers?.full_name ?? "?", role: r.role, status: r.status, replaced_id: r.replaced_assignment_id, is_surprise: r.is_surprise })),
    };
  }

  async deleteSlot(slotId: string, reason?: string) {
    run(await this.sb.rpc("delete_slot", { p_slot: slotId, p_reason: reason ?? null }));
  }

  async deletePendingSlot(slotId: string) {
    maybe(await this.sb.rpc("delete_pending_slot", { p_slot: slotId }));
  }

  async unassignPublished(assignmentId: string, reason: string) {
    maybe(await this.sb.rpc("unassign_published", { p_assignment: assignmentId, p_reason: reason }));
  }

  async undoReserveActivation(reserveId: string) {
    maybe(await this.sb.rpc("undo_reserve_activation", { p_reserve: reserveId }));
  }

  async activateReserve(reserveId: string, fromUnit: number, performerId: string | null, note: string | null) {
    maybe(await this.sb.rpc("activate_reserve", { p_reserve: reserveId, p_from_unit: fromUnit, p_performer: performerId, p_note: note }));
  }

  async publishAdditions(cycleId: string) {
    return Number(check(await this.sb.rpc("publish_additions", { p_cycle: cycleId })));
  }

  async redispatchSchedule(jobId: string) {
    return String(check(await this.sb.rpc("redispatch_schedule", { p_job: jobId })));
  }

  async cancelScheduleJob(jobId: string) {
    maybe(await this.sb.rpc("cancel_schedule_job", { p_job: jobId }));
  }

  async dispatchConfigured() {
    return Boolean(maybe(await this.sb.rpc("dispatch_configured")));
  }

  async dispatchResponse(jobId: string) {
    return maybe(await this.sb.rpc("schedule_dispatch_response", { p_job: jobId })) as {
      status_code: number | null;
      error: string | null;
      body: string | null;
    } | null;
  }

  // ----- draft editor -----

  async draftAssignments(cycleId: string): Promise<DraftAssignment[]> {
    const out: DraftAssignment[] = [];
    // paged: a half-year cycle has ~600 rows, above PostgREST's default page in some setups
    for (let from = 0; ; from += 1000) {
      const rows = check(
        await this.sb
          .from("assignments")
          .select("id, slot_id, soldier_id, role, status, source, points, normalized_points, weekend_units, explanation, manual_reason, is_surprise, slots!inner(cycle_id)")
          .eq("slots.cycle_id", cycleId)
          .not("status", "in", "(dropped,cancelled_approved,swapped_out)")
          .range(from, from + 999),
      ) as unknown as (DraftAssignment & { slots: unknown })[];
      out.push(
        ...rows.map(({ slots: _s, ...r }) => ({ ...r, points: Number(r.points), normalized_points: Number(r.normalized_points) })),
      );
      if (rows.length < 1000) break;
    }
    return out;
  }

  async slotCandidates(slotId: string): Promise<Candidate[]> {
    const rows = check(await this.sb.rpc("slot_candidates", { p_slot: slotId })) as Candidate[];
    return rows.map((r) => ({ ...r, cycle_points: Number(r.cycle_points), conflicts: r.conflicts ?? [] }));
  }

  async assignPublished(slotId: string, role: DraftRole, soldierId: string, reason: string | null): Promise<string> {
    return check(await this.sb.rpc("assign_published", { p_slot: slotId, p_role: role, p_soldier: soldierId, p_reason: reason })) as string;
  }

  async manualAssign(slotId: string, role: DraftRole, soldierId: string, replaceId: string | null, reason: string) {
    return String(
      check(await this.sb.rpc("manual_assign", { p_slot: slotId, p_role: role, p_soldier: soldierId, p_replace: replaceId, p_reason: reason })),
    );
  }

  async removeAssignment(assignmentId: string, reason: string) {
    maybe(await this.sb.rpc("remove_assignment", { p_assignment: assignmentId, p_reason: reason }));
  }

  async publishCycle(cycleId: string) {
    return Number(check(await this.sb.rpc("publish_cycle", { p_cycle: cycleId })));
  }

  async listUsers(): Promise<AppUser[]> {
    return check(await this.sb.rpc("list_users")) as AppUser[];
  }

  async createUser(username: string, password: string, soldierId: string | null, role: CreatableRole = "gaf_commander") {
    return check(await this.sb.rpc("create_user", { p_username: username, p_password: password, p_role: role, p_soldier: soldierId })) as string;
  }

  async resetUserMfa(userId: string) {
    maybe(await this.sb.rpc("reset_user_mfa", { p_user: userId }));
  }

  async grantUserRole(userId: string, role: CreatableRole) {
    maybe(await this.sb.rpc("grant_user_role", { p_user: userId, p_role: role }));
  }

  async revokeUserRole(userId: string, role: Role) {
    maybe(await this.sb.rpc("revoke_user_role", { p_user: userId, p_role: role }));
  }

  async addSoldier(row: AddSoldierRow): Promise<AddSoldierResult> {
    return check(await this.sb.rpc("add_soldier", { p: row })) as AddSoldierResult;
  }

  async reactivateSoldier(soldierId: string, joinDate: string) {
    maybe(await this.sb.rpc("reactivate_soldier", { p_soldier: soldierId, p_join: joinDate }));
  }

  async removeFromUnitMany(soldierIds: string[], fromDay: string) {
    return check(await this.sb.rpc("remove_from_unit_many", { p_soldiers: soldierIds, p_from: fromDay })) as {
      removed: number;
      duties_dropped: number;
    };
  }

  async deleteSoldiers(soldierIds: string[]) {
    return check(await this.sb.rpc("delete_soldiers", { p_soldiers: soldierIds })) as {
      deleted: number;
      accounts: number;
      blocked: { id: string; name: string }[];
    };
  }

  async removeFromUnit(soldierId: string, fromDay: string): Promise<number> {
    return check(await this.sb.rpc("remove_from_unit", { p_soldier: soldierId, p_from: fromDay })) as number;
  }

  async futureDuties(soldierId: string, fromDay: string): Promise<number> {
    return check(await this.sb.rpc("future_duties", { p_soldier: soldierId, p_from: fromDay })) as number;
  }

  async resetUserPassword(userId: string, password: string) {
    maybe(await this.sb.rpc("reset_user_password", { p_user: userId, p_password: password }));
  }

  async setCommanderGaf(userId: string, gafId: string | null): Promise<void> {
    check(await this.sb.rpc("set_commander_gaf", { p_user: userId, p_gaf: gafId }));
  }

  async renameUser(userId: string, username: string): Promise<void> {
    run(await this.sb.rpc("rename_user", { p_user: userId, p_username: username }));
  }

  async deleteUser(userId: string) {
    return check(await this.sb.rpc("delete_user", { p_user: userId })) as "deleted" | "closed";
  }

  async setUserLocked(userId: string, locked: boolean) {
    maybe(await this.sb.rpc("set_user_locked", { p_user: userId, p_locked: locked }));
  }

  async setUserSoldier(userId: string, soldierId: string | null) {
    maybe(await this.sb.rpc("set_user_soldier", { p_user: userId, p_soldier: soldierId }));
  }

  async unpublishCycle(cycleId: string) {
    return Number(check(await this.sb.rpc("unpublish_cycle", { p_cycle: cycleId })));
  }

  async markInvitesSent(soldierIds: string[]) {
    run(await this.sb.rpc("mark_invites_sent", { p_soldiers: soldierIds }));
  }

  async createSoldierInvites(soldierIds: string[], days: number) {
    return check(await this.sb.rpc("create_soldier_invites", { p_soldiers: soldierIds, p_days: days })) as { soldier_id: string; code: string }[];
  }

  async revokeSoldierInvites(soldierIds: string[]) {
    return Number(check(await this.sb.rpc("revoke_soldier_invites", { p_soldiers: soldierIds })));
  }

  async soldierAccounts(): Promise<SoldierAccount[]> {
    return check(await this.sb.rpc("soldier_account_status")) as SoldierAccount[];
  }

  async redeemInvite(code: string, username: string, password: string) {
    return check(await this.sb.rpc("redeem_invite", { p_code: code, p_username: username, p_password: password })) as string;
  }

  async myDuties(): Promise<MyDuty[]> {
    return (check(await this.sb.rpc("my_duties")) as MyDuty[]).map((d) => ({ ...d, points: Number(d.points) }));
  }

  async swapOptions(assignmentId: string): Promise<SwapOptions> {
    return check(await this.sb.rpc("swap_options", { p_assignment: assignmentId })) as SwapOptions;
  }

  async requestSwap(assignmentId: string, targetSoldierId: string, counterAssignmentId: string | null = null): Promise<string> {
    return check(await this.sb.rpc("request_swap", { p_assignment: assignmentId, p_target: targetSoldierId, p_counter: counterAssignmentId })) as string;
  }

  async answerSwap(requestId: string, accept: boolean) {
    return check(await this.sb.rpc("answer_swap", { p_request: requestId, p_accept: accept })) as { status: string; reason?: string };
  }

  async cancelSwap(requestId: string) {
    maybe(await this.sb.rpc("cancel_swap", { p_request: requestId }));
  }

  async mySwaps(): Promise<MySwap[]> {
    return check(await this.sb.rpc("my_swaps")) as MySwap[];
  }

  async swapLog(): Promise<SwapLogRow[]> {
    return check(await this.sb.rpc("swap_log")) as SwapLogRow[];
  }

  async myInputOptions(): Promise<InputOptions> {
    return check(await this.sb.rpc("my_input_options")) as InputOptions;
  }

  async myRequests(): Promise<MyRequests> {
    return check(await this.sb.rpc("my_requests")) as MyRequests;
  }

  async submitExemption(typeId: string, from: string, to: string) {
    maybe(await this.sb.rpc("submit_exemption", { p_type: typeId, p_start: from, p_end: to }));
  }

  async withdrawMyExemption(id: string) {
    maybe(await this.sb.rpc("withdraw_my_exemption", { p_id: id }));
  }

  async addMyDateBlock(day: string) {
    maybe(await this.sb.rpc("add_my_date_block", { p_day: day }));
  }

  async cancelMyDateBlock(id: string) {
    maybe(await this.sb.rpc("cancel_my_date_block", { p_id: id }));
  }

  async addMyAbsence(typeId: string, from: string, to: string) {
    maybe(await this.sb.rpc("add_my_absence", { p_type: typeId, p_from: from, p_to: to }));
  }

  async cancelMyAbsence(id: string) {
    maybe(await this.sb.rpc("cancel_my_absence", { p_id: id }));
  }

  async unitDashboard(): Promise<UnitDashboard> {
    return check(await this.sb.rpc("unit_dashboard")) as UnitDashboard;
  }

  async myNotifications(): Promise<AppNotification[]> {
    return check(await this.sb.rpc("my_notifications")) as AppNotification[];
  }

  async markNotificationsRead(ids: string[] | null) {
    maybe(await this.sb.rpc("mark_notifications_read", { p_ids: ids }));
  }

  async ackNotification(id: string) {
    maybe(await this.sb.rpc("ack_notification", { p_id: id }));
  }

  async vapidPublicKey() {
    return (check(await this.sb.rpc("vapid_public_key")) as string | null) ?? null;
  }

  async savePushSubscription(s: { endpoint: string; p256dh: string; auth: string }) {
    maybe(await this.sb.rpc("save_push_subscription", { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_user_agent: navigator.userAgent }));
  }

  async deletePushSubscription(endpoint: string) {
    maybe(await this.sb.rpc("delete_push_subscription", { p_endpoint: endpoint }));
  }

  async scoringRules(): Promise<ScoringRules> {
    const { data, error } = await this.sb.rpc("scoring_rules");
    if (error) throw error;
    const r = data as ScoringRules;
    return {
      ...r,
      tasks: r.tasks.map((t) => ({ ...t, weight: Number(t.weight) })),
      additions: r.additions.map((a) => ({ ...a, value: Number(a.value) })).filter((a) => a.value > 0),
      surprise_multiplier: Number(r.surprise_multiplier),
      fairness_tolerance_pct: Number(r.fairness_tolerance_pct),
    };
  }

  async ackDuties(assignmentIds: string[]): Promise<number> {
    return check(await this.sb.rpc("ack_duties", { p_ids: assignmentIds })) as number;
  }

  async staffAck(assignmentId: string) {
    maybe(await this.sb.rpc("staff_ack", { p_assignment: assignmentId }));
  }

  async unackedDuties(hours = 72): Promise<UnackedDuty[]> {
    return check(await this.sb.rpc("unacked_duties", { p_hours: hours })) as UnackedDuty[];
  }

  async dutyMessage(q: { soldierId?: string; assignmentId?: string; cycleId?: string }): Promise<DutyMessage> {
    return check(
      await this.sb.rpc("duty_message", { p_soldier: q.soldierId ?? null, p_assignment: q.assignmentId ?? null, p_cycle: q.cycleId ?? null }),
    ) as DutyMessage;
  }

  async noAccountDuties(cycleId: string): Promise<NoAccountRow[]> {
    return check(await this.sb.rpc("no_account_duties", { p_cycle: cycleId })) as NoAccountRow[];
  }

  async myScores(): Promise<MyScore[]> {
    return (check(await this.sb.rpc("my_scores")) as MyScore[]).map((x) => ({
      ...x,
      points: Number(x.points),
      group_mean: x.group_mean === null ? null : Number(x.group_mean),
    }));
  }
}

import type { MyDuty, MyScore, SoldierAccount } from "./me";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Api, ApplyResult, BoardRow, HolidayDuty, Me, MfaState, NamedRef, Role, SlotPeople } from "./api";
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
import type { AppUser } from "./users";
import type { Candidate, DraftAssignment, Role as DraftRole } from "./draft";
import type { ScheduleJob } from "./schedule";
import type { DailyAvailability, PotentialCell, SnapshotSoldier } from "./potential";
import type { ExistingSoldier, RosterPlan, SoldierRecord } from "./roster";
import type { LoadRoleRef, SoldierDetail, SoldierLoadRole, SoldierPatch } from "./soldiers";

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null || res.data === undefined) throw new Error("no data returned");
  return res.data as NonNullable<T>;
}

/** For queries where "no row" is a valid answer (maybeSingle). */
function maybe<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
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
    await this.sb.rpc("touch_last_login");
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async me(): Promise<Me | null> {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) return null;
    const uid = data.user.id;
    const user = maybe(await this.sb.from("app_users").select("username, must_change_password").eq("id", uid).maybeSingle());
    if (!user) return null;
    const now = Date.now();
    const roles = check(await this.sb.from("user_roles").select("role, valid_from, valid_to").eq("user_id", uid)) as {
      role: Role;
      valid_from: string | null;
      valid_to: string | null;
    }[];
    const active = roles
      .filter((r) => (!r.valid_from || Date.parse(r.valid_from) <= now) && (!r.valid_to || Date.parse(r.valid_to) > now))
      .map((r) => r.role);
    return { userId: uid, username: user.username, roles: active, mustChangePassword: user.must_change_password };
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
    return check(
      await this.sb.from("published_board").select("*").gte("starts_at", fromIso).lt("starts_at", toIso).order("starts_at"),
    ) as BoardRow[];
  }

  async soldiers(): Promise<ExistingSoldier[]> {
    const rows = check(
      await this.sb
        .from("soldiers")
        .select(
          "id, soldier_key, full_name, service_type, gender, enlistment_date, release_date, career_start_date, range_valid_until, parent_status, home_nightly, is_active, gaf:org_units!soldiers_gaf_id_fkey(name), rank:ranks!soldiers_computed_rank_id_fkey(name)",
        ),
    ) as unknown as (Omit<ExistingSoldier, "gaf_name" | "rank_name"> & { gaf: { name: string }; rank: { name: string } | null })[];
    return rows.map(({ gaf, rank, ...s }) => ({ ...s, gaf_name: gaf.name, rank_name: rank?.name ?? "" }));
  }

  async gafim(): Promise<NamedRef[]> {
    return check(await this.sb.from("org_units").select("id, name").eq("kind", "gaf").is("active_to", null).order("name"));
  }

  async ranks(): Promise<NamedRef[]> {
    return check(await this.sb.from("ranks").select("id, name").order("sort_order"));
  }

  async unitKeyCheck() {
    const row = maybe(await this.sb.from("settings").select("value").eq("key", "unit_key_check").maybeSingle());
    return (row?.value as string | null) ?? null;
  }

  async setUnitKeyCheck(value: string) {
    maybe(await this.sb.from("settings").upsert({ key: "unit_key_check", value }));
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
           home_nightly, home_nightly_override, home_nightly_override_reason, home_nightly_override_until, tash_level, unit_join_date, opening_score,
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
      exemption_deadline_days: v.exemption_deadline_days == null ? 40 : Number(v.exemption_deadline_days),
      fairness_tolerance_pct: v.fairness_tolerance_pct == null ? 20 : Number(v.fairness_tolerance_pct),
      grace_days: v.grace_days == null ? 90 : Number(v.grace_days),
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
    return check(
      await this.sb.from("calendar_days").select("day, day_type, source, note, holiday, holiday_kind").gte("day", fromIso).lte("day", toIso).order("day"),
    ) as CalendarDay[];
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
    if (error) throw new Error(error.code === "23505" ? "לחייל כבר יש חסימה בחודש הזה" : error.message);
  }

  async cancelDateBlock(id: string) {
    maybe(await this.sb.from("date_blocks").update({ status: "cancelled" }).eq("id", id));
  }

  // ----- potential -----

  async computePotential(cycleId: string) {
    return Number(check(await this.sb.rpc("compute_potential", { p_cycle: cycleId })));
  }

  async potentialMatrix(cycleId: string): Promise<PotentialCell[]> {
    const rows = check(await this.sb.rpc("potential_matrix", { p_cycle: cycleId })) as PotentialCell[];
    return rows.map((r) => ({
      ...r,
      value: Number(r.value),
      override_value: r.override_value === null ? null : Number(r.override_value),
    }));
  }

  async potentialDaily(cycleId: string): Promise<DailyAvailability[]> {
    return check(await this.sb.rpc("potential_daily", { p_cycle: cycleId })) as DailyAvailability[];
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
    return check(await this.sb.from("ranks").select("id, name, sort_order").order("sort_order")) as RankRef[];
  }

  async taskTypeAliases(): Promise<Alias[]> {
    return check(await this.sb.from("task_type_aliases").select("alias, task_type_id")) as Alias[];
  }

  async saveTaskTypeAliases(aliases: Alias[]) {
    if (aliases.length) maybe(await this.sb.from("task_type_aliases").upsert(aliases));
  }

  async cycleSlots(cycleId: string): Promise<SlotRow[]> {
    const rows = check(
      await this.sb
        .from("slots")
        .select(
          "id, task_type_id, starts_at, ends_at, performers_needed, reserves_needed, allowed_rank_ids, gender, instructions, notes, source_line, prefer_home_nightly, daily_hours, briefing_at, is_surprise, special_name, fixed_points, assignments(status)",
        )
        .eq("cycle_id", cycleId)
        .is("cancelled_at", null)
        .order("starts_at"),
    ) as unknown as (Omit<SlotRow, "assigned"> & { assignments: { status: string }[] })[];
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

  async updateSpecialSlot(slotId: string, name: string, points: number) {
    check(await this.sb.rpc("update_special_slot", { p_slot: slotId, p_name: name, p_points: points }));
  }

  async slotPeople(slotId: string): Promise<SlotPeople | null> {
    const { data: sl, error } = await this.sb
      .from("slots")
      .select("id, cycle_id, starts_at, ends_at, special_name, fixed_points, task_types(name), cycles(status)")
      .eq("id", slotId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sl) return null;
    const rows = check(
      await this.sb.from("assignments").select("id, role, status, replaced_assignment_id, soldiers(full_name)").eq("slot_id", slotId).neq("status", "draft"),
    ) as unknown as { id: string; role: "performer" | "reserve"; status: string; replaced_assignment_id: string | null; soldiers: { full_name: string } | null }[];
    const s = sl as unknown as { id: string; cycle_id: string; starts_at: string; ends_at: string; special_name: string | null; fixed_points: number | null; task_types: { name: string } | null; cycles: { status: string } | null };
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
      },
      people: rows.map((r) => ({ id: r.id, name: r.soldiers?.full_name ?? "?", role: r.role, status: r.status, replaced_id: r.replaced_assignment_id })),
    };
  }

  async deleteSlot(slotId: string, reason?: string) {
    check(await this.sb.rpc("delete_slot", { p_slot: slotId, p_reason: reason ?? null }));
  }

  async deletePendingSlot(slotId: string) {
    maybe(await this.sb.rpc("delete_pending_slot", { p_slot: slotId }));
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
          .select("id, slot_id, soldier_id, role, status, source, points, normalized_points, weekend_units, explanation, manual_reason, slots!inner(cycle_id)")
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

  async createUser(username: string, password: string, soldierId: string | null) {
    return check(await this.sb.rpc("create_user", { p_username: username, p_password: password, p_role: "gaf_commander", p_soldier: soldierId })) as string;
  }

  async resetUserPassword(userId: string, password: string) {
    maybe(await this.sb.rpc("reset_user_password", { p_user: userId, p_password: password }));
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

  async myScores(): Promise<MyScore[]> {
    return (check(await this.sb.rpc("my_scores")) as MyScore[]).map((x) => ({
      ...x,
      points: Number(x.points),
      group_mean: x.group_mean === null ? null : Number(x.group_mean),
    }));
  }
}

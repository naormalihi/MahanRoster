import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Api, ApplyResult, BoardRow, Me, MfaState, NamedRef, Role } from "./api";
import { usernameToEmail } from "./api";
import { SCORING_KEYS, type CalendarDay, type Population, type ScoringSettings, type TaskType, type TaskTypeInput } from "./catalog";
import {
  absenceSpan,
  localMidnight,
  addDaysIso,
  type Absence,
  type AbsenceInput,
  type AbsenceType,
  type Cycle,
  type CycleInput,
  type CycleStatus,
  type DateBlock,
  type DateBlockInput,
  type Exemption,
  type ExemptionDecision,
  type ExemptionInput,
  type ExemptionType,
} from "./cycles";
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
          "id, soldier_key, full_name, service_type, gender, enlistment_date, release_date, career_start_date, range_valid_until, parent_status, is_active, gaf:org_units!soldiers_gaf_id_fkey(name), rank:ranks!soldiers_computed_rank_id_fkey(name)",
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
      is_active: true,
    });
    if (plan.added.length) maybe(await this.sb.from("soldiers").insert(plan.added.map(toRow)));
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

  async dutyCategories(): Promise<NamedRef[]> {
    return check(await this.sb.from("duty_categories").select("id, name").order("name"));
  }

  async populations(): Promise<Population[]> {
    return check(await this.sb.from("populations").select("code, name").order("priority"));
  }

  async scoringSettings(): Promise<ScoringSettings> {
    const rows = check(await this.sb.from("settings").select("key, value").in("key", [...SCORING_KEYS])) as { key: string; value: unknown }[];
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      weekend_multiplier: Number(v.weekend_multiplier),
      holiday_multiplier: Number(v.holiday_multiplier),
      night_multiplier: Number(v.night_multiplier),
      night_window: String(v.night_window),
      weekend_weekdays: (v.weekend_weekdays as number[]) ?? [],
    };
  }

  async saveScoringSettings(s: ScoringSettings) {
    maybe(await this.sb.from("settings").upsert(SCORING_KEYS.map((key) => ({ key, value: s[key] }))));
  }

  async calendarDays(fromIso: string, toIso: string): Promise<CalendarDay[]> {
    return check(
      await this.sb.from("calendar_days").select("day, day_type, source, note").gte("day", fromIso).lte("day", toIso).order("day"),
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

  async setCycleStatus(id: string, status: CycleStatus) {
    maybe(await this.sb.from("cycles").update({ status }).eq("id", id));
  }

  // ----- constraints -----

  async exemptionTypes(): Promise<ExemptionType[]> {
    return check(
      await this.sb.from("exemption_types").select("id, name, qualifies_day_only, allows_partial_restriction").order("name"),
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

  async snapshotSoldiers(cycleId: string): Promise<SnapshotSoldier[]> {
    const rows = check(
      await this.sb
        .from("cycle_soldier_snapshot")
        .select("soldier_id, service_type, is_parent, qualifies_day_only, rank:ranks(name)")
        .eq("cycle_id", cycleId),
    ) as unknown as (Omit<SnapshotSoldier, "rank_name"> & { rank: { name: string } | null })[];
    return rows.map(({ rank, ...r }) => ({ ...r, rank_name: rank?.name ?? "" }));
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
}

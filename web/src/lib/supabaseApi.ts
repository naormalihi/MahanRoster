import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Api, ApplyResult, BoardRow, Me, MfaState, NamedRef, Role } from "./api";
import { usernameToEmail } from "./api";
import type { ExistingSoldier, RosterPlan, SoldierRecord } from "./roster";

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
}

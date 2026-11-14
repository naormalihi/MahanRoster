/** The soldier record as the soldiers screen shows and edits it. */

export interface SoldierLoadRole {
  load_role_id: string;
  name: string;
  factor: number;
  valid_from: string;
  valid_to: string | null;
}

export interface SoldierDetail {
  id: string;
  full_name: string;
  service_type: "mandatory" | "career";
  gender: "male" | "female" | null;
  gaf_id: string;
  gaf_name: string;
  rank_name: string;
  appointment_rank_id: string | null;
  appointment_rank_until: string | null;
  enlistment_date: string | null;
  release_date: string | null;
  career_start_date: string | null;
  range_valid_until: string | null;
  is_shachar: boolean;
  shachar_start_date: string | null;
  parent_status: boolean;
  parent_override: boolean | null;
  parent_override_reason: string | null;
  parent_override_until: string | null;
  second_role_signed_at: string | null;
  home_nightly: boolean;
  home_nightly_override: boolean | null;
  home_nightly_override_reason: string | null;
  home_nightly_override_until: string | null;
  /** הת"ש 3–7: nights a week he must sleep at home */
  tash_level: number | null;
  is_active: boolean;
  load_roles: SoldierLoadRole[];
}

/** Fields נע"ת may change on the soldiers screen (the rest comes from the HR file). */
export type SoldierPatch = Partial<
  Pick<
    SoldierDetail,
    | "range_valid_until"
    | "appointment_rank_id"
    | "appointment_rank_until"
    | "is_shachar"
    | "shachar_start_date"
    | "parent_override"
    | "parent_override_reason"
    | "parent_override_until"
    | "second_role_signed_at"
    | "home_nightly_override"
    | "home_nightly_override_reason"
    | "home_nightly_override_until"
    | "tash_level"
    | "is_active"
  >
>;

export interface LoadRoleRef {
  id: string;
  name: string;
  factor: number;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Service type today: career once the career start date has arrived (same rule as each cycle). */
export function effectiveService(s: Pick<SoldierDetail, "career_start_date" | "service_type">, today = todayIso()) {
  if (!s.career_start_date) return s.service_type;
  return s.career_start_date <= today ? "career" : "mandatory";
}

export type RangeState = "missing" | "expired" | "expiring" | "valid";

export function rangeState(until: string | null, today = todayIso(), warnDays = 30): RangeState {
  if (!until) return "missing";
  if (until < today) return "expired";
  if (until <= addDaysIso(today, warnDays)) return "expiring";
  return "valid";
}

/** Parent for scheduling: a manual override (while in force) wins over the file. */
export function effectiveParent(s: Pick<SoldierDetail, "parent_status" | "parent_override" | "parent_override_until">, today = todayIso()) {
  if (s.parent_override !== null && (!s.parent_override_until || s.parent_override_until >= today)) return s.parent_override;
  return s.parent_status;
}

/** ת"ש 7 (home every night): a manual override (while in force) wins over the file. */
export function effectiveHomeNightly(
  s: Pick<SoldierDetail, "home_nightly" | "home_nightly_override" | "home_nightly_override_until">,
  today = todayIso(),
) {
  if (s.home_nightly_override !== null && (!s.home_nightly_override_until || s.home_nightly_override_until >= today)) return s.home_nightly_override;
  return s.home_nightly;
}

/** The soldier's relief roles in force today, largest relief (lowest factor) first. */
export function activeLoadRoles(s: Pick<SoldierDetail, "load_roles">, today = todayIso()): SoldierLoadRole[] {
  return s.load_roles.filter((r) => r.valid_from <= today && (!r.valid_to || r.valid_to >= today)).sort((a, b) => a.factor - b.factor);
}

/** The relief that applies: the largest one (lowest factor) – roles never multiply. */
export function activeLoadRole(s: Pick<SoldierDetail, "load_roles">, today = todayIso()): SoldierLoadRole | null {
  return activeLoadRoles(s, today)[0] ?? null;
}

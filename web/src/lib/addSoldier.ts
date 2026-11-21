/** "הוספת עובד": the short form instead of a personnel file – what it needs and what it sends. */
import { normalizeEmployeeNumber } from "./hmac";
import { normalizePhone } from "./phone";

export interface AddSoldierForm {
  idNumber: string;
  firstName: string;
  lastName: string;
  rankId: string;
  serviceType: "mandatory" | "career" | "";
  gafId: string;
  gender: "male" | "female" | "";
  enlistmentDate: string;
  releaseDate: string;
  careerStartDate: string;
  rangeValidUntil: string;
  parent: boolean;
  /** הת"ש 3–7: nights a week he must sleep at home ("" = none) */
  tashLevel: number | "";
  /** שח"ר – mandatory service only */
  shachar: boolean;
  /** signed for continued career service (תפקיד שני) */
  secondRoleSignedAt: string;
  phone: string;
  /** joined the unit (today by default): the grace period counts from it */
  joinDate: string;
}

export const EMPTY_FORM = (today: string): AddSoldierForm => ({
  idNumber: "", firstName: "", lastName: "", rankId: "", serviceType: "", gafId: "", gender: "",
  enlistmentDate: "", releaseDate: "", careerStartDate: "", rangeValidUntil: "", parent: false, tashLevel: "", shachar: false, secondRoleSignedAt: "", phone: "",
  joinDate: today,
});

/** What stops saving, field by field (empty when it can be saved). */
export function formProblems(f: AddSoldierForm): Partial<Record<keyof AddSoldierForm, string>> {
  const p: Partial<Record<keyof AddSoldierForm, string>> = {};
  if (!normalizeEmployeeNumber(f.idNumber)) p.idNumber = f.idNumber.trim() ? "רק ספרות" : "חובה";
  if (!f.firstName.trim()) p.firstName = "חובה";
  if (!f.lastName.trim()) p.lastName = "חובה";
  if (!f.rankId) p.rankId = "חובה";
  if (!f.serviceType) p.serviceType = "חובה";
  if (!f.gafId) p.gafId = "חובה";
  if (normalizePhone(f.phone) === "invalid") p.phone = "נייד ישראלי, למשל 050-1234567";
  if (f.enlistmentDate && f.releaseDate && f.releaseDate < f.enlistmentDate) p.releaseDate = "לפני תאריך הגיוס";
  if (!f.joinDate) p.joinDate = "חובה";
  return p;
}

/** The row for add_soldier, with the employee number already turned into its key. */
export function toRow(f: AddSoldierForm, soldierKey: string) {
  const phone = normalizePhone(f.phone);
  return {
    soldier_key: soldierKey,
    full_name: `${f.firstName.trim()} ${f.lastName.trim()}`,
    service_type: f.serviceType,
    gender: f.gender || null,
    gaf_id: f.gafId,
    rank_id: f.rankId,
    enlistment_date: f.serviceType === "mandatory" ? f.enlistmentDate || null : null,
    release_date: f.serviceType === "mandatory" ? f.releaseDate || null : null,
    career_start_date: f.serviceType === "career" ? f.careerStartDate || null : null,
    range_valid_until: f.rangeValidUntil || null,
    parent_status: f.parent,
    home_nightly: false, // the personnel file's flag; here נע"ת sets the level, as on the card
    tash_level: f.tashLevel === "" ? null : f.tashLevel,
    phone: phone === "invalid" ? null : phone,
    unit_join_date: f.joinDate,
    is_shachar: f.serviceType === "mandatory" && f.shachar,
    second_role_signed_at: f.secondRoleSignedAt || null,
  };
}

export type AddSoldierRow = ReturnType<typeof toRow>;

export type AddSoldierResult =
  | { status: "added"; id: string }
  | { status: "exists" | "inactive"; id: string; name: string; gaf: string | null };

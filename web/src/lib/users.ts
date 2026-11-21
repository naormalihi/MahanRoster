/** User accounts (נע"ת manages them; v1 creates gaf-commander accounts). */
import type { Role } from "./api";

export interface UserRoleRow {
  id: string;
  role: Role;
  gaf_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

export interface AppUser {
  user_id: string;
  username: string;
  soldier_id: string | null;
  soldier_name: string | null;
  is_locked: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  roles: UserRoleRow[];
  /** two-step login set up (a verified authenticator) */
  has_mfa?: boolean;
}

/** Users who can reset another user's two-step login: נע"ת and מ"מ, active, not locked. */
export function mfaResetters(users: AppUser[], now = new Date()): AppUser[] {
  const t = now.getTime();
  return users.filter(
    (u) =>
      !u.is_locked &&
      u.roles.some(
        (r) =>
          (r.role === "coordinator" || r.role === "deputy") &&
          (!r.valid_from || Date.parse(r.valid_from) <= t) &&
          (!r.valid_to || Date.parse(r.valid_to) > t),
      ),
  );
}

/** The staff roles an existing account can be given (a soldier who became a commander keeps one account). */
export const GRANTABLE: CreatableRole[] = ["coordinator", "gaf_commander", "unit_commander"];

export const ROLE_NAME: Record<Role, string> = {
  coordinator: "נע\"ת תורנויות",
  deputy: "ממלא מקום",
  viewer: "צפייה משותפת",
  gaf_commander: "מפקד מסגרת – צפייה",
  gaf_rep: "נציג מסגרת",
  unit_commander: "מפקד יחידה",
  soldier: "עובד",
};

/** The accounts נע"ת creates in the users screen (soldiers come in with an invite code). */
export type CreatableRole = "coordinator" | "gaf_commander" | "unit_commander";

export const USERNAME_RULE = /^[a-z0-9._-]{3,32}$/;

/** A temporary password without look-alike characters (0/O, 1/l/I). */
export function tempPassword(length = 12, rnd: (n: number) => number = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => abc[rnd(abc.length)]).join("");
}

export function usernameProblem(u: string, taken: string[]): string | null {
  const v = u.trim().toLowerCase();
  if (!USERNAME_RULE.test(v)) return "3–32 תווים: אותיות לטיניות קטנות, ספרות, נקודה, מקף או קו תחתון";
  if (taken.includes(v)) return "שם המשתמש כבר קיים";
  return null;
}

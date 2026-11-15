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
}

export const ROLE_NAME: Record<Role, string> = {
  coordinator: "נע\"ת תורנויות",
  deputy: "ממלא מקום",
  viewer: "צפייה משותפת",
  gaf_commander: "מפקד גף",
  gaf_rep: "נציג גף",
  unit_commander: "מפקד יחידה",
  soldier: "חייל",
};

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

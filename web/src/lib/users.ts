/** User accounts (אחראי השיבוצים manages them; v1 creates gaf-commander accounts). */
import type { Role } from "./api";

export interface UserRoleRow {
  id: string;
  role: Role;
  gaf_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  /** a framework commander: the framework in effect – the chosen one, or his employee's */
  gaf_in_effect?: string | null;
  gaf_name?: string | null;
  /** chosen by אחראי השיבוצים rather than following the linked employee */
  gaf_chosen?: boolean;
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

/** Users who can reset another user's two-step login: אחראי השיבוצים and מ"מ, active, not locked. */
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
  coordinator: "אחראי שיבוצים",
  deputy: "ממלא מקום",
  viewer: "צפייה משותפת",
  gaf_commander: "מפקד מסגרת – צפייה",
  gaf_rep: "נציג מסגרת",
  unit_commander: "מפקד יחידה",
  soldier: "עובד",
};

/** The accounts אחראי השיבוצים creates in the users screen (soldiers come in with an invite code). */
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

/** Filtering the users list: by kind (a user with several roles is in each of his kinds) and by state. */
export type UserKind = "staff" | "commander" | "unit" | "viewer" | "soldier";
export const USER_KINDS: { kind: UserKind; label: string }[] = [
  { kind: "staff", label: "אחראי שיבוצים / מ\"מ" },
  { kind: "commander", label: "מפקדי מסגרות" },
  { kind: "unit", label: "מפקד יחידה" },
  { kind: "viewer", label: "צפייה משותפת" },
  { kind: "soldier", label: "עובדים בלבד" },
];
export type UserState = "active" | "pending" | "locked";
export const USER_STATES: { state: UserState; label: string }[] = [
  { state: "active", label: "פעיל" },
  { state: "pending", label: "ממתין לכניסה ראשונה" },
  { state: "locked", label: "נעול" },
];

export function userKinds(u: AppUser): Set<UserKind> {
  const out = new Set<UserKind>();
  for (const r of u.roles) {
    if (r.role === "coordinator" || r.role === "deputy") out.add("staff");
    else if (r.role === "gaf_commander" || r.role === "gaf_rep") out.add("commander");
    else if (r.role === "unit_commander") out.add("unit");
    else if (r.role === "viewer") out.add("viewer");
  }
  if (out.size === 0 && u.roles.some((r) => r.role === "soldier")) out.add("soldier");
  return out;
}

export function userState(u: AppUser): UserState {
  return u.is_locked ? "locked" : u.must_change_password ? "pending" : "active";
}

export function filterUsers(users: AppUser[], f: { kind: UserKind | null; state: UserState | null; q: string }): AppUser[] {
  const q = f.q.trim().toLowerCase();
  return users.filter(
    (u) =>
      (!f.kind || userKinds(u).has(f.kind)) &&
      (!f.state || userState(u) === f.state) &&
      (!q || u.username.toLowerCase().includes(q) || (u.soldier_name ?? "").toLowerCase().includes(q)),
  );
}

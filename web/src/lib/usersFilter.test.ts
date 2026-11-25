import { describe, expect, it } from "vitest";
import { filterUsers, userKinds, userState, type AppUser } from "./users";

const u = (username: string, roles: string[], extra: Partial<AppUser> = {}): AppUser => ({
  user_id: username,
  username,
  soldier_id: null,
  soldier_name: null,
  is_locked: false,
  must_change_password: false,
  last_login_at: null,
  roles: roles.map((role, i) => ({ id: `${username}${i}`, role: role as AppUser["roles"][number]["role"], gaf_id: null, valid_from: null, valid_to: null })),
  ...extra,
});

const all = [
  u("coord", ["coordinator", "soldier"], { soldier_name: "דנה לוי" }),
  u("cmd.a", ["gaf_commander", "soldier"], { must_change_password: true }),
  u("cmd.b", ["gaf_commander"], { is_locked: true }),
  u("boss", ["unit_commander"]),
  u("emp", ["soldier"], { soldier_name: "יוסי כהן" }),
];

describe("users filter", () => {
  it("kinds: a staff or commander who is also an employee is not 'employees only'", () => {
    expect([...userKinds(all[0])]).toEqual(["staff"]);
    expect([...userKinds(all[1])]).toEqual(["commander"]);
    expect([...userKinds(all[4])]).toEqual(["soldier"]);
  });
  it("state", () => {
    expect(all.map(userState)).toEqual(["active", "pending", "locked", "active", "active"]);
  });
  it("combines kind, state and search", () => {
    const f = (kind: Parameters<typeof filterUsers>[1]["kind"], state: Parameters<typeof filterUsers>[1]["state"], q = "") =>
      filterUsers(all, { kind, state, q }).map((x) => x.username);
    expect(f("commander", null)).toEqual(["cmd.a", "cmd.b"]);
    expect(f("commander", "pending")).toEqual(["cmd.a"]);
    expect(f(null, null, "כהן")).toEqual(["emp"]);
    expect(f(null, null, " CMD ")).toEqual(["cmd.a", "cmd.b"]);
    expect(f("soldier", "locked")).toEqual([]);
  });
});

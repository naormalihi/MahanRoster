import { describe, expect, it } from "vitest";
import { mfaResetters, tempPassword, usernameProblem } from "../users";

describe("users", () => {
  it("makes temporary passwords without look-alike characters", () => {
    const p = tempPassword(12);
    expect(p).toHaveLength(12);
    expect(p).not.toMatch(/[01lIoO]/);
  });
  it("checks usernames", () => {
    expect(usernameProblem("Dana.K", [])).toBeNull();
    expect(usernameProblem("דנה", [])).not.toBeNull();
    expect(usernameProblem("dana.k", ["dana.k"])).toBe("שם המשתמש כבר קיים");
  });
});

describe("mfaResetters", () => {
  const u = (id: string, role: string, extra: Partial<{ is_locked: boolean; valid_to: string | null }> = {}) =>
    ({ user_id: id, username: id, soldier_id: null, soldier_name: null, is_locked: !!extra.is_locked, must_change_password: false,
       last_login_at: null, roles: [{ id: id, role, gaf_id: null, valid_from: null, valid_to: extra.valid_to ?? null }] }) as never;
  it("counts active, unlocked נע\"ת and מ\"מ only", () => {
    const now = new Date("2027-01-10T08:00:00Z");
    const list = [u("a", "coordinator"), u("b", "deputy"), u("c", "deputy", { is_locked: true }), u("d", "deputy", { valid_to: "2027-01-01T00:00:00Z" }), u("e", "gaf_commander")];
    expect(mfaResetters(list, now).map((x) => (x as { user_id: string }).user_id)).toEqual(["a", "b"]);
  });
});

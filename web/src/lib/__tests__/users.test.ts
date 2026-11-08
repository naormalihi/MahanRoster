import { describe, expect, it } from "vitest";
import { tempPassword, usernameProblem } from "../users";

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

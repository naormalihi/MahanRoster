import { describe, expect, it } from "vitest";
import { EMPTY_FORM, formProblems, toRow } from "../addSoldier";

const ok = { ...EMPTY_FORM("2026-11-19"), idNumber: "000018", firstName: "דנה", lastName: "לוי", rankId: "r1", serviceType: "mandatory" as const, gafId: "g1" };

describe("add soldier form", () => {
  it("needs an employee number (digits), a name, a rank, a service type and a gaf", () => {
    expect(formProblems(ok)).toEqual({});
    const p = formProblems(EMPTY_FORM("2026-11-19"));
    expect(Object.keys(p).sort()).toEqual(["firstName", "gafId", "idNumber", "lastName", "rankId", "serviceType"]);
    expect(formProblems({ ...ok, idNumber: "123456789" }).idNumber).toBeUndefined(); // no check digit
    expect(formProblems({ ...ok, idNumber: "12א" }).idNumber).toBe("רק ספרות");
    expect(formProblems({ ...ok, phone: "03-1234567" }).phone).toBeTruthy();
    expect(formProblems({ ...ok, enlistmentDate: "2026-05-01", releaseDate: "2025-01-01" }).releaseDate).toBeTruthy();
  });

  it("sends only the dates of its service type, and never the employee number", () => {
    const r = toRow({ ...ok, enlistmentDate: "2026-01-01", careerStartDate: "2020-01-01", phone: "050-1234567" }, "k".repeat(64));
    expect(r.enlistment_date).toBe("2026-01-01");
    expect(r.career_start_date).toBeNull();
    expect(r.full_name).toBe("דנה לוי");
    expect(r.phone).toBe("972501234567");
    expect(JSON.stringify(r)).not.toContain("000000018");
  });

  it("שח\"ר only with mandatory service; the second-role date as given", () => {
    expect(toRow({ ...ok, shachar: true, secondRoleSignedAt: "2026-10-01" }, "k".repeat(64))).toMatchObject({ is_shachar: true, second_role_signed_at: "2026-10-01" });
    expect(toRow({ ...ok, serviceType: "career", shachar: true }, "k".repeat(64))).toMatchObject({ is_shachar: false, second_role_signed_at: null });
  });

  it("the הת\"ש level as on the card; the personnel-file flag stays off", () => {
    expect(toRow({ ...ok, tashLevel: 7 }, "k".repeat(64))).toMatchObject({ tash_level: 7, home_nightly: false });
    expect(toRow(ok, "k".repeat(64)).tash_level).toBeNull();
  });
});

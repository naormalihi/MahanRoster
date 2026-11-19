import { describe, expect, it } from "vitest";
import { EMPTY_FORM, formProblems, toRow } from "../addSoldier";

const ok = { ...EMPTY_FORM("2026-11-19"), idNumber: "000000018", firstName: "דנה", lastName: "לוי", rankId: "r1", serviceType: "mandatory" as const, gafId: "g1" };

describe("add soldier form", () => {
  it("needs a valid ת.ז, a name, a rank, a service type and a gaf", () => {
    expect(formProblems(ok)).toEqual({});
    const p = formProblems(EMPTY_FORM("2026-11-19"));
    expect(Object.keys(p).sort()).toEqual(["firstName", "gafId", "idNumber", "lastName", "rankId", "serviceType"]);
    expect(formProblems({ ...ok, idNumber: "123456789" }).idNumber).toContain("ספרת ביקורת");
    expect(formProblems({ ...ok, phone: "03-1234567" }).phone).toBeTruthy();
    expect(formProblems({ ...ok, enlistmentDate: "2026-05-01", releaseDate: "2025-01-01" }).releaseDate).toBeTruthy();
  });

  it("sends only the dates of its service type, and never the ת.ז", () => {
    const r = toRow({ ...ok, enlistmentDate: "2026-01-01", careerStartDate: "2020-01-01", phone: "050-1234567" }, "k".repeat(64));
    expect(r.enlistment_date).toBe("2026-01-01");
    expect(r.career_start_date).toBeNull();
    expect(r.full_name).toBe("דנה לוי");
    expect(r.phone).toBe("972501234567");
    expect(JSON.stringify(r)).not.toContain("000000018");
  });
});

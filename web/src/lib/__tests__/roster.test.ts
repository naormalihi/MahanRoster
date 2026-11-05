import { describe, expect, it } from "vitest";
import { detectMapping, mappingProblems, parseRows, planImport, toRecord, type ExistingSoldier } from "../roster";

const headers = ["מ\"א", "שם פרטי", "שם משפחה", "סוג שירות", "גף", "דרגה", "מין", "תאריך גיוס", "תאריך שחרור", "תוקף מטווח", "משרת הורה"];

describe("mapping", () => {
  it("detects Hebrew headers and their variants", () => {
    const m = detectMapping(headers);
    expect(m.personalNumber).toBe("מ\"א");
    expect(m.firstName).toBe("שם פרטי");
    expect(m.rank).toBe("דרגה");
    expect(mappingProblems(m)).toEqual([]);
  });
  it("reports missing required columns", () => {
    expect(mappingProblems(detectMapping(["שם מלא"]))).toContain("חסרה עמודה: מספר אישי");
  });
});

describe("parsing", () => {
  const m = detectMapping(headers);
  const row = (o: Partial<Record<string, unknown>>) => ({
    "מ\"א": "1234567", "שם פרטי": "נועה", "שם משפחה": "כהן", "סוג שירות": "חובה", "גף": "גף מבצעים", "דרגה": "סמל",
    "מין": "נ", "תאריך גיוס": new Date(2025, 2, 1), "תאריך שחרור": "01/09/2027", "תוקף מטווח": "", "משרת הורה": "", ...o,
  });

  it("parses a good row", () => {
    const { rows, errors } = parseRows([row({})], m);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      personalNumber: "1234567", fullName: "נועה כהן", serviceType: "mandatory", gender: "female",
      enlistmentDate: "2025-03-01", releaseDate: "2027-09-01", rangeValidUntil: null, parent: false,
    });
  });
  it("flags duplicates, bad values and skips empty lines", () => {
    const { rows, errors } = parseRows(
      [row({}), row({}), row({ "מ\"א": "7654321", "סוג שירות": "מילואים" }), row({ "מ\"א": "1111111", "תאריך גיוס": "32/13/2025" }),
       Object.fromEntries(headers.map((h) => [h, ""]))],
      m,
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[0].message).toContain("כפול");
  });
});

describe("plan", () => {
  const rec = (key: string, extra = {}) => ({
    ...toRecord({ line: 2, personalNumber: "1", fullName: "א ב", serviceType: "career", gaf: "גף א", rank: "סרן", gender: null,
      enlistmentDate: null, releaseDate: null, rangeValidUntil: "2027-06-30", parent: false }, key),
    ...extra,
  });
  const existing = (key: string, extra = {}): ExistingSoldier => ({ ...rec(key), id: "id-" + key, is_active: true, gender: "male", ...extra });

  it("splits into added, updated, removed and unchanged", () => {
    const plan = planImport(
      [rec("k1"), rec("k2", { rank_name: "רס\"ן" }), rec("k4", { gaf_name: "גף חדש" })],
      [existing("k1"), existing("k2"), existing("k3")],
      ["גף א"],
      ["סרן", "רס\"ן"],
    );
    expect(plan.added.map((r) => r.soldier_key)).toEqual(["k4"]);
    expect(plan.updated.map((u) => [u.id, u.changes])).toEqual([["id-k2", ["rank_name"]]]);
    expect(plan.removed.map((s) => s.id)).toEqual(["id-k3"]);
    expect(plan.unchanged).toBe(1); // gender is empty in the file, so it is kept
    expect(plan.unknownGafim).toEqual(["גף חדש"]);
    expect(plan.unknownRanks).toEqual([]);
  });
  it("reactivates a returning soldier", () => {
    const plan = planImport([rec("k1")], [existing("k1", { is_active: false })], ["גף א"], ["סרן"]);
    expect(plan.updated).toHaveLength(1);
  });
});

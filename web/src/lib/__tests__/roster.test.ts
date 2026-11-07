import { describe, expect, it } from "vitest";
import { detectMapping, mappingProblems, parseRows, planImport, serviceOf, toRecord, type ExistingSoldier } from "../roster";

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

describe("ת\"ש 7 column", () => {
  it("reads it when the column exists, keeps the stored value when it does not", () => {
    const base = { "מספר אישי": "1234567", "שם מלא": "א ב", "דרגה": "סמל", "גף": "גף א", "סוג שירות": "חובה" };
    const m = detectMapping([...Object.keys(base), "ת\"ש"]);
    expect(m.homeNightly).toBe("ת\"ש");
    const rows = parseRows([{ ...base, "ת\"ש": "7" }, { ...base, "מספר אישי": "1234568", "ת\"ש": "" }], m).rows;
    expect(rows.map((r) => r.homeNightly)).toEqual([true, false]);
    const without = parseRows([base], detectMapping(Object.keys(base))).rows;
    expect(without[0].homeNightly).toBeNull();
  });
});

describe("gaf column holding the framework path", () => {
  it("extracts the gaf", () => {
    const base = { "מספר אישי": "1234567", "שם מלא": "א ב", "דרגה": "סמל", "סוג שירות": "חובה" };
    const m = detectMapping([...Object.keys(base), "גף"]);
    const rows = parseRows([{ ...base, "גף": "מה\"ן - מלמסים/גף ענן/צוות תשתיות - מלמסים" }, { ...base, "מספר אישי": "1234568", "גף": "גף טכני" }], m).rows;
    expect(rows.map((r) => r.gaf)).toEqual(["גף ענן", "גף טכני"]);
  });
});

describe("plan", () => {
  const rec = (key: string, extra = {}) => ({
    ...toRecord({ line: 2, personalNumber: "1", fullName: "א ב", serviceType: "career", gaf: "גף א", rank: "סרן", gender: null,
      enlistmentDate: null, releaseDate: null, careerStartDate: null, rangeValidUntil: "2027-06-30", parent: false, homeNightly: null }, key),
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

describe("HR export layout", () => {
  const hr = ["מספר אישי", "מין", "דרגה מחושבת", "שם פרטי", "שם משפחה", "מסגרת", "תאריך תום שירות (תש\"ש)", "נמצא במשרת הורה"];
  const m = detectMapping(hr);

  it("maps computed rank, end-of-service date, parent and framework", () => {
    expect(m.rank).toBe("דרגה מחושבת");
    expect(m.releaseDate).toBe("תאריך תום שירות (תש\"ש)");
    expect(m.parent).toBe("נמצא במשרת הורה");
    expect(m.framework).toBe("מסגרת");
    expect(m.serviceType).toBeUndefined();
    expect(mappingProblems(m)).toEqual([]);
  });

  it("takes the gaf from the framework and the service type from the rank", () => {
    const base = { "מספר אישי": "9104891", "מין": "זכר", "שם פרטי": "ליאור", "שם משפחה": "סגל", "תאריך תום שירות (תש\"ש)": "", "נמצא במשרת הורה": "" };
    const { rows, errors } = parseRows(
      [
        { ...base, "דרגה מחושבת": "סמ\"ר", "מסגרת": "מה\"ן - מלמסים/גף ענן/צוות DevOps - מלמסים" },
        { ...base, "מספר אישי": "9311538", "דרגה מחושבת": "רס\"ר", "מסגרת": "מה\"ן - מלמסים/גף בדיקות - מלמסים", "נמצא במשרת הורה": "YES" },
        { ...base, "מספר אישי": "9129838", "דרגה מחושבת": "קמ\"א", "מסגרת": "מה\"ן - מלמסים" },
      ],
      m,
    );
    expect(rows.map((r) => [r.gaf, r.serviceType, r.parent])).toEqual([
      ["גף ענן", "mandatory", false],
      ["גף בדיקות", "career", true],
    ]);
    expect(errors).toEqual([{ line: 4, message: "לא נמצא גף במסגרת" }]);
  });
});

describe("service type", () => {
  it("prefers a service column, then the career start date, then the rank", () => {
    expect(serviceOf({ serviceType: "x" }, "קבע", null, "סמל")).toBe("career");
    const byDate = { careerStartDate: "תאריך כניסה לקבע" };
    expect(serviceOf(byDate, undefined, "2024-08-01", "סמל", "2026-11-07")).toBe("career");
    expect(serviceOf(byDate, undefined, "2027-01-01", "רס\"ל", "2026-11-07")).toBe("mandatory"); // signed, not started yet
    expect(serviceOf(byDate, undefined, null, "סרן", "2026-11-07")).toBe("mandatory");
    expect(serviceOf({}, undefined, null, "סמ\"ר")).toBe("mandatory");
    expect(serviceOf({}, undefined, null, "רס\"ל")).toBe("career");
  });
  it("detects the career start date column", () => {
    expect(detectMapping(["תאריך כניסה לקבע"]).careerStartDate).toBe("תאריך כניסה לקבע");
  });
});

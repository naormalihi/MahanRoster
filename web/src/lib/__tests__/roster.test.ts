import { describe, expect, it } from "vitest";
import { approvePlan, changeKey, rankResolver, detectMapping, mappingProblems, parseRows, planImport, serviceOf, toRecord, type ExistingSoldier } from "../roster";

const headers = ["ת\"ז", "שם פרטי", "שם משפחה", "סוג שירות", "גף", "דרגה", "מין", "תאריך גיוס", "תאריך שחרור", "תוקף מטווח", "משרת הורה"];

describe("mapping", () => {
  it("detects Hebrew headers and their variants", () => {
    const m = detectMapping(headers);
    expect(m.idNumber).toBe("ת\"ז");
    expect(m.firstName).toBe("שם פרטי");
    expect(m.rank).toBe("דרגה");
    expect(mappingProblems(m)).toEqual([]);
  });
  it("reports missing required columns", () => {
    expect(mappingProblems(detectMapping(["שם מלא"]))).toContain("חסרה עמודה: מספר עובד");
    expect(detectMapping(["מספר עובד", "שם מלא"]).idNumber).toBe("מספר עובד");
    expect(detectMapping(["מס' עובד"]).idNumber).toBe("מס' עובד");
    expect(mappingProblems(detectMapping(["מספר אישי", "שם מלא"]), ["מספר אישי", "שם מלא"])[0]).toMatch(/מזהה חיילים לפי מספר עובד/);
  });
});

describe("parsing", () => {
  const m = detectMapping(headers);
  const row = (o: Partial<Record<string, unknown>>) => ({
    "ת\"ז": "123456782", "שם פרטי": "נועה", "שם משפחה": "כהן", "סוג שירות": "חובה", "גף": "גף מבצעים", "דרגה": "סמל",
    "מין": "נ", "תאריך גיוס": new Date(2025, 2, 1), "תאריך שחרור": "01/09/2027", "תוקף מטווח": "", "משרת הורה": "", ...o,
  });

  it("parses a good row", () => {
    const { rows, errors } = parseRows([row({})], m);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      idNumber: "123456782", fullName: "נועה כהן", serviceType: "mandatory", gender: "female",
      enlistmentDate: "2025-03-01", releaseDate: "2027-09-01", rangeValidUntil: null, parent: false,
    });
  });
  it("flags duplicates, bad values and skips empty lines", () => {
    const { rows, errors } = parseRows(
      [row({}), row({}), row({ "ת\"ז": "765432109", "סוג שירות": "מילואים" }), row({ "ת\"ז": "111111118", "תאריך גיוס": "32/13/2025" }),
       Object.fromEntries(headers.map((h) => [h, ""]))],
      m,
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[0].message).toContain("כפול");
    // an employee number: no check digit, digits only, leading zeros don't make a new person
    expect(parseRows([row({ "ת\"ז": "123456789" })], m).errors).toEqual([]);
    expect(parseRows([row({ "ת\"ז": "12A4" })], m).errors[0].message).toContain("רק ספרות");
    expect(parseRows([row({ "ת\"ז": "0042" }), row({ "ת\"ז": 42 })], m).errors[0].message).toContain("כפול");
  });
});

describe("ת\"ש 7 column", () => {
  it("reads it when the column exists, keeps the stored value when it does not", () => {
    const base = { "ת.ז": "123456782", "שם מלא": "א ב", "דרגה": "סמל", "גף": "גף א", "סוג שירות": "חובה" };
    const m = detectMapping([...Object.keys(base), "ת\"ש"]);
    expect(m.homeNightly).toBe("ת\"ש");
    const rows = parseRows([{ ...base, "ת\"ש": "7" }, { ...base, "ת.ז": "123456790", "ת\"ש": "" }], m).rows;
    expect(rows.map((r) => r.homeNightly)).toEqual([true, false]);
    const without = parseRows([base], detectMapping(Object.keys(base))).rows;
    expect(without[0].homeNightly).toBeNull();
  });
});

describe("gaf column holding the framework path", () => {
  it("extracts the gaf", () => {
    const base = { "ת.ז": "123456782", "שם מלא": "א ב", "דרגה": "סמל", "סוג שירות": "חובה" };
    const m = detectMapping([...Object.keys(base), "גף"]);
    const rows = parseRows([{ ...base, "גף": "מה\"ן - מלמסים/גף ענן/צוות תשתיות - מלמסים" }, { ...base, "ת.ז": "123456790", "גף": "גף טכני" }], m).rows;
    expect(rows.map((r) => r.gaf)).toEqual(["גף ענן", "גף טכני"]);
  });
});

describe("phone column", () => {
  const base = { "ת.ז": "123456782", "שם מלא": "א ב", "דרגה": "סמל", "סוג שירות": "חובה", "גף": "גף א" };
  it("is detected, normalized, and a bad number stops the row", () => {
    const m = detectMapping([...Object.keys(base), "נייד"]);
    expect(m.phone).toBe("נייד");
    const r = parseRows(
      [
        { ...base, "נייד": "050-1234567" },
        { ...base, "ת.ז": "123456790", "נייד": 521234567 },
        { ...base, "ת.ז": "123456808", "נייד": "" },
        { ...base, "ת.ז": "123456907", "נייד": "03-1234567" },
      ],
      m,
    );
    expect(r.rows.map((x) => x.phone)).toEqual(["972501234567", "972521234567", null]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toContain("טלפון");
  });
  it("an empty cell keeps the stored number", () => {
    const m = detectMapping([...Object.keys(base), "טלפון"]);
    const [row] = parseRows([{ ...base, "טלפון": "" }], m).rows;
    const rec = toRecord(row, "k1");
    const plan = planImport([rec], [{ ...rec, phone: "972501234567", id: "x", is_active: true }], ["גף א"], ["סמל"]);
    expect(plan.unchanged).toBe(1);
  });
});

describe("plan", () => {
  const rec = (key: string, extra = {}) => ({
    ...toRecord({ line: 2, idNumber: "1", fullName: "א ב", serviceType: "career", gaf: "גף א", rank: "סרן", gender: null,
      enlistmentDate: null, releaseDate: null, careerStartDate: null, rangeValidUntil: "2027-06-30", parent: false, homeNightly: null, phone: null }, key),
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
  it("loads only the approved changes of existing soldiers", () => {
    const plan = planImport([rec("k1", { rank_name: "רס\"ן", gaf_name: "גף ב" }), rec("k2", { rank_name: "רס\"ן" })],
      [existing("k1"), existing("k2")], ["גף א", "גף ב"], ["סרן", "רס\"ן"]);
    const out = approvePlan(plan, new Set([changeKey("id-k1", "rank_name")]));
    expect(out.updated.map((u) => [u.id, u.changes])).toEqual([["id-k1", ["rank_name"]]]);
    expect(out.updated[0].after.rank_name).toBe("רס\"ן");
    expect(out.updated[0].after.gaf_name).toBeNull(); // not approved: the stored gaf stays
    expect(out.unchanged).toBe(1);
  });
  it("reactivates a returning soldier", () => {
    const plan = planImport([rec("k1")], [existing("k1", { is_active: false })], ["גף א"], ["סרן"]);
    expect(plan.updated).toHaveLength(1);
  });
});

describe("HR export layout", () => {
  const hr = ["ת.ז", "מין", "דרגה מחושבת", "שם פרטי", "שם משפחה", "מסגרת", "תאריך תום שירות (תש\"ש)", "נמצא במשרת הורה"];
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
    const base = { "ת.ז": "910489103", "מין": "זכר", "שם פרטי": "ליאור", "שם משפחה": "סגל", "תאריך תום שירות (תש\"ש)": "", "נמצא במשרת הורה": "" };
    const { rows, errors } = parseRows(
      [
        { ...base, "דרגה מחושבת": "סמ\"ר", "מסגרת": "מה\"ן - מלמסים/גף ענן/צוות DevOps - מלמסים" },
        { ...base, "ת.ז": "931153803", "דרגה מחושבת": "רס\"ר", "מסגרת": "מה\"ן - מלמסים/גף בדיקות - מלמסים", "נמצא במשרת הורה": "YES" },
        { ...base, "ת.ז": "912983806", "דרגה מחושבת": "קמ\"א", "מסגרת": "מה\"ן - מלמסים" },
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

describe("rank names", () => {
  it("resolves military names and their spellings to the neutral name", () => {
    const resolve = rankResolver([
      { name: "חובה 4", aliases: ['סמ"ר'] },
      { name: "אקדמאי 1", aliases: ['קמ"א'] },
    ]);
    expect(resolve('סמ"ר')).toBe("חובה 4");
    expect(resolve("סמ״ר")).toBe("חובה 4");
    expect(resolve("סמר")).toBe("חובה 4");
    expect(resolve(" חובה 4 ")).toBe("חובה 4");
    expect(resolve('קמ"א')).toBe("אקדמאי 1");
    expect(resolve("אל\"ם")).toBeNull();
  });
});

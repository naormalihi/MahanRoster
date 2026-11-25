import { describe, expect, it } from "vitest";
import { approvePlan, changeKey, rankResolver, detectMapping, mappingProblems, parseRows, planImport, serviceOf, toRecord, type ExistingSoldier } from "../roster";

const headers = ["ת\"ז", "שם פרטי", "שם משפחה", "סוג שירות", "גף", "דרגה", "מין", "תאריך קליטה", "תאריך שחרור", "תוקף מטווח", "משרת הורה"];

describe("mapping", () => {
  it("the personnel system's export: main mobile phone and end of service (תת\"ש)", () => {
    const m = detectMapping([
      "תעודת זהות ", "דרגה מחושבת", "שם משפחה", "שם פרטי", "סוג שירות", 'תאריך תום שירות (תת"ש )', "מסגרת",
      "מספר טלפון נייד עיקרי", "תאריך קליטה", 'הת"ש - ימי לינה', "אינדיקציה אוכלוסיית שחר", "אינדיקצית מתנדב",
    ]);
    expect(m.phone).toBe("מספר טלפון נייד עיקרי");
    expect(m.releaseDate).toBe('תאריך תום שירות (תת"ש )');
    expect(m).toMatchObject({ idNumber: "תעודת זהות ", rank: "דרגה מחושבת", firstName: "שם פרטי", lastName: "שם משפחה", framework: "מסגרת", unitJoinDate: "תאריך קליטה" });
    // the הת"ש column, with a dash in its name
    expect(m.homeNightly).toBe('הת"ש - ימי לינה');
  });
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
    expect(mappingProblems(detectMapping(["מספר אישי", "שם מלא"]), ["מספר אישי", "שם מלא"])[0]).toMatch(/מזהה עובדים לפי מספר עובד/);
  });
});

describe("parsing", () => {
  const m = detectMapping(headers);
  const row = (o: Partial<Record<string, unknown>>) => ({
    "ת\"ז": "123456782", "שם פרטי": "נועה", "שם משפחה": "כהן", "סוג שירות": "חובה", "גף": "גף מבצעים", "דרגה": "סמל",
    "מין": "נ", "תאריך קליטה": new Date(2025, 2, 1), "תאריך שחרור": "01/09/2027", "תוקף מטווח": "", "משרת הורה": "", ...o,
  });

  it("parses a good row", () => {
    const { rows, errors } = parseRows([row({})], m);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      idNumber: "123456782", fullName: "נועה כהן", serviceType: "mandatory", gender: "female",
      enlistmentDate: null, unitJoinDate: "2025-03-01", releaseDate: "2027-09-01", rangeValidUntil: null, parent: false,
    });
  });
  it("flags duplicates, bad values and skips empty lines", () => {
    const { rows, errors } = parseRows(
      [row({}), row({}), row({ "ת\"ז": "765432109", "סוג שירות": "מילואים" }), row({ "ת\"ז": "111111118", "תאריך קליטה": "32/13/2025" }),
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
    const base = { "ת.ז": "123456782", "שם פרטי": "א", "שם משפחה": "ב", "דרגה": "סמל", "גף": "גף א", "סוג שירות": "חובה" };
    const m = detectMapping([...Object.keys(base), "ת\"ש"]);
    expect(m.homeNightly).toBe("ת\"ש");
    const rows = parseRows([{ ...base, "ת\"ש": "7" }, { ...base, "ת.ז": "123456790", "ת\"ש": "" }], m).rows;
    expect(rows.map((r) => r.homeNightly)).toEqual([true, false]);
    const without = parseRows([base], detectMapping(Object.keys(base))).rows;
    expect(without[0].homeNightly).toBeNull();
  });
});

describe("הת\"ש column holds its type", () => {
  const base = { "ת.ז": "123456782", "שם פרטי": "א", "שם משפחה": "ב", "דרגה": "סמל", "גף": "גף א", "סוג שירות": "חובה" };
  const m = detectMapping([...Object.keys(base), "התש ימי לינה"]);
  const one = (v: string) => parseRows([{ ...base, "התש ימי לינה": v }], m);

  it("finds the column", () => expect(m.homeNightly).toBe("התש ימי לינה"));

  it("3–6 is a הת\"ש type, not ת\"ש 7", () => {
    for (const v of ["3", "4", "5", "6"]) {
      const r = one(v).rows[0];
      expect(r.tashLevel).toBe(Number(v));
      expect(r.homeNightly).toBe(false);
    }
  });

  it("7 is ת\"ש 7; empty or 0 is none; כן is 7, as files used to mark it", () => {
    expect([one("7").rows[0].tashLevel, one("7").rows[0].homeNightly]).toEqual([7, true]);
    expect([one("").rows[0].tashLevel, one("").rows[0].homeNightly]).toEqual([0, false]);
    expect(one("0").rows[0].tashLevel).toBe(0);
    expect(one("כן").rows[0].tashLevel).toBe(7);
  });

  it("an unknown type stops the row", () => {
    expect(one("2").errors[0].message).toContain("סוג הת\"ש לא מוכר");
    expect(one("9").rows).toHaveLength(0);
  });

  it("an existing soldier with no הת\"ש is not changed by an empty cell, but is by a type", () => {
    const row = one("").rows[0];
    const old = { ...toRecord(row, "k"), id: "s1", is_active: true, tash_level: 0 } as ExistingSoldier;
    expect(planImport([toRecord(row, "k")], [old], ["גף א"], ["סמל"]).unchanged).toBe(1);
    const p = planImport([toRecord(one("5").rows[0], "k")], [old], ["גף א"], ["סמל"]);
    expect(p.updated[0].changes).toEqual(["tash_level"]);
  });
});

describe("gaf column holding the framework path", () => {
  it("extracts the gaf", () => {
    const base = { "ת.ז": "123456782", "שם פרטי": "א", "שם משפחה": "ב", "דרגה": "סמל", "סוג שירות": "חובה" };
    const m = detectMapping([...Object.keys(base), "גף"]);
    const rows = parseRows([{ ...base, "גף": "מה\"ן - מלמסים/גף ענן/צוות תשתיות - מלמסים" }, { ...base, "ת.ז": "123456790", "גף": "גף טכני" }], m).rows;
    expect(rows.map((r) => r.gaf)).toEqual(["ענן", "טכני"]); // stored without the "גף" prefix
  });
});

describe("phone column", () => {
  const base = { "ת.ז": "123456782", "שם פרטי": "א", "שם משפחה": "ב", "דרגה": "סמל", "סוג שירות": "חובה", "גף": "גף א" };
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
      enlistmentDate: null, releaseDate: null, careerStartDate: null, unitJoinDate: null, rangeValidUntil: "2027-06-30", parent: false, homeNightly: null, tashLevel: null, phone: null }, key),
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
  it("a soldier the file puts in a framework not chosen stays active unless marked", () => {
    const plan = planImport([rec("k1")], [existing("k1"), existing("k2"), existing("k3")], ["גף א"], ["סרן"],
      new Map([["k2", "מסגרת אחרת / גף ז"]]));
    expect(plan.removed.map((s) => s.id)).toEqual(["id-k3"]); // not in the file at all
    expect(plan.movedOut.map((m) => [m.soldier.id, m.to])).toEqual([["id-k2", "מסגרת אחרת / גף ז"]]);
    expect(approvePlan(plan, new Set()).removed.map((s) => s.id)).toEqual(["id-k3"]);
    expect(approvePlan(plan, new Set(), new Set(["id-k2"])).removed.map((s) => s.id).sort()).toEqual(["id-k2", "id-k3"]);
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
      ["ענן", "mandatory", false],
      ["בדיקות", "career", true],
    ]);
    expect(errors).toEqual([{ line: 4, message: "לא נמצאה מסגרת בנתיב המסגרת" }]);
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

describe("תאריך קליטה", () => {
  it("is read from the file and is a change like any other", () => {
    const m = detectMapping(["מספר עובד", "שם פרטי", "שם משפחה", "דרגה", "סוג שירות", "גף", "תאריך קליטה"]);
    expect(m.unitJoinDate).toBe("תאריך קליטה");
    const { rows, errors } = parseRows(
      [
        { "מספר עובד": "11", "שם פרטי": "א", "שם משפחה": "ב", "דרגה": "סמל", "סוג שירות": "חובה", "גף": "ענן", "תאריך קליטה": "15/12/2026" },
        { "מספר עובד": "12", "שם פרטי": "ג", "שם משפחה": "ד", "דרגה": "סמל", "סוג שירות": "חובה", "גף": "ענן", "תאריך קליטה": "" },
      ],
      m,
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.unitJoinDate)).toEqual(["2026-12-15", null]);
    // an empty cell keeps the stored date
    const recs = rows.map((r, i) => toRecord(r, `k${i}`));
    const plan = planImport(recs, [{ ...recs[1], unit_join_date: "2026-01-01", id: "x", is_active: true }], ["ענן"], ["סמל"]);
    expect(plan.updated).toEqual([]);
    expect(detectMapping(["תאריך כניסה ליחידה"]).unitJoinDate).toBe("תאריך כניסה ליחידה");
  });
});

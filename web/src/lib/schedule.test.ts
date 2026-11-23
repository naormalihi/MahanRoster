import { describe, expect, it } from "vitest";
import { poolName, poolNames, warningText } from "./schedule";

describe("poolName", () => {
  it("names a fairness group by population and categories, never by id", () => {
    const names = poolNames([
      { fairness_group: "career:50cc8c93", fairness_label: "ש.ג, מטבח", balance_population: "career" },
      { fairness_group: "pop:none", fairness_label: "ללא משימה פתוחה", balance_population: "mandatory" },
    ]);
    expect(poolName(names, "career:50cc8c93")).toBe("קבע · ש.ג, מטבח");
    expect(poolName(names, "mandatory:unknown-id")).toBe("חובה");
    expect(poolName(names, "career")).toBe("קבע");
  });
});

describe("warningText", () => {
  const s = "d29fac98-97f1-4d8c-9eaf-0fc0f8f7a752", p = "5d7245fd-151d-439b-9b42-f18f9ff9e832";
  it("names the duty, the soldier and the rule", () => {
    const t = warningText(`שיבוץ קבוע במשבצת ${s} לחייל ${p} מפר: service, rank`, () => "קצין תורן (יום א׳ 3.1)", () => "נועה כהן", {
      service: "המשימה מוגבלת לחובה או לקבע",
      rank: "הדרגה מחוץ לטווח",
    });
    expect(t).toContain("נועה כהן");
    expect(t).toContain("קצין תורן (יום א׳ 3.1)");
    expect(t).toContain("המשימה מוגבלת לחובה או לקבע; הדרגה מחוץ לטווח");
    expect(t).not.toContain(s);
  });
  it("names the duties and soldiers in the independent check's findings", () => {
    const s1 = "2ed1d797-3726-46f2-8167-23137b359fe7", s2 = "3c20d13b-5c65-4a56-bb4d-bbffe4a449a7", p = "73d46e09-df65-4212-80d7-6bba9b92f3e8";
    const t = warningText(`verifier: ${p}: אין מנוחה מספקת בין ${s1} ל-${s2}`, (id) => (id === s1 ? "מטבח (א׳)" : "רס״ר (ב׳)"), () => "נועה כהן", {}, (id) => id !== p);
    expect(t).toBe("נועה כהן: אין מנוחה מספקת בין מטבח (א׳) ל-רס״ר (ב׳)");
  });
  it("passes other warnings through", () => expect(warningText("משהו אחר", String, String, {})).toBe("משהו אחר"));
});

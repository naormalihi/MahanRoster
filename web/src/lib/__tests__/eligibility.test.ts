import { describe, expect, it } from "vitest";
import { eligibilityOf, noWork, noWorkGroups, noWorkText, slotsByCategory } from "../eligibility";
import type { PotentialCell } from "../potential";

const cell = (soldier_id: string, category_id: string, value: number, reasons: string[] = []): PotentialCell => ({
  soldier_id,
  category_id,
  value,
  best_task_type_id: "t",
  reasons,
  available_days: 0,
  cycle_days: 0,
  override_value: null,
  override_reason: null,
});

const categories = new Map([
  ["gate", "מפקד שער"],
  ["guard", "שמירות חובה"],
  ["oto", "קצין תורן"],
]);
const tasks = new Map([
  ["t-guard", { category_id: "guard" }],
  ["t-oto", { category_id: "oto" }],
]);
const perCat = slotsByCategory([{ task_type_id: "t-guard" }, { task_type_id: "t-guard" }, { task_type_id: "t-oto" }], tasks);

const cells = [
  // open only where the cycle has no slots
  cell("A", "gate", 1),
  cell("A", "guard", 0, ["rank"]),
  cell("A", "oto", 0, ["rank"]),
  // nothing open, by rank
  cell("B", "gate", 0, ["rank"]),
  cell("B", "guard", 0, ["rank", "service"]),
  cell("B", "oto", 0, ["rank"]),
  // her rank fits one category, but she is away all cycle
  cell("D", "gate", 0, ["unavailable"]),
  cell("D", "guard", 0, ["rank"]),
  cell("D", "oto", 0, ["rank"]),
  // has work
  cell("C", "guard", 1),
  cell("C", "oto", 0, ["rank"]),
];
const rows = (id: string) => eligibilityOf(id, cells, categories, perCat);

describe("eligibility", () => {
  it("counts slots per category and orders open first", () => {
    expect(perCat.get("guard")).toBe(2);
    expect(rows("C").map((r) => [r.name, r.open, r.slots])).toEqual([
      ["שמירות חובה", true, 2],
      ["קצין תורן", false, 1],
    ]);
  });

  it("tells why a soldier cannot get any duty", () => {
    expect(noWork(rows("A"))).toBe("no_slots");
    expect(noWorkText(rows("A"), 'רס"ל')).toBe("כשיר רק למפקד שער, ובמחזור אין משבצות כאלה.");
    expect(noWork(rows("B"))).toBe("none_open");
    expect(noWorkText(rows("B"), 'סא"ל')).toBe('לא כשיר לאף קטגוריית תורנות: הדרגה סא"ל לא ברשימת הדרגות של אף סוג תורנות.');
    expect(noWorkText(rows("D"), 'קמ"א')).toBe(
      'לא כשיר לאף קטגוריית תורנות: הדרגה קמ"א מתאימה רק למפקד שער, ושם – לא זמין בכל המחזור (היעדרות, פטור, גיוס/שחרור או חודש חסד).',
    );
    expect(noWork(rows("C"))).toBeNull();
    expect(noWork([])).toBeNull();
  });

  it("gathers the soldiers with no possible duty by what to fix", () => {
    const g = noWorkGroups(["A", "B", "C", "D"], rows, (id) => (id === "B" ? 'סא"ל' : 'רס"ל'));
    expect(g.map((x) => [x.label, x.ids])).toEqual([
      ["כשירים רק למפקד שער – אין משבצות במחזור", ["A"]],
      ['דרגת סא"ל – לא ברשימת הדרגות של אף סוג', ["B"]],
      ["לא כשירים לאף קטגוריה: לא זמין בכל המחזור (היעדרות, פטור, גיוס/שחרור או חודש חסד)", ["D"]],
    ]);
  });
});

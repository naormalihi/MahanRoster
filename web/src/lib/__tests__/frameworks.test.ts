import { describe, expect, it } from "vitest";
import {
  buildTree,
  countSelected,
  forSaving,
  initialSelection,
  isNewTop,
  isSelected,
  placeLabel,
  placeOf,
  setAll,
  toggleGaf,
  toggleTop,
  topState,
} from "../frameworks";
import { detectMapping, parseRows } from "../roster";

const H = ["מספר עובד", "שם מלא", "דרגה", "סוג שירות", "מסגרת"];
const m = detectMapping(H);
const row = (n: number, frame: string) => ({ "מספר עובד": String(n), "שם מלא": `חייל ${n}`, "דרגה": "סמל", "סוג שירות": "חובה", "מסגרת": frame });
const file = [
  row(1, "מה\"ן - מלמסים/גף ענן/צוות א"),
  row(2, "מה\"ן - מלמסים/גף ענן/צוות ב"),
  row(3, "מה\"ן - מלמסים/גף טכני"),
  row(4, "מה\"ן - מלמסים"),
  row(5, "יחידה אחרת/גף ים"),
  row(6, "יחידה אחרת/גף ים"),
  row(7, "יחידה אחרת/גף ים"),
];

describe("frameworks", () => {
  const tree = buildTree(file, m);

  it("builds the tree: top frameworks, gafim under them, rows with no gaf last", () => {
    expect(tree.map((t) => [t.top, t.count])).toEqual([["מה\"ן - מלמסים", 4], ["יחידה אחרת", 3]]);
    expect(tree[0].gafim).toEqual([{ gaf: "גף טכני", count: 1 }, { gaf: "גף ענן", count: 2 }, { gaf: null, count: 1 }]);
    expect(placeLabel(placeOf(file[4], m)!)).toBe("יחידה אחרת / גף ים");
    expect(placeLabel(placeOf(file[3], m)!)).toBe("מה\"ן - מלמסים / בלי גף");
  });

  it("first load takes everything; a saved choice comes back, a new top unchosen", () => {
    expect(countSelected(initialSelection(null, tree), tree)).toBe(7);
    const saved = forSaving({ tops: ["מה\"ן - מלמסים"], units: [], seen: [] }, tree);
    const next = initialSelection(saved, [...tree, { top: "חדשה", count: 1, gafim: [{ gaf: "גף ב", count: 1 }] }]);
    expect(isSelected(next, { top: "מה\"ן - מלמסים", gaf: "גף חדש" })).toBe(true); // a new gaf under a whole top
    expect(isSelected(next, { top: "חדשה", gaf: "גף ב" })).toBe(false);
    expect(isNewTop(next, "חדשה")).toBe(true);
    expect(isNewTop(next, "יחידה אחרת")).toBe(false);
  });

  it("toggles a top and single gafim", () => {
    let sel = setAll(initialSelection(null, tree), tree, false);
    expect(countSelected(sel, tree)).toBe(0);
    sel = toggleTop(sel, tree[0]);
    expect(topState(sel, tree[0])).toBe("all");
    sel = toggleGaf(sel, tree[0], null); // out: the rows with no gaf
    expect(topState(sel, tree[0])).toBe("some");
    expect(countSelected(sel, tree)).toBe(3);
    expect(sel.tops).toEqual([]);
    sel = toggleGaf(sel, tree[0], null); // back: the top is whole again
    expect(sel.tops).toEqual(["מה\"ן - מלמסים"]);
    expect(sel.units).toEqual([]);
  });

  it("parses only the chosen frameworks, and keeps the others aside", () => {
    const sel = toggleTop(setAll(initialSelection(null, tree), tree, false), tree[0]);
    const r = parseRows(file, m, (x) => {
      const p = placeOf(x, m);
      return !p || isSelected(sel, p);
    });
    expect(r.rows.map((x) => x.idNumber)).toEqual(["1", "2", "3"]);
    expect(r.errors.map((e) => e.line)).toEqual([5]); // no gaf in its framework – still an error
    expect(r.outside.map((o) => o.idNumber)).toEqual(["5", "6", "7"]);
  });

  it("a file with a gaf column only: one level", () => {
    const g = detectMapping(["מספר עובד", "שם מלא", "גף"]);
    const t = buildTree([{ "מספר עובד": "1", "גף": "גף א" }, { "מספר עובד": "2", "גף": "גף ב" }], g);
    expect(t).toEqual([{ top: "", count: 2, gafim: [{ gaf: "גף א", count: 1 }, { gaf: "גף ב", count: 1 }] }]);
  });
});

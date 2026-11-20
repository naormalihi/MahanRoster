import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chapters, formula, inline, parseSpec } from "./specMarkdown";

describe("spec markdown", () => {
  it("reads bold, lists, tables and images", () => {
    const b = parseSpec("# כותרת\n\nשורה **מודגשת** כאן\nהמשך\n\n- א\n- **ב**\n\n| א | ב |\n| --- | --- |\n| 1 | **2** |\n\n![תמונה](/spec/x.webp)\n");
    expect(b.map((x) => x.kind)).toEqual(["heading", "paragraph", "list", "table", "image"]);
    expect(b[1]).toEqual({ kind: "paragraph", parts: inline("שורה **מודגשת** כאן המשך") });
    const t = b[3] as Extract<(typeof b)[number], { kind: "table" }>;
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0][1]).toEqual([{ text: "2", bold: true }]);
  });

  it("turns the formulas into plain math", () => {
    expect(formula("P = (W + D) \\times S").map((p) => p.text).join("")).toBe("P = (W + D) × S");
    const n = formula("S_{norm} = \\sum_i \\frac{P_i}{F_i}");
    expect(n.filter((p) => p.sub).map((p) => p.text)).toEqual(["norm", "i", "i"]);
    expect(n.map((p) => p.text).join("")).toBe("Snorm = Σᵢ Pi / Fi");
  });

  it("reads the whole spec: 20 chapters, every image under /spec/", () => {
    const md = readFileSync(new URL("../../../docs/spec.md", import.meta.url), "utf8");
    const b = parseSpec(md);
    expect(chapters(b).map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `ch-${i + 1}`));
    const imgs = b.filter((x) => x.kind === "image");
    expect(imgs.length).toBe(19);
    imgs.forEach((x) => {
      const src = x.kind === "image" ? x.src : "";
      expect(src).toMatch(/^\/spec\/[\w-]+\.webp$/);
      expect(existsSync(new URL(`../../public${src}`, import.meta.url))).toBe(true);
    });
  });
});

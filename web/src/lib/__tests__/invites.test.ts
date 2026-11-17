import { describe, expect, it } from "vitest";
import { byGaf, joinLink, printHtml, whatsappText, whatsappUrl } from "../invites";

const rows = [
  { id: "1", full_name: "נועה כהן", gaf_name: "גף ב", code: "ABCDE-FGH23" },
  { id: "2", full_name: "אבי לוי", gaf_name: "גף א", code: "KLMNP-QRS45" },
  { id: "3", full_name: "דנה בר", gaf_name: "גף א", code: "TUVWX-YZ234" },
];

describe("handing out join codes", () => {
  it("links to the join form with the code filled in", () => {
    expect(joinLink("https://x.dev", "ABCDE-FGH23")).toBe("https://x.dev/?join=1&code=ABCDE-FGH23");
  });
  it("writes a WhatsApp message by first name, with the code and the link", () => {
    const t = whatsappText(rows[0], "https://x.dev");
    expect(t.startsWith("היי נועה,")).toBe(true);
    expect(t).toContain("ABCDE-FGH23");
    expect(t).toContain("https://x.dev/?join=1&code=ABCDE-FGH23");
    expect(whatsappUrl("א ב")).toBe("https://wa.me/?text=%D7%90%20%D7%91");
  });
  it("groups by gaf and sorts by name", () => {
    expect(byGaf(rows).map((g) => [g.gaf, g.rows.map((r) => r.id)])).toEqual([
      ["גף א", ["2", "3"]],
      ["גף ב", ["1"]],
    ]);
  });
  it("prints a page per gaf with a card per soldier, names escaped", () => {
    const html = printHtml([...rows, { id: "4", full_name: "<b>x</b>", gaf_name: "גף ב", code: "Z" }], new Map([["Z", "data:image/png;base64,AA"]]), "https://x.dev", "15/12");
    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html.match(/class="card"/g)).toHaveLength(4);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("data:image/png;base64,AA");
  });
});

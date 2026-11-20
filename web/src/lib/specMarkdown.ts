/** A small reader for the spec's Markdown: headings, paragraphs, bullet lists, tables, images,
 *  **bold** and the two latex formulas. Nothing else is used in docs/spec.md. */

export type Inline = { text: string; bold: boolean };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; parts: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "image"; alt: string; src: string }
  | { kind: "formula"; parts: { text: string; sub: boolean }[] };

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  s.split(/(\*\*[^*]+\*\*)/).forEach((p) => {
    if (!p) return;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) out.push({ text: p.slice(2, -2), bold: true });
    else out.push({ text: p, bold: false });
  });
  return out;
}

/** "P = (W + D) \times S" → "P = (W + D) × S", with _x / _{xy} as subscripts */
export function formula(tex: string): { text: string; sub: boolean }[] {
  const t = tex
    .replace(/\\times/g, "×")
    .replace(/\\sum_i\s*/g, "Σᵢ ")
    .replace(/\\sum\s*/g, "Σ ")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1 / $2")
    .replace(/\\,|\\;/g, " ")
    .trim();
  const parts: { text: string; sub: boolean }[] = [];
  t.split(/(_\{[^}]*\}|_[A-Za-z0-9])/).forEach((p) => {
    if (!p) return;
    if (p.startsWith("_")) parts.push({ text: p.replace(/^_\{?|\}$/g, ""), sub: true });
    else parts.push({ text: p, sub: false });
  });
  return parts;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => inline(c.trim()));

export function slug(text: string, i: number): string {
  const m = text.match(/^(\d+)\./);
  return m ? `ch-${m[1]}` : `s-${i}`;
}

export function parseSpec(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const text = h[2].trim();
      blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, text, id: slug(text, blocks.length) });
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "formula", parts: formula(body.join(" ")) });
      continue;
    }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      blocks.push({ kind: "image", alt: img[1], src: img[2] });
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^\s*\|[\s\-:|]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      blocks.push({ kind: "table", head: cells(head ?? ""), rows: rest.map(cells) });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^[-*]\s+/, "")));
      blocks.push({ kind: "list", items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\||[-*]\s|!\[)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ kind: "paragraph", parts: inline(para.join(" ")) });
  }
  return blocks;
}

/** the chapters, for the table of contents */
export const chapters = (blocks: Block[]) =>
  blocks.filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading" && b.level === 2);

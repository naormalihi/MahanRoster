/**
 * "מסגרות לטעינה": which frameworks of the personnel file are loaded.
 *
 * The file may hold far more people than the unit. Each row has a framework path
 * ("מה"ן - מלמסים/מסגרת ענן/צוות תשתיות - מלמסים") or a gaf column. The tree has two levels:
 * the top framework (the first part of the path) and the gafim under it; a row whose path names
 * no gaf sits under its top as "בלי מסגרת". The choice is kept in the settings (roster_frameworks)
 * and offered again on the next load.
 */
import { frameworkName } from "./gafName";
import { gafFromFramework, type Mapping } from "./roster";

/** one row's place in the tree; top "" = the file has a gaf column only */
export interface Place {
  top: string;
  gaf: string | null;
}

export interface FrameworkSelection {
  /** top frameworks taken whole – a new gaf under one comes in by itself */
  tops: string[];
  /** single gafim: `${top}\u0001${gaf}`; gaf "" = the rows of that top with no gaf */
  units: string[];
  /** every top seen in a file so far – a top not in it is "חדש בקובץ" */
  seen: string[];
}

export interface TreeNode {
  top: string;
  count: number;
  gafim: { gaf: string | null; count: number }[];
}

const SEP = "\u0001";
export const unitKey = (top: string, gaf: string | null) => `${top}${SEP}${gaf ?? ""}`;

export const hasFrameworks = (m: Mapping) => Boolean(m.framework || m.gaf);

export function placeOf(r: Record<string, unknown>, m: Mapping): Place | null {
  const path = m.framework ? String(r[m.framework] ?? "").trim() : "";
  const gafCell = m.gaf ? String(r[m.gaf] ?? "").trim() : "";
  // a "מסגרת" column that holds the whole path is read like the framework column
  const full = path || (gafCell.includes("/") ? gafCell : "");
  if (full) {
    const top = full.split("/")[0].trim();
    const gaf = m.gaf && gafCell && !gafCell.includes("/") ? gafCell : gafFromFramework(full);
    return { top, gaf: gaf === null ? null : frameworkName(gaf) || null };
  }
  if (gafCell) return { top: "", gaf: frameworkName(gafCell) };
  return null;
}

export function buildTree(records: Record<string, unknown>[], m: Mapping): TreeNode[] {
  const tops = new Map<string, Map<string | null, number>>();
  for (const r of records) {
    const p = placeOf(r, m);
    if (!p) continue;
    const g = tops.get(p.top) ?? new Map<string | null, number>();
    g.set(p.gaf, (g.get(p.gaf) ?? 0) + 1);
    tops.set(p.top, g);
  }
  return [...tops.entries()]
    .map(([top, g]) => ({
      top,
      count: [...g.values()].reduce((a, b) => a + b, 0),
      gafim: [...g.entries()]
        .map(([gaf, count]) => ({ gaf, count }))
        // the gafim by name, "בלי מסגרת" last
        .sort((a, b) => (a.gaf === null ? 1 : b.gaf === null ? -1 : a.gaf.localeCompare(b.gaf, "he"))),
    }))
    .sort((a, b) => b.count - a.count || a.top.localeCompare(b.top, "he"));
}

export function isSelected(sel: FrameworkSelection, p: Place): boolean {
  return sel.tops.includes(p.top) || sel.units.includes(unitKey(p.top, p.gaf));
}

/** first load: everything; later: what was chosen, and a new top not chosen */
export function initialSelection(stored: FrameworkSelection | null, tree: TreeNode[]): FrameworkSelection {
  if (!stored) return { tops: tree.map((t) => t.top), units: [], seen: tree.map((t) => t.top) };
  return { ...stored };
}

export const isNewTop = (sel: FrameworkSelection, top: string) => !sel.seen.includes(top);

export function topState(sel: FrameworkSelection, node: TreeNode): "all" | "some" | "none" {
  if (sel.tops.includes(node.top)) return "all";
  const n = node.gafim.filter((g) => sel.units.includes(unitKey(node.top, g.gaf))).length;
  return n === 0 ? "none" : n === node.gafim.length ? "all" : "some";
}

export function toggleTop(sel: FrameworkSelection, node: TreeNode): FrameworkSelection {
  const units = sel.units.filter((u) => !u.startsWith(node.top + SEP));
  const on = topState(sel, node) !== "all";
  return { ...sel, tops: on ? [...sel.tops.filter((t) => t !== node.top), node.top] : sel.tops.filter((t) => t !== node.top), units };
}

export function toggleGaf(sel: FrameworkSelection, node: TreeNode, gaf: string | null): FrameworkSelection {
  const key = unitKey(node.top, gaf);
  // a top taken whole is spelled out as its gafim, then the one gaf is taken out
  let units = sel.tops.includes(node.top)
    ? [...sel.units.filter((u) => !u.startsWith(node.top + SEP)), ...node.gafim.map((g) => unitKey(node.top, g.gaf))]
    : [...sel.units];
  const tops = sel.tops.filter((t) => t !== node.top);
  units = units.includes(key) ? units.filter((u) => u !== key) : [...units, key];
  // every gaf chosen = the top whole again
  const all = node.gafim.every((g) => units.includes(unitKey(node.top, g.gaf)));
  if (all) return { ...sel, tops: [...tops, node.top], units: units.filter((u) => !u.startsWith(node.top + SEP)) };
  return { ...sel, tops, units };
}

export function setAll(sel: FrameworkSelection, tree: TreeNode[], on: boolean): FrameworkSelection {
  return { ...sel, tops: on ? tree.map((t) => t.top) : [], units: [] };
}

/** saved with the file's tops marked as seen */
export function forSaving(sel: FrameworkSelection, tree: TreeNode[]): FrameworkSelection {
  return { tops: [...new Set(sel.tops)], units: [...new Set(sel.units)], seen: [...new Set([...sel.seen, ...tree.map((t) => t.top)])] };
}

export function countSelected(sel: FrameworkSelection, tree: TreeNode[]): number {
  return tree.reduce(
    (n, t) => n + t.gafim.reduce((m, g) => m + (isSelected(sel, { top: t.top, gaf: g.gaf }) ? g.count : 0), 0),
    0,
  );
}

/** "מה"ן - מלמסים / מסגרת ענן" – for the moved-out warning */
export function placeLabel(p: Place): string {
  return [p.top, p.gaf ?? "ישירות תחת המסגרת"].filter(Boolean).join(" / ");
}

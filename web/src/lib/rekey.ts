import type { ExistingSoldier, SoldierRecord } from "./roster";

/**
 * Changing a forgotten unit key without losing history: the full roster is loaded with a new key,
 * every row is matched to an existing soldier by name (and checked by gaf, rank, gender and
 * enlistment date), and after approval the matched soldiers get their new soldier_key.
 */

export interface RekeyRow {
  incoming: SoldierRecord; // soldier_key = the key under the new unit key
  candidates: ExistingSoldier[]; // same name, best match first
  sure: boolean; // one namesake on each side and most details agree
}

export const normName = (s: string) =>
  s
    .replace(/[״"”“]/g, '"')
    .replace(/[׳'’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * How well a row fits an existing soldier: enlistment date 3, gaf 2, gender 2, rank 1 (rank changes
 * most often between loads). Empty on either side does not count.
 */
export function agreement(a: SoldierRecord, b: SoldierRecord): number {
  const same = (x: unknown, y: unknown) => x !== null && x !== undefined && x !== "" && x === y;
  return (
    (same(a.enlistment_date, b.enlistment_date) ? 3 : 0) +
    (same(a.gaf_name, b.gaf_name) ? 2 : 0) +
    (same(a.gender, b.gender) ? 2 : 0) +
    (same(a.rank_name, b.rank_name) ? 1 : 0)
  );
}

export function matchForRekey(incoming: SoldierRecord[], existing: ExistingSoldier[]): RekeyRow[] {
  const byName = new Map<string, ExistingSoldier[]>();
  for (const s of existing) byName.set(normName(s.full_name), [...(byName.get(normName(s.full_name)) ?? []), s]);
  const incomingNames = new Map<string, number>();
  for (const r of incoming) incomingNames.set(normName(r.full_name), (incomingNames.get(normName(r.full_name)) ?? 0) + 1);
  return incoming.map((r) => {
    const candidates = [...(byName.get(normName(r.full_name)) ?? [])].sort((a, b) => agreement(r, b) - agreement(r, a) || Number(b.is_active) - Number(a.is_active));
    const sure = candidates.length === 1 && incomingNames.get(normName(r.full_name)) === 1 && agreement(r, candidates[0]) >= 4;
    return { incoming: r, candidates, sure };
  });
}

/**
 * The default choice of each row: the best candidate when it stands out. An existing soldier that
 * two rows prefer is left for a person; then a row whose other candidates were all taken gets the
 * one left (two namesakes, one of them promoted).
 */
export function defaultPicks(rows: RekeyRow[]): Record<string, string> {
  const picks: Record<string, string> = {};
  for (const r of rows) {
    const [a, b] = r.candidates;
    if (a && (!b || agreement(r.incoming, a) > agreement(r.incoming, b))) picks[r.incoming.soldier_key] = a.id;
  }
  const count = new Map<string, number>();
  for (const id of Object.values(picks)) count.set(id, (count.get(id) ?? 0) + 1);
  for (const [k, id] of Object.entries(picks)) if (count.get(id)! > 1) delete picks[k];
  for (let changed = true; changed; ) {
    changed = false;
    const taken = new Set(Object.values(picks));
    for (const r of rows) {
      if (picks[r.incoming.soldier_key]) continue;
      const free = r.candidates.filter((c) => !taken.has(c.id));
      if (free.length === 1 && r.candidates.length > 1) {
        picks[r.incoming.soldier_key] = free[0].id;
        taken.add(free[0].id);
        changed = true;
      }
    }
  }
  return picks;
}

/** Existing soldiers chosen for more than one row. */
export function doublePicks(picks: Record<string, string>): string[] {
  const seen = new Set<string>(), twice = new Set<string>();
  for (const id of Object.values(picks)) (seen.has(id) ? twice : seen).add(id);
  return [...twice];
}

export const rekeyPairs = (picks: Record<string, string>) => Object.entries(picks).map(([key, id]) => ({ id, key }));

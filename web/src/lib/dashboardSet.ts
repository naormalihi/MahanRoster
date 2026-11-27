/**
 * A dashboard number opens כוח אדם with exactly the people it counts (2.70): the server's list
 * goes in session storage, and the page shows it with the tile's name until "הצגת כולם".
 */
const KEY = "mahanroster:dashboard-set";

export interface DashboardSet {
  label: string;
  ids: string[];
}

export function saveDashboardSet(s: DashboardSet) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: the page opens unfiltered */
  }
}

export function readDashboardSet(): DashboardSet | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v ? (JSON.parse(v) as DashboardSet) : null;
  } catch {
    return null;
  }
}

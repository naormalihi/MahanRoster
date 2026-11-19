/**
 * Seeing my duties without reception: after every successful load, the soldier's own duties
 * (and who he is) are kept on the device; without a connection the last copy is shown, with
 * the time it is from. Kept per user, removed at sign-out, and not shown after 14 days.
 * Only his own duties – no unit data, no lists of soldiers.
 */
import type { Me } from "./api";
import type { MyDuty } from "./me";

const PREFIX = "mahan.offline.v1.";
const LAST = `${PREFIX}last`;
export const MAX_AGE_DAYS = 14;

export interface OfflineCopy {
  savedAt: string;
  me: Me;
  duties: MyDuty[];
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveOffline(me: Me, duties: MyDuty[], now = new Date()) {
  const s = store();
  if (!s) return;
  try {
    s.setItem(PREFIX + me.userId, JSON.stringify({ savedAt: now.toISOString(), me, duties } satisfies OfflineCopy));
    s.setItem(LAST, me.userId);
  } catch {
    /* full or blocked: the copy is a convenience */
  }
}

/** The copy of this user (or of the last one signed in here), if not older than 14 days. */
export function readOffline(userId?: string | null, now = new Date()): OfflineCopy | null {
  const s = store();
  if (!s) return null;
  try {
    const id = userId ?? s.getItem(LAST);
    if (!id) return null;
    const raw = s.getItem(PREFIX + id);
    if (!raw) return null;
    const c = JSON.parse(raw) as OfflineCopy;
    if (!c?.savedAt || !Array.isArray(c.duties) || now.getTime() - Date.parse(c.savedAt) > MAX_AGE_DAYS * 86_400_000) return null;
    return c;
  } catch {
    return null;
  }
}

/** At sign-out: every copy on this device goes. */
export function clearOffline() {
  const s = store();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) s.removeItem(k);
    }
  } catch {
    /* nothing kept */
  }
}

/** A failure that means "no connection" rather than a refusal. */
export class OfflineError extends Error {
  constructor() {
    super("אין חיבור לאינטרנט");
    this.name = "OfflineError";
  }
}

export const isOfflineError = (e: unknown) =>
  e instanceof OfflineError ||
  (typeof navigator !== "undefined" && navigator.onLine === false) ||
  /Failed to fetch|NetworkError|Load failed|AuthRetryableFetchError/i.test(`${(e as Error)?.name ?? ""} ${(e as Error)?.message ?? ""}`);

/** "19.11 07:40" */
export const savedLabel = (iso: string) =>
  new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso))
    .replace(",", "");

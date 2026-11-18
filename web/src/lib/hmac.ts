/**
 * Soldier identity without ID numbers.
 *
 * The ID number (ת.ז) never leaves the browser. It is turned into
 * soldier_key = HMAC-SHA256(unit key, ID number) here, and only the key
 * is sent to the server. The unit key is a passphrase held by נע"ת התורנויות;
 * it is never sent. After it is confirmed it stays in this tab (sessionStorage) until sign-out
 * or the tab closes, so it is typed once per working session.
 */

const SESSION_KEY = "mahanroster.unitKey";

export function rememberUnitKey(key: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, key);
  } catch {
    /* storage blocked: the key is typed again next time */
  }
}

export function rememberedUnitKey(): string {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function forgetUnitKey() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing stored */
  }
}

const enc = new TextEncoder();
const KEY_CHECK_INPUT = "mahanroster-unit-key-check";

/**
 * An Israeli ID number (ת.ז): 5–9 digits, padded with leading zeros to 9, with a valid
 * check digit. Returns null when it is not an ID number (a typo fails the check digit).
 */
export function normalizeIdNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/[\s-]/g, "");
  if (!/^\d{5,9}$/.test(digits)) return null;
  const id = digits.padStart(9, "0");
  if (/^0+$/.test(id)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const d = Number(id[i]) * ((i % 2) + 1);
    sum += d > 9 ? d - 9 : d;
  }
  return sum % 10 === 0 ? id : null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function soldierKey(unitKey: string, idNumber: string): Promise<string> {
  return hmacHex(unitKey, idNumber);
}

/**
 * A fingerprint of the unit key, stored in settings on the first import. Later
 * imports compare against it, so a mistyped key cannot silently turn every
 * soldier into a "new" soldier. It does not reveal the key.
 */
export function unitKeyCheck(unitKey: string): Promise<string> {
  return hmacHex(unitKey, KEY_CHECK_INPUT);
}

export function unitKeyProblems(unitKey: string): string | null {
  if (unitKey.length < 16) return "מפתח היחידה צריך להיות באורך 16 תווים לפחות";
  return null;
}

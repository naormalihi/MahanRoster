/**
 * Soldier identity without the employee number.
 *
 * The employee number (מספר עובד) never leaves the browser. It is turned into
 * soldier_key = HMAC-SHA256(unit key, employee number) here, and only the key
 * is sent to the server. The unit key is a passphrase held by אחראי השיבוצים;
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
 * An employee number (מספר עובד): digits only (spaces and dashes are ignored), with no leading
 * zeros – Excel often drops them, so 00123 and 123 are the same person. Null when empty, all
 * zeros or not digits. No check digit: it is not an ID number.
 */
export function normalizeEmployeeNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/[\s-]/g, "");
  if (!/^\d{1,15}$/.test(digits)) return null;
  const n = digits.replace(/^0+/, "");
  return n || null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function soldierKey(unitKey: string, employeeNumber: string): Promise<string> {
  return hmacHex(unitKey, employeeNumber);
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

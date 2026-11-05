/**
 * Soldier identity without personal numbers.
 *
 * The personal number (מ"א) never leaves the browser. It is turned into
 * soldier_key = HMAC-SHA256(unit key, personal number) here, and only the key
 * is sent to the server. The unit key is a passphrase held by נע"ת התורנויות;
 * it is kept in memory for the session only and never stored or sent.
 */

const enc = new TextEncoder();
const KEY_CHECK_INPUT = "mahanroster-unit-key-check";

/** Digits only, 5–9 of them (leading zeros kept). Returns null when it is not a personal number. */
export function normalizePersonalNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/[\s-]/g, "");
  return /^\d{5,9}$/.test(digits) ? digits : null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function soldierKey(unitKey: string, personalNumber: string): Promise<string> {
  return hmacHex(unitKey, personalNumber);
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

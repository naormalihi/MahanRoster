/** A message for the sign-in screen after the app signed the user out (e.g. his service ended). */
const KEY = "mr.signInNotice";

export function setSignInNotice(text: string) {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    /* private mode: no message */
  }
}

/** The message, once. */
export function takeSignInNotice(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}

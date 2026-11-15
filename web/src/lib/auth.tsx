import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { canRead, isGafRole, getApi, type Api, type Me, type MfaState } from "./api";
import { forgetUnitKey } from "./hmac";

/**
 * Where the signed-in user stands:
 *   signedOut → (password) → mfa (staff only) → changePassword (if required) → ready
 */
export type AuthStage = "loading" | "signedOut" | "mfa" | "changePassword" | "ready" | "error";

interface AuthValue {
  api: Api | null;
  me: Me | null;
  stage: AuthStage;
  mfa: MfaState | null;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<Api | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [stage, setStage] = useState<AuthStage>("loading");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    let a = api;
    if (!a) {
      try {
        a = await getApi();
      } catch (e) {
        setError((e as Error).message);
        return setStage("error");
      }
    }
    if (!api) setApi(a);
    const who = await a.me();
    setMe(who);
    if (!who) return setStage("signedOut");
    // Staff, commanders and gaf representatives must pass a second factor; soldiers may if they set one up.
    const m = await a.mfaState();
    setMfa(m);
    if (m.needsVerify || ((canRead(who) || isGafRole(who)) && m.needsEnroll)) return setStage("mfa");
    if (who.mustChangePassword) return setStage("changePassword");
    setStage("ready");
  }, [api]);

  const signOut = useCallback(async () => {
    forgetUnitKey();
    await api?.signOut();
    setMe(null);
    setStage("signedOut");
  }, [api]);

  useEffect(() => {
    refresh().catch(() => setStage("signedOut"));
  }, [refresh]);

  return <Ctx.Provider value={{ api, me, stage, mfa, error, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

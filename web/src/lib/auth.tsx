import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getApi, isStaff, type Api, type Me, type MfaState } from "./api";

/**
 * Where the signed-in user stands:
 *   signedOut → (password) → mfa (staff only) → changePassword (if required) → ready
 */
export type AuthStage = "loading" | "signedOut" | "mfa" | "changePassword" | "ready";

interface AuthValue {
  api: Api | null;
  me: Me | null;
  stage: AuthStage;
  mfa: MfaState | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<Api | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [stage, setStage] = useState<AuthStage>("loading");

  const refresh = useCallback(async () => {
    const a = api ?? (await getApi());
    if (!api) setApi(a);
    const who = await a.me();
    setMe(who);
    if (!who) return setStage("signedOut");
    // Staff must pass a second factor; everyone else may if they set one up.
    const m = await a.mfaState();
    setMfa(m);
    if (m.needsVerify || (isStaff(who) && m.needsEnroll)) return setStage("mfa");
    if (who.mustChangePassword) return setStage("changePassword");
    setStage("ready");
  }, [api]);

  const signOut = useCallback(async () => {
    await api?.signOut();
    setMe(null);
    setStage("signedOut");
  }, [api]);

  useEffect(() => {
    refresh().catch(() => setStage("signedOut"));
  }, [refresh]);

  return <Ctx.Provider value={{ api, me, stage, mfa, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

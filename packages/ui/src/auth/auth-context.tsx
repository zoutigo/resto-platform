'use client';

import type { ApiClient, AuthResult, MeResponse } from '@resto/shared';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  api: ApiClient;
  audience: ApiClient['audience'];
  status: AuthStatus;
  me: MeResponse | null;
  /** Vrai après une déconnexion demandée par l'utilisateur : la page décide alors où aller. */
  signedOut: boolean;
  /** Recharge le profil (après ajout d'un email, changement de PIN…). */
  reload: () => Promise<MeResponse | null>;
  /** À appeler après toute authentification réussie : charge le profil. */
  signIn: (result?: AuthResult) => Promise<MeResponse | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const apply = useCallback((value: MeResponse | null) => {
    setMe(value);
    setStatus(value ? 'authenticated' : 'anonymous');
    if (value) setSignedOut(false);
    return value;
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .restore()
      .then((value) => !cancelled && apply(value))
      // Réseau coupé au chargement : on reste « anonyme », l'utilisateur peut réessayer.
      .catch(() => !cancelled && apply(null));
    return () => {
      cancelled = true;
    };
  }, [api, apply]);

  const reload = useCallback(async () => {
    try {
      return apply(await api.me());
    } catch {
      return apply(null);
    }
  }, [api, apply]);

  const signIn = useCallback(async () => reload(), [reload]);

  /** Ferme la session côté serveur ; en cas d'échec réseau l'erreur remonte et l'état est conservé. */
  const signOut = useCallback(async () => {
    await api.logout();
    setSignedOut(true);
    apply(null);
  }, [api, apply]);

  const value = useMemo<AuthContextValue>(
    () => ({ api, audience: api.audience, status, me, signedOut, reload, signIn, signOut }),
    [api, status, me, signedOut, reload, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return context;
}

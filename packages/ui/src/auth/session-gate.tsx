'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { Skeleton } from '@resto/ui/components/ui/skeleton';
import { useI18n } from '../i18n';
import { useAuth } from './auth-context';

export function FullPageSkeleton() {
  const { t } = useI18n();
  return (
    <main className="space-y-4 p-6" aria-busy="true" aria-label={t('common.loading')}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full max-w-md" />
    </main>
  );
}

interface Navigation {
  /** Remplace la page courante (le routeur de l'application est injecté). */
  navigate: (path: string) => void;
  pathname: string;
}

/**
 * Réserve une page aux utilisateurs connectés et impose le remplacement d'un PIN temporaire.
 * Le routeur est injecté : le paquet reste indépendant de Next.js.
 */
export function RequireAuth({
  children,
  navigate,
  pathname,
  loginPath = '/login',
  changePinPath,
}: Navigation & { children: ReactNode; loginPath?: string; changePinPath?: string }) {
  const { status, me, signedOut } = useAuth();
  const mustChange =
    Boolean(changePinPath) && status === 'authenticated' && me?.mustChangePin === true;
  const blocked = mustChange && pathname !== changePinPath;

  useEffect(() => {
    // Après une déconnexion demandée, la page navigue d'elle-même (accueil ou connexion).
    if (status === 'anonymous' && !signedOut) navigate(loginPath);
    else if (blocked && changePinPath) navigate(changePinPath);
  }, [status, signedOut, blocked, navigate, loginPath, changePinPath]);

  if (status !== 'authenticated' || blocked) return <FullPageSkeleton />;
  return <>{children}</>;
}

/**
 * Pages d'accès (connexion, inscription, récupération) : un utilisateur déjà connecté À
 * L'OUVERTURE de la page est renvoyé ailleurs. Si la connexion survient PENDANT un parcours
 * (l'inscription ouvre la session puis doit encore montrer le code de secours), la garde ne
 * redirige pas : c'est le parcours qui décide de la suite, via son `onDone`.
 */
export function GuestOnly({
  children,
  navigate,
  homePath = '/',
}: Pick<Navigation, 'navigate'> & { children: ReactNode; homePath?: string }) {
  const { status } = useAuth();
  const [arrivedAuthenticated, setArrivedAuthenticated] = useState<boolean | null>(null);

  // On fige le constat dès que le chargement de la session est terminé, une seule fois.
  useEffect(() => {
    if (status === 'loading' || arrivedAuthenticated !== null) return;
    const authenticated = status === 'authenticated';
    setArrivedAuthenticated(authenticated);
    if (authenticated) navigate(homePath);
  }, [status, arrivedAuthenticated, navigate, homePath]);

  if (arrivedAuthenticated === null || arrivedAuthenticated) return <FullPageSkeleton />;
  return <>{children}</>;
}

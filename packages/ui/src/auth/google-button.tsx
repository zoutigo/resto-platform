'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (r: { credential: string }) => void;
      }) => void;
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('google-script')), { once: true });
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Bouton « Continuer avec Google » (Google Identity Services). Sans identifiant client
 * configuré, rien n'est affiché. Le jeton renvoyé est vérifié par l'API, jamais ici.
 */
export function GoogleButton({
  clientId,
  onCredential,
}: {
  clientId?: string;
  onCredential: (idToken: string) => void;
}) {
  const { locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;

  useEffect(() => {
    if (!clientId || !container.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callback.current(response.credential),
        });
        window.google.accounts.id.renderButton(container.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: Math.min(container.current.clientWidth || 320, 400),
          locale,
        });
      })
      .catch(() => {
        // Script bloqué (réseau, bloqueur de publicités) : les autres méthodes restent disponibles.
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, locale]);

  if (!clientId) return null;
  return (
    <div ref={container} data-testid="google-button" className="flex min-h-10 justify-center" />
  );
}

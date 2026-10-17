'use client';

import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@resto/ui/components/ui/card';
import { LOCALES, type Locale, useI18n } from '../i18n';
import { Button } from '@resto/ui/components/ui/button';

/** Carte centrée, pensée mobile d'abord (pleine largeur sur petit écran). */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  header,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
}) {
  return (
    <main className="bg-muted/30 flex min-h-svh items-start justify-center p-4 sm:items-center">
      <div className="w-full max-w-md space-y-3">
        {header}
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1} className="text-xl">
              {title}
            </CardTitle>
            {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
          {footer ? (
            <CardFooter className="flex-col items-stretch gap-2 text-sm">{footer}</CardFooter>
          ) : null}
        </Card>
      </div>
    </main>
  );
}

/** Choix FR / EN ; l'application décide comment mémoriser (cookie + rechargement). */
export function LocaleSwitcher({ onChange }: { onChange: (locale: Locale) => void }) {
  const { locale, t } = useI18n();
  return (
    <div className="flex justify-end gap-1" role="group" aria-label={t('common.language')}>
      {LOCALES.map((code) => (
        <Button
          key={code}
          type="button"
          size="sm"
          variant={code === locale ? 'default' : 'ghost'}
          aria-pressed={code === locale}
          onClick={() => onChange(code)}
        >
          {code.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}

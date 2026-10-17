'use client';

import { Home, UserRound, Users } from 'lucide-react';
import { LocaleSwitcher, useI18n, storeLocale } from '@resto/ui';
import { NativeSelect, NativeSelectOption } from '@resto/ui/components/ui/native-select';
import { cn } from '@resto/ui/lib/utils';
import type { Role } from '@resto/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { useRestaurant } from '../restaurant/restaurant-context';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  roles?: Role[];
}

/**
 * Coque du back-office : barre basse sur mobile (pouce), menu latéral sur tablette/desktop.
 * Le menu ne propose que ce que le rôle permet.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { active, entries, select } = useRestaurant();

  const items: NavItem[] = [
    { href: '/', label: t('nav.dashboard'), icon: Home },
    { href: '/team', label: t('nav.team'), icon: Users, roles: ['OWNER', 'SUPERVISOR'] },
    { href: '/account', label: t('nav.account'), icon: UserRound },
  ];
  const visible = items.filter(
    (item) => !item.roles || (active && item.roles.includes(active.role)),
  );
  const isCurrent = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="bg-muted/30 min-h-svh md:flex">
      <aside
        className="bg-background hidden w-60 shrink-0 border-r md:block"
        aria-label={t('common.appName')}
      >
        <div className="p-4 text-lg font-semibold">{t('common.appName')}</div>
        <nav aria-label="Navigation principale" className="space-y-1 px-2">
          {visible.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isCurrent(href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                isCurrent(href) ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-svh flex-1 flex-col pb-16 md:pb-0">
        <header className="bg-background flex items-center justify-between gap-2 border-b px-4 py-2">
          {entries.length > 1 ? (
            <NativeSelect
              aria-label={t('dashboard.restaurant')}
              value={active?.restaurant.id ?? ''}
              onChange={(event) => select(event.target.value)}
            >
              {entries.map((e) => (
                <NativeSelectOption key={e.restaurant.id} value={e.restaurant.id}>
                  {e.restaurant.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <p className="truncate font-medium" data-testid="restaurant-name">
              {active?.restaurant.name}
            </p>
          )}
          <LocaleSwitcher
            onChange={(locale) => {
              storeLocale(locale);
              router.refresh();
            }}
          />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>

      <nav
        aria-label="Navigation principale"
        className="bg-background fixed inset-x-0 bottom-0 z-10 grid border-t md:hidden"
        style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        {visible.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent(href) ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center gap-1 py-2 text-xs font-medium',
              isCurrent(href) ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

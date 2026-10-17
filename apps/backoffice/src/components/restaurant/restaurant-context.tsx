'use client';

import type { Restaurant, Role } from '@resto/shared';
import { useAuth } from '@resto/ui';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface Entry {
  role: Role;
  restaurant: Restaurant;
}

interface RestaurantContextValue {
  status: 'loading' | 'ready' | 'error';
  entries: Entry[];
  /** Restaurant de travail (le dernier utilisé, sinon le premier). */
  active: Entry | null;
  select: (restaurantId: string) => void;
  reload: () => Promise<void>;
}

const RestaurantContext = createContext<RestaurantContextValue | null>(null);
const STORAGE_KEY = 'resto.activeRestaurant';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { api } = useAuth();
  const [status, setStatus] = useState<RestaurantContextValue['status']>('loading');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.myRestaurants();
      setEntries(list);
      setActiveId((current) => {
        const wanted = current ?? readStored();
        return (
          list.find((e) => e.restaurant.id === wanted)?.restaurant.id ??
          list[0]?.restaurant.id ??
          null
        );
      });
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = useCallback((restaurantId: string) => {
    setActiveId(restaurantId);
    try {
      localStorage.setItem(STORAGE_KEY, restaurantId);
    } catch {
      // stockage indisponible (navigation privée) : le choix vaut pour la session
    }
  }, []);

  const value = useMemo<RestaurantContextValue>(
    () => ({
      status,
      entries,
      active: entries.find((e) => e.restaurant.id === activeId) ?? null,
      select,
      reload: load,
    }),
    [status, entries, activeId, select, load],
  );
  return <RestaurantContext.Provider value={value}>{children}</RestaurantContext.Provider>;
}

export function useRestaurant(): RestaurantContextValue {
  const context = useContext(RestaurantContext);
  if (!context) throw new Error('useRestaurant doit être utilisé dans <RestaurantProvider>');
  return context;
}

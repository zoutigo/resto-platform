'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { type Resolver, type UseFormReturn, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useI18n } from '../i18n';

/** Traduit récursivement les `message` d'une arborescence d'erreurs (clés i18n des schémas). */
function translateNode(node: unknown, tError: (key: string) => string): unknown {
  if (Array.isArray(node)) return node.map((item) => translateNode(item, tError));
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'ref') out[key] = value;
      else if (key === 'message' && typeof value === 'string') out[key] = tError(value);
      else out[key] = translateNode(value, tError);
    }
    return out;
  }
  return node;
}

// Les formulaires ont des types d'entrée et de sortie différents (transformations Zod) :
// les champs partagés acceptent n'importe lequel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyForm = UseFormReturn<any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = Resolver<any, any, any>;

export function translatedResolver(
  base: AnyResolver,
  tError: (key: string) => string,
): AnyResolver {
  return async (values, context, options) => {
    const result = await base(values, context, options);
    if (!result.errors || Object.keys(result.errors).length === 0) return result;
    return { ...result, errors: translateNode(result.errors, tError) as typeof result.errors };
  };
}

/**
 * Formulaire react-hook-form branché sur un schéma Zod partagé avec l'API :
 * validation à la saisie (`onChange`) et messages traduits dans la langue courante.
 */
export function useZodForm<S extends z.ZodType>(schema: S, defaultValues: Record<string, unknown>) {
  const { tError } = useI18n();
  const resolver = useMemo(
    () => translatedResolver(zodResolver(schema as never) as AnyResolver, tError),
    [schema, tError],
  );
  return useForm({
    resolver: resolver as AnyResolver,
    defaultValues,
    mode: 'onChange',
  }) as AnyForm;
}

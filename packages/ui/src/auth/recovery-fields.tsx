'use client';

import { useWatch } from 'react-hook-form';
import { RECOVERY_QUESTIONS, type RecoveryQuestion } from '@resto/shared';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@resto/ui/components/ui/form';
import { Input } from '@resto/ui/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@resto/ui/components/ui/native-select';
import { useI18n } from '../i18n';
import type { AnyForm } from '../feedback/zod-form';

const currentYear = () => new Date().getFullYear();

/** Date de naissance : trois menus natifs (légers et ergonomiques sur Android d'entrée de gamme). */
export function BirthDateFields({ form, name }: { form: AnyForm; name: string }) {
  const { t, messages } = useI18n();
  const years = Array.from(
    { length: currentYear() - 10 - 1900 + 1 },
    (_, i) => currentYear() - 10 - i,
  );
  const part = (key: 'day' | 'month' | 'year') => `${name}.${key}`;

  const select = (
    key: 'day' | 'month' | 'year',
    label: string,
    options: { value: number; label: string }[],
    grow: string,
  ) => (
    <FormField
      control={form.control}
      name={part(key)}
      render={({ field }) => (
        <FormItem className={`min-w-0 ${grow} [&_[data-slot=native-select-wrapper]]:w-full`}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <NativeSelect
              {...field}
              value={field.value ?? ''}
              className="w-full"
              onChange={(event) => field.onChange(event.target.value)}
            >
              <NativeSelectOption value="">—</NativeSelectOption>
              {options.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormControl>
        </FormItem>
      )}
    />
  );

  // L'erreur peut porter sur le groupe ou sur l'un des trois menus : on affiche la première.
  const group = (
    form.formState.errors as Record<string, Record<string, { message?: string }> | undefined>
  )[name];
  const error = (group?.message as unknown as string | undefined)
    ? { message: group?.message as unknown as string }
    : (group?.day ?? group?.month ?? group?.year);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('fields.birthDate')}</legend>
      <div className="flex gap-2">
        {select(
          'day',
          t('fields.day'),
          Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
          'basis-[22%]',
        )}
        {select(
          'month',
          t('fields.month'),
          messages.months.map((label, i) => ({ value: i + 1, label })),
          'basis-[42%]',
        )}
        {select(
          'year',
          t('fields.year'),
          years.map((y) => ({ value: y, label: String(y) })),
          'basis-[30%]',
        )}
      </div>
      {error?.message ? (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * `count` questions à choisir parmi quatre, deux fois la même impossible (les questions déjà
 * prises sont retirées des autres menus).
 */
export function RecoveryAnswersFields({
  form,
  name,
  count,
}: {
  form: AnyForm;
  name: string;
  count: number;
}) {
  const { t } = useI18n();
  const answers = (useWatch({ control: form.control, name }) ?? []) as { question?: string }[];
  const taken = answers.map((a) => a?.question).filter(Boolean);

  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, index) => {
        const chosen = answers[index]?.question as RecoveryQuestion | undefined;
        return (
          <div key={index} className="space-y-2 rounded-lg border p-3">
            <FormField
              control={form.control}
              name={`${name}.${index}.question`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.register.questionLabel', { n: index + 1 })}</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} value={field.value ?? ''} className="w-full">
                      <NativeSelectOption value="">
                        {t('auth.register.chooseQuestion')}
                      </NativeSelectOption>
                      {RECOVERY_QUESTIONS.filter((q) => q === chosen || !taken.includes(q)).map(
                        (q) => (
                          <NativeSelectOption key={q} value={q}>
                            {t(`questions.${q}`)}
                          </NativeSelectOption>
                        ),
                      )}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`${name}.${index}.answer`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">{t('fields.answer')}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      placeholder={t('fields.answer')}
                      aria-label={`${t('fields.answer')} ${index + 1}`}
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        );
      })}
      {(() => {
        const err = (
          form.formState.errors as Record<
            string,
            { message?: string; root?: { message?: string } } | undefined
          >
        )[name as string];
        const message = err?.message ?? err?.root?.message;
        return message ? (
          <p role="alert" className="text-destructive text-sm">
            {message}
          </p>
        ) : null;
      })()}
    </div>
  );
}

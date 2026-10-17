'use client';

import {
  type Audience,
  MIN_RECOVERY_ANSWERS,
  registerCustomerSchema,
  registerOwnerSchema,
} from '@resto/shared';
import { useMemo, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@resto/ui/components/ui/button';
import { Form } from '@resto/ui/components/ui/form';
import { handleSubmitError } from '../feedback/handle-submit-error';
import { notify } from '../feedback/notify';
import { useZodForm } from '../feedback/zod-form';
import { useI18n } from '../i18n';
import { useAuth } from './auth-context';
import { FormRootError, PhoneField, PinField, SubmitButton, TextField } from './form-parts';
import { RecoveryCodeScreen } from './recovery-code-screen';
import { BirthDateFields, RecoveryAnswersFields } from './recovery-fields';

interface Values {
  name?: string;
  firstName?: string;
  lastName?: string;
  phone: string;
  pin: string;
  pinConfirm: string;
  birthDate: { day: string; month: string; year: string };
  recoveryAnswers: { question: string; answer: string }[];
}

const STEPS = ['identity', 'pin', 'recovery'] as const;

/**
 * Inscription téléphone + PIN en trois étapes courtes (une idée par écran), puis affichage
 * obligatoire du code de secours. Restaurateur : prénom/nom + deux questions ; client : nom + une.
 */
export function RegisterPhoneForm({
  audience,
  onDone,
}: {
  audience: Audience;
  onDone: () => void;
}) {
  const translator = useI18n();
  const { t } = translator;
  const { api, signIn } = useAuth();
  const staff = audience === 'staff';
  const answersCount = staff ? MIN_RECOVERY_ANSWERS.owner : MIN_RECOVERY_ANSWERS.customer;

  const [step, setStep] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const schema = (staff
    ? registerOwnerSchema
    : registerCustomerSchema) as unknown as z.ZodType<Values>;
  const defaults = useMemo<Values>(
    () => ({
      ...(staff ? { firstName: '', lastName: '' } : { name: '' }),
      phone: '',
      pin: '',
      pinConfirm: '',
      birthDate: { day: '', month: '', year: '' },
      recoveryAnswers: Array.from({ length: answersCount }, () => ({ question: '', answer: '' })),
    }),
    [staff, answersCount],
  );
  const form = useZodForm(schema, defaults as never);

  const stepFields: Record<(typeof STEPS)[number], (keyof Values)[]> = {
    identity: staff ? ['firstName', 'lastName', 'phone'] : ['name', 'phone'],
    pin: ['pin', 'pinConfirm'],
    recovery: ['birthDate', 'recoveryAnswers'],
  };
  const last = STEPS.length - 1;

  async function next() {
    const fields = stepFields[STEPS[step]!];
    const ok = await form.trigger(fields as never);
    // La confirmation du PIN est vérifiée ici même si le reste du formulaire n'est pas encore rempli.
    if (STEPS[step] === 'pin') {
      const { pin, pinConfirm } = form.getValues() as Values;
      if (ok && pin !== pinConfirm) {
        form.setError('pinConfirm' as never, {
          type: 'validate',
          message: translator.tError('pin.mismatch'),
        });
        return;
      }
    }
    if (ok) setStep((s) => s + 1);
  }

  async function submit(values: unknown) {
    try {
      const result = await api.registerWithPhone(values);
      await signIn(result);
      notify.success(t('auth.register.success'));
      setRecoveryCode(result.recoveryCode ?? '');
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  if (recoveryCode !== null) {
    return recoveryCode ? (
      <RecoveryCodeScreen code={recoveryCode} onContinue={onDone} />
    ) : (
      <Button className="w-full" onClick={onDone}>
        {t('common.continue')}
      </Button>
    );
  }

  const titles = {
    identity: t('auth.register.stepIdentity'),
    pin: t('auth.register.stepPin'),
    recovery: t('auth.register.stepRecovery'),
  };
  const current = STEPS[step]!;

  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (step < last) void next();
          else void form.handleSubmit(submit)(event);
        }}
      >
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {t('common.step', { current: step + 1, total: STEPS.length })} — {titles[current]}
        </p>

        {current === 'identity' && (
          <div className="space-y-4">
            {staff ? (
              <>
                <TextField
                  form={form}
                  name={'firstName' as never}
                  label={t('fields.firstName')}
                  autoComplete="given-name"
                />
                <TextField
                  form={form}
                  name={'lastName' as never}
                  label={t('fields.lastName')}
                  autoComplete="family-name"
                />
              </>
            ) : (
              <TextField
                form={form}
                name={'name' as never}
                label={t('fields.name')}
                autoComplete="name"
              />
            )}
            <PhoneField
              form={form}
              name={'phone' as never}
              label={t('fields.phone')}
              description={t('fields.phoneHint')}
            />
          </div>
        )}

        {current === 'pin' && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">{t('auth.register.pinHelp')}</p>
            <PinField
              form={form}
              name={'pin' as never}
              label={t('fields.pin')}
              autoComplete="new-password"
            />
            <PinField
              form={form}
              name={'pinConfirm' as never}
              label={t('fields.pinConfirm')}
              autoComplete="new-password"
            />
          </div>
        )}

        {current === 'recovery' && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {staff ? t('auth.register.recoveryHelpOwner') : t('auth.register.recoveryHelp')}
            </p>
            <BirthDateFields form={form} name={'birthDate' as never} />
            <RecoveryAnswersFields
              form={form}
              name={'recoveryAnswers' as never}
              count={answersCount}
            />
          </div>
        )}

        <FormRootError form={form} />

        <div className="flex gap-2">
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
              {t('common.back')}
            </Button>
          ) : null}
          {step < last ? (
            // Bouton d'envoi : la touche Entrée fait aussi avancer d'étape (voir onSubmit).
            <Button type="submit" className="flex-1">
              {t('common.continue')}
            </Button>
          ) : (
            <SubmitButton
              className="flex-1"
              pending={form.formState.isSubmitting}
              pendingLabel={t('auth.register.submitting')}
            >
              {t('auth.register.submit')}
            </SubmitButton>
          )}
        </div>
      </form>
    </Form>
  );
}

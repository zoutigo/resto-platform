'use client';

import {
  type Audience,
  completeRecoverySchema,
  forgotSchema,
  MIN_RECOVERY_ANSWERS,
  recoverEmailSchema,
  recoverWithCodeSchema,
  recoverWithQuestionsSchema,
} from '@resto/shared';
import { useEffect, useState } from 'react';
import { useWatch } from 'react-hook-form';
import type { FieldValues } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@resto/ui/components/ui/button';
import { Form } from '@resto/ui/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '@resto/ui/components/ui/alert';
import { handleSubmitError } from '../feedback/handle-submit-error';
import { notify } from '../feedback/notify';
import { useZodForm } from '../feedback/zod-form';
import { useI18n } from '../i18n';
import { useAuth } from './auth-context';
import {
  CodeField,
  FormRootError,
  PasswordField,
  PhoneField,
  PinField,
  SubmitButton,
  TextField,
} from './form-parts';
import { RecoveryCodeScreen } from './recovery-code-screen';
import { BirthDateFields, RecoveryAnswersFields } from './recovery-fields';

type Method = 'menu' | 'code' | 'questions' | 'email' | 'complete';

type Outcome =
  | { kind: 'done'; recoveryCode?: string; restricted?: boolean }
  | { kind: 'pending'; availableAt: string }
  | { kind: 'code'; recoveryCode: string };

const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Douala',
  }).format(new Date(iso));

function CodeMethod({ onOutcome }: { onOutcome: (o: Outcome) => void }) {
  const translator = useI18n();
  const { t } = translator;
  const { api, signIn } = useAuth();
  const form = useZodForm(recoverWithCodeSchema, {
    phone: '',
    recoveryCode: '',
    newPin: '',
    newPinConfirm: '',
  });

  async function submit(values: unknown) {
    try {
      const result = await api.recoverWithCode(values);
      await signIn(result);
      notify.success(t('auth.forgot.done'));
      onOutcome({ kind: 'code', recoveryCode: result.recoveryCode ?? '' });
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <PhoneField form={form} name="phone" label={t('fields.phone')} />
        <TextField
          form={form}
          name="recoveryCode"
          label={t('fields.recoveryCode')}
          autoComplete="off"
          description="ABCD-EFGH-JKMN"
        />
        <PinField
          form={form}
          name="newPin"
          label={t('fields.newPin')}
          autoComplete="new-password"
        />
        <PinField
          form={form}
          name="newPinConfirm"
          label={t('fields.newPinConfirm')}
          autoComplete="new-password"
        />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.forgot.submitCode')}
        </SubmitButton>
      </form>
    </Form>
  );
}

function QuestionsMethod({
  audience,
  onOutcome,
}: {
  audience: Audience;
  onOutcome: (o: Outcome) => void;
}) {
  const translator = useI18n();
  const { t } = translator;
  const { api, signIn } = useAuth();
  const count = audience === 'staff' ? MIN_RECOVERY_ANSWERS.owner : MIN_RECOVERY_ANSWERS.customer;
  const form = useZodForm(
    recoverWithQuestionsSchema as unknown as z.ZodType<FieldValues, FieldValues>,
    {
      phone: '',
      birthDate: { day: '', month: '', year: '' },
      recoveryAnswers: Array.from({ length: count }, () => ({ question: '', answer: '' })),
      newPin: '',
      newPinConfirm: '',
    },
  );

  async function submit(values: unknown) {
    try {
      const result = await api.recoverWithQuestions(values);
      if (result.status === 'pending') {
        onOutcome({
          kind: 'pending',
          availableAt: (result as { availableAt: string }).availableAt,
        });
        return;
      }
      await signIn(result);
      notify.success(t('auth.forgot.done'));
      onOutcome({ kind: 'done', restricted: true });
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <PhoneField form={form} name="phone" label={t('fields.phone')} />
        <BirthDateFields form={form} name="birthDate" />
        <RecoveryAnswersFields form={form} name="recoveryAnswers" count={count} />
        <PinField
          form={form}
          name="newPin"
          label={t('fields.newPin')}
          autoComplete="new-password"
        />
        <PinField
          form={form}
          name="newPinConfirm"
          label={t('fields.newPinConfirm')}
          autoComplete="new-password"
        />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.forgot.submitQuestions')}
        </SubmitButton>
      </form>
    </Form>
  );
}

/** Deuxième temps de la récupération par email : le code autorise un nouveau PIN ou mot de passe. */
function EmailRecoverForm({
  email,
  target,
  code,
  onCodeChange,
  onOutcome,
}: {
  email: string;
  target: 'pin' | 'password';
  /** Le code saisi survit au passage de « PIN » à « mot de passe ». */
  code: string;
  onCodeChange: (code: string) => void;
  onOutcome: (o: Outcome) => void;
}) {
  const translator = useI18n();
  const { t } = translator;
  const { api, signIn } = useAuth();
  // Chaque variante ne porte que ses champs : le schéma partagé exige « l'un ou l'autre ».
  const form = useZodForm(
    recoverEmailSchema,
    target === 'pin'
      ? { email, code, newPin: '', newPinConfirm: '' }
      : { email, code, newPassword: '' },
  );
  const typedCode = useWatch({ control: form.control, name: 'code' }) as string;
  useEffect(() => onCodeChange(typedCode ?? ''), [typedCode, onCodeChange]);

  async function submit(values: unknown) {
    try {
      const result = await api.recoverWithEmail(values);
      await signIn(result);
      notify.success(t('auth.forgot.done'));
      onOutcome({ kind: 'done' });
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <CodeField form={form} name="code" label={t('fields.emailCode')} />
        {target === 'pin' ? (
          <>
            <PinField
              form={form}
              name="newPin"
              label={t('fields.newPin')}
              autoComplete="new-password"
            />
            <PinField
              form={form}
              name="newPinConfirm"
              label={t('fields.newPinConfirm')}
              autoComplete="new-password"
            />
          </>
        ) : (
          <PasswordField
            form={form}
            name="newPassword"
            label={t('fields.newPassword')}
            autoComplete="new-password"
          />
        )}
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.forgot.submitEmailRecover')}
        </SubmitButton>
      </form>
    </Form>
  );
}

function EmailMethod({ onOutcome }: { onOutcome: (o: Outcome) => void }) {
  const translator = useI18n();
  const { t, locale } = translator;
  const { api } = useAuth();
  const [email, setEmail] = useState<string | null>(null);
  const [target, setTarget] = useState<'pin' | 'password'>('pin');
  const [code, setCode] = useState('');
  const askForm = useZodForm(forgotSchema, { email: '', locale });

  async function ask(values: { email: string }) {
    try {
      await api.forgotByEmail({ ...values, locale });
      setEmail(values.email);
      notify.success(t('auth.forgot.emailSent'));
    } catch (error) {
      handleSubmitError(error, { form: askForm, translator });
    }
  }

  if (!email) {
    return (
      <Form {...askForm}>
        <form onSubmit={askForm.handleSubmit(ask)} className="space-y-4" noValidate>
          <TextField
            form={askForm}
            name="email"
            label={t('fields.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
          />
          <FormRootError form={askForm} />
          <SubmitButton pending={askForm.formState.isSubmitting}>
            {t('auth.forgot.sendEmailCode')}
          </SubmitButton>
        </form>
      </Form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" role="status">
        {t('auth.email.sentTo', { email })}
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('auth.forgot.choosePasswordOrPin')}</legend>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={target === 'pin' ? 'default' : 'outline'}
            aria-pressed={target === 'pin'}
            onClick={() => setTarget('pin')}
          >
            {t('auth.forgot.resetPin')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={target === 'password' ? 'default' : 'outline'}
            aria-pressed={target === 'password'}
            onClick={() => setTarget('password')}
          >
            {t('auth.forgot.resetPassword')}
          </Button>
        </div>
      </fieldset>
      <EmailRecoverForm
        key={target}
        email={email}
        target={target}
        code={code}
        onCodeChange={setCode}
        onOutcome={onOutcome}
      />
    </div>
  );
}

/** Finalise une récupération différée avec le PIN choisi au départ. */
export function CompleteRecoveryForm({ onDone }: { onDone: () => void }) {
  const translator = useI18n();
  const { t, locale } = translator;
  const { api, signIn } = useAuth();
  const form = useZodForm(completeRecoverySchema, { phone: '', newPin: '' });

  async function submit(values: unknown) {
    try {
      const result = await api.completeRecovery(values);
      await signIn(result);
      notify.success(t('auth.forgot.done'));
      onDone();
    } catch (error) {
      const message = handleSubmitError(error, { form, translator });
      const availableAt = (error as { data?: { availableAt?: string } }).data?.availableAt;
      if (availableAt) {
        form.setError('root.server' as never, {
          type: 'server',
          message: t('auth.forgot.notYet', { date: formatDate(availableAt, locale) }) || message,
        });
      }
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <p className="text-muted-foreground text-sm">{t('auth.forgot.completeText')}</p>
        <PhoneField form={form} name="phone" label={t('fields.phone')} />
        <PinField
          form={form}
          name="newPin"
          label={t('fields.newPin')}
          autoComplete="new-password"
        />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.forgot.complete')}
        </SubmitButton>
      </form>
    </Form>
  );
}

/**
 * « Accès perdu » : code de secours, questions secrètes, ou code reçu par email.
 * Une récupération différée (compte avec rôle) affiche la date d'effet.
 */
export function ForgotFlow({ audience, onDone }: { audience: Audience; onDone: () => void }) {
  const { t, locale } = useI18n();
  const [method, setMethod] = useState<Method>('menu');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (outcome?.kind === 'code') {
    return outcome.recoveryCode ? (
      <RecoveryCodeScreen
        code={outcome.recoveryCode}
        intro={t('auth.forgot.newRecoveryCode')}
        onContinue={onDone}
      />
    ) : (
      <Button className="w-full" onClick={onDone}>
        {t('common.continue')}
      </Button>
    );
  }

  if (outcome?.kind === 'pending') {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>{t('auth.forgot.pendingTitle')}</AlertTitle>
          <AlertDescription>
            {t('auth.forgot.pendingText', { date: formatDate(outcome.availableAt, locale) })}
            <br />
            {t('auth.forgot.pendingCancelHint')}
          </AlertDescription>
        </Alert>
        <Button
          className="w-full"
          variant="outline"
          onClick={() => {
            setOutcome(null);
            setMethod('complete');
          }}
        >
          {t('auth.forgot.completeTitle')}
        </Button>
      </div>
    );
  }

  if (outcome?.kind === 'done') {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>{t('auth.forgot.doneTitle')}</AlertTitle>
          <AlertDescription>
            {outcome.restricted ? t('auth.forgot.restrictedNotice') : t('auth.forgot.done')}
          </AlertDescription>
        </Alert>
        <Button className="w-full" onClick={onDone}>
          {t('common.continue')}
        </Button>
      </div>
    );
  }

  if (method === 'menu') {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">{t('auth.forgot.subtitle')}</p>
        <Button
          className="w-full justify-start"
          variant="outline"
          onClick={() => setMethod('code')}
        >
          {t('auth.forgot.methodCode')}
        </Button>
        <Button
          className="w-full justify-start"
          variant="outline"
          onClick={() => setMethod('questions')}
        >
          {t('auth.forgot.methodQuestions')}
        </Button>
        <Button
          className="w-full justify-start"
          variant="outline"
          onClick={() => setMethod('email')}
        >
          {t('auth.forgot.methodEmail')}
        </Button>
        <Button
          className="w-full justify-start"
          variant="ghost"
          onClick={() => setMethod('complete')}
        >
          {t('auth.forgot.completeTitle')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => setMethod('menu')}
      >
        ← {t('common.back')}
      </Button>
      {method === 'code' && <CodeMethod onOutcome={setOutcome} />}
      {method === 'questions' && <QuestionsMethod audience={audience} onOutcome={setOutcome} />}
      {method === 'email' && <EmailMethod onOutcome={setOutcome} />}
      {method === 'complete' && <CompleteRecoveryForm onDone={onDone} />}
    </div>
  );
}

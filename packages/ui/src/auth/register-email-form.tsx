'use client';

import { registerEmailSchema, verifyRegistrationSchema, type MeResponse } from '@resto/shared';
import { useState } from 'react';
import { Button } from '@resto/ui/components/ui/button';
import { Form } from '@resto/ui/components/ui/form';
import { handleSubmitError } from '../feedback/handle-submit-error';
import { notify } from '../feedback/notify';
import { useZodForm } from '../feedback/zod-form';
import { useI18n } from '../i18n';
import { useAuth } from './auth-context';
import { CodeField, FormRootError, PasswordField, SubmitButton, TextField } from './form-parts';

function VerifyStep({
  email,
  onBack,
  onDone,
}: {
  email: string;
  onBack: () => void;
  onDone: (me: MeResponse | null) => void;
}) {
  const translator = useI18n();
  const { t, locale } = translator;
  const { api, signIn } = useAuth();
  const form = useZodForm(verifyRegistrationSchema, { email, code: '' });

  async function submit(values: { email: string; code: string }) {
    try {
      const result = await api.verifyRegistrationCode(values);
      const me = await signIn(result);
      notify.success(t('auth.email.accountCreated'));
      onDone(me);
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  async function resend() {
    try {
      await api.resendRegistrationCode({ email, locale });
      notify.success(t('auth.email.resent'));
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <p className="text-sm" role="status">
          {t('auth.email.sentTo', { email })}
        </p>
        <CodeField form={form} name="code" label={t('fields.emailCode')} />
        <FormRootError form={form} />
        <SubmitButton
          pending={form.formState.isSubmitting}
          pendingLabel={t('auth.email.verifying')}
        >
          {t('auth.email.verify')}
        </SubmitButton>
        <div className="flex justify-between">
          <Button type="button" variant="link" className="px-0" onClick={resend}>
            {t('auth.email.resend')}
          </Button>
          <Button type="button" variant="link" className="px-0" onClick={onBack}>
            {t('auth.email.changeEmail')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** Inscription par email : formulaire, puis code reçu par email (le compte naît à la vérification). */
export function RegisterEmailForm({ onDone }: { onDone: (me: MeResponse | null) => void }) {
  const translator = useI18n();
  const { t, locale } = translator;
  const { api } = useAuth();
  const [email, setEmail] = useState<string | null>(null);
  const form = useZodForm(registerEmailSchema, {
    name: '',
    email: '',
    password: '',
    passwordConfirm: '',
    locale,
  });

  if (email) return <VerifyStep email={email} onBack={() => setEmail(null)} onDone={onDone} />;

  async function submit(values: { email: string } & Record<string, unknown>) {
    try {
      await api.registerWithEmail({ ...values, locale });
      setEmail(values.email);
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <TextField form={form} name="name" label={t('fields.name')} autoComplete="name" />
        <TextField
          form={form}
          name="email"
          label={t('fields.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        <PasswordField
          form={form}
          name="password"
          label={t('fields.password')}
          autoComplete="new-password"
        />
        <PasswordField
          form={form}
          name="passwordConfirm"
          label={t('fields.passwordConfirm')}
          autoComplete="new-password"
        />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting} pendingLabel={t('auth.email.sending')}>
          {t('auth.email.send')}
        </SubmitButton>
      </form>
    </Form>
  );
}

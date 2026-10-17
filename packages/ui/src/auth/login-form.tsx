'use client';

import { loginEmailSchema, loginPhoneSchema, type MeResponse } from '@resto/shared';
import { useState } from 'react';
import { Form } from '@resto/ui/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@resto/ui/components/ui/tabs';
import { handleSubmitError } from '../feedback/handle-submit-error';
import { notify } from '../feedback/notify';
import { useZodForm } from '../feedback/zod-form';
import { useI18n } from '../i18n';
import { useAuth } from './auth-context';
import {
  FormRootError,
  PasswordField,
  PhoneField,
  PinField,
  SubmitButton,
  TextField,
} from './form-parts';
import { GoogleButton } from './google-button';

interface LoginFormProps {
  onSuccess: (me: MeResponse | null) => void;
  /** Identifiant client Google ; sans lui, pas de bouton Google. */
  googleClientId?: string;
}

function PhoneLogin({ onSuccess }: Pick<LoginFormProps, 'onSuccess'>) {
  const translator = useI18n();
  const { t } = translator;
  const { api, signIn } = useAuth();
  const form = useZodForm(loginPhoneSchema, { phone: '', pin: '' });

  async function submit(values: { phone: string; pin: string }) {
    try {
      const result = await api.loginWithPhone(values);
      const me = await signIn(result);
      if (result.recoveryCancelled) notify.info(t('auth.login.recoveryCancelled'));
      notify.success(t('auth.login.success'));
      onSuccess(me);
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <PhoneField form={form} name="phone" label={t('fields.phone')} />
        <PinField form={form} name="pin" label={t('fields.pin')} autoComplete="current-password" />
        <FormRootError form={form} />
        <SubmitButton
          pending={form.formState.isSubmitting}
          pendingLabel={t('auth.login.submitting')}
        >
          {t('auth.login.submit')}
        </SubmitButton>
      </form>
    </Form>
  );
}

function EmailLogin({ onSuccess }: Pick<LoginFormProps, 'onSuccess'>) {
  const translator = useI18n();
  const { t } = translator;
  const { api, signIn } = useAuth();
  const form = useZodForm(loginEmailSchema, { email: '', password: '' });

  async function submit(values: { email: string; password: string }) {
    try {
      const result = await api.loginWithEmail(values);
      const me = await signIn(result);
      if (result.recoveryCancelled) notify.info(t('auth.login.recoveryCancelled'));
      notify.success(t('auth.login.success'));
      onSuccess(me);
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <TextField
          form={form}
          name="email"
          label={t('fields.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        <PasswordField form={form} name="password" label={t('fields.password')} />
        <FormRootError form={form} />
        <SubmitButton
          pending={form.formState.isSubmitting}
          pendingLabel={t('auth.login.submitting')}
        >
          {t('auth.login.submit')}
        </SubmitButton>
      </form>
    </Form>
  );
}

/** Connexion : téléphone + PIN (par défaut), email + mot de passe, ou Google. */
export function LoginForm({ onSuccess, googleClientId }: LoginFormProps) {
  const translator = useI18n();
  const { t } = translator;
  const { api, signIn } = useAuth();
  const [googleError, setGoogleError] = useState<string | null>(null);

  async function googleLogin(idToken: string) {
    try {
      setGoogleError(null);
      const result = await api.loginWithGoogle(idToken);
      const me = await signIn(result);
      notify.success(t('auth.login.success'));
      onSuccess(me);
    } catch (error) {
      setGoogleError(handleSubmitError(error, { translator }));
    }
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="phone">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="phone">{t('auth.login.tabPhone')}</TabsTrigger>
          <TabsTrigger value="email">{t('auth.login.tabEmail')}</TabsTrigger>
        </TabsList>
        <TabsContent value="phone" className="pt-2">
          <PhoneLogin onSuccess={onSuccess} />
        </TabsContent>
        <TabsContent value="email" className="pt-2">
          <EmailLogin onSuccess={onSuccess} />
        </TabsContent>
      </Tabs>
      {googleClientId ? (
        <>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="bg-border h-px flex-1" />
            {t('common.or')}
            <span className="bg-border h-px flex-1" />
          </div>
          <GoogleButton clientId={googleClientId} onCredential={googleLogin} />
          {googleError ? (
            <p role="alert" className="text-destructive text-sm">
              {googleError}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

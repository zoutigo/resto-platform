'use client';

import {
  addEmailSchema,
  addPhoneSchema,
  confirmEmailSchema,
  regenerateRecoveryCodeSchema,
} from '@resto/shared';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@resto/ui/components/ui/alert';
import { Badge } from '@resto/ui/components/ui/badge';
import { Button } from '@resto/ui/components/ui/button';
import { Form } from '@resto/ui/components/ui/form';
import { Separator } from '@resto/ui/components/ui/separator';
import { handleSubmitError } from '../feedback/handle-submit-error';
import { notify } from '../feedback/notify';
import { useZodForm } from '../feedback/zod-form';
import { useI18n } from '../i18n';
import { useAuth } from './auth-context';
import {
  CodeField,
  FormRootError,
  PhoneField,
  PinField,
  SubmitButton,
  TextField,
} from './form-parts';
import { RecoveryCodeScreen } from './recovery-code-screen';

function ConfirmEmail({ email }: { email: string }) {
  const translator = useI18n();
  const { t } = translator;
  const { api, reload } = useAuth();
  // L'adresse fait partie des valeurs validées par le schéma partagé : on la pré-remplit.
  const form = useZodForm(confirmEmailSchema, { email, code: '' });

  async function submit(values: unknown) {
    try {
      await api.confirmEmail(values);
      await reload();
      notify.success(t('auth.account.emailAdded'));
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate>
        <p className="text-sm" role="status">
          {t('auth.email.sentTo', { email })}
        </p>
        <CodeField form={form} name="code" label={t('fields.emailCode')} />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.account.confirmEmail')}
        </SubmitButton>
      </form>
    </Form>
  );
}

function AddEmail() {
  const translator = useI18n();
  const { t, locale } = translator;
  const { api } = useAuth();
  const [email, setEmail] = useState<string | null>(null);
  const form = useZodForm(addEmailSchema, { email: '', locale });

  async function submit(values: { email: string }) {
    try {
      await api.addEmail({ ...values, locale });
      setEmail(values.email);
      notify.success(t('auth.email.sentTo', { email: values.email }));
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  if (email) return <ConfirmEmail email={email} />;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate>
        <p className="text-muted-foreground text-sm">{t('auth.account.addEmailHelp')}</p>
        <TextField
          form={form}
          name="email"
          label={t('fields.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.account.addEmail')}
        </SubmitButton>
      </form>
    </Form>
  );
}

function AddPhone() {
  const translator = useI18n();
  const { t } = translator;
  const { api, reload } = useAuth();
  const form = useZodForm(addPhoneSchema, { phone: '' });

  async function submit(values: unknown) {
    try {
      await api.addPhone(values);
      await reload();
      notify.success(t('auth.account.phoneAdded'));
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate>
        <PhoneField form={form} name="phone" label={t('fields.phone')} />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.account.addPhone')}
        </SubmitButton>
      </form>
    </Form>
  );
}

function NewRecoveryCode() {
  const translator = useI18n();
  const { t } = translator;
  const { api, status } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const form = useZodForm(regenerateRecoveryCodeSchema, { pin: '' });

  async function submit(values: { pin: string }) {
    try {
      const result = await api.regenerateRecoveryCode(values.pin);
      setCode(result.recoveryCode);
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  if (status !== 'authenticated') return null;
  if (code) return <RecoveryCodeScreen code={code} onContinue={() => setCode(null)} />;
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-3" noValidate>
        <p className="text-muted-foreground text-sm">{t('auth.account.newRecoveryCodeHelp')}</p>
        <PinField
          form={form}
          name="pin"
          label={t('fields.currentPin')}
          autoComplete="current-password"
        />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting}>
          {t('auth.account.newRecoveryCode')}
        </SubmitButton>
      </form>
    </Form>
  );
}

/** Profil, alerte de récupération en cours, ajout d'email/téléphone, nouveau code de secours. */
export function AccountPanel({ onLoggedOut }: { onLoggedOut: () => void }) {
  const translator = useI18n();
  const { t, locale } = translator;
  const { api, me, reload, signOut } = useAuth();
  if (!me) return null;
  const { user } = me;

  async function notMe() {
    try {
      await api.cancelRecovery();
      await reload();
      notify.success(t('auth.account.cancelled'));
    } catch {
      notify.error(t('errors.unknown'));
    }
  }

  async function logout() {
    try {
      await signOut();
    } catch (error) {
      // Serveur injoignable : la session n'est pas fermée côté serveur. On le dit au lieu de
      // faire croire à une déconnexion (tablette partagée en salle).
      handleSubmitError(error, { translator });
      return;
    }
    notify.success(t('auth.account.logoutDone'));
    onLoggedOut();
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Africa/Douala',
    }).format(new Date(iso));

  return (
    <div className="space-y-5">
      {me.recoveryPending ? (
        <Alert variant="destructive" data-testid="recovery-alert">
          <AlertTitle>{t('auth.account.pendingAlertTitle')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {t('auth.account.pendingAlertText', { date: date(me.recoveryPending.availableAt) })}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={notMe}>
              {t('auth.account.notMe')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t('fields.name')}</dt>
          <dd className="font-medium">{user.name}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t('auth.account.phone')}</dt>
          <dd className="flex items-center gap-2 font-medium">
            {user.phone ?? t('auth.account.notSet')}
            {user.phone ? (
              <Badge variant={user.phoneVerified ? 'default' : 'secondary'}>
                {user.phoneVerified ? t('auth.account.verified') : t('auth.account.unverified')}
              </Badge>
            ) : null}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t('auth.account.email')}</dt>
          <dd className="flex items-center gap-2 font-medium">
            {user.email ?? t('auth.account.notSet')}
            {user.email ? (
              <Badge variant={user.emailVerified ? 'default' : 'secondary'}>
                {user.emailVerified ? t('auth.account.verified') : t('auth.account.unverified')}
              </Badge>
            ) : null}
          </dd>
        </div>
      </dl>

      {user.restricted ? (
        <Alert>
          <AlertDescription>{t('auth.account.restricted')}</AlertDescription>
        </Alert>
      ) : null}

      {!user.email ? (
        <>
          <Separator />
          <AddEmail />
        </>
      ) : null}
      {!user.phone ? (
        <>
          <Separator />
          <AddPhone />
        </>
      ) : null}
      {user.phone ? (
        <>
          <Separator />
          <NewRecoveryCode />
        </>
      ) : null}

      <Separator />
      <Button type="button" variant="outline" className="w-full" onClick={logout}>
        {t('common.logout')}
      </Button>
    </div>
  );
}

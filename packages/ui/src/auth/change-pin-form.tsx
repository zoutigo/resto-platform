'use client';

import { changePinSchema } from '@resto/shared';
import { Form } from '@resto/ui/components/ui/form';
import { handleSubmitError } from '../feedback/handle-submit-error';
import { notify } from '../feedback/notify';
import { useZodForm } from '../feedback/zod-form';
import { useI18n } from '../i18n';
import { useAuth } from './auth-context';
import { FormRootError, PinField, SubmitButton } from './form-parts';

/** Changement de PIN ; sert aussi au remplacement obligatoire d'un PIN temporaire. */
export function ChangePinForm({ onDone }: { onDone: () => void }) {
  const translator = useI18n();
  const { t } = translator;
  const { api, reload } = useAuth();
  const form = useZodForm(changePinSchema, { currentPin: '', newPin: '', newPinConfirm: '' });

  async function submit(values: unknown) {
    try {
      await api.changePin(values);
      await reload();
      notify.success(t('auth.changePin.success'));
      onDone();
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <PinField
          form={form}
          name="currentPin"
          label={t('fields.currentPin')}
          autoComplete="current-password"
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
          {t('auth.changePin.submit')}
        </SubmitButton>
      </form>
    </Form>
  );
}

'use client';

import { createRestaurantSchema } from '@resto/shared';
import {
  FormRootError,
  SubmitButton,
  TextField,
  handleSubmitError,
  notify,
  useAuth,
  useI18n,
  useZodForm,
} from '@resto/ui';
import { Form } from '@resto/ui/components/ui/form';

/** Création du premier restaurant : le créateur en devient le propriétaire. */
export function CreateRestaurantForm({ onDone }: { onDone: () => void }) {
  const translator = useI18n();
  const { t } = translator;
  const { api } = useAuth();
  const form = useZodForm(createRestaurantSchema, { name: '', city: '', address: '' });

  async function submit(values: { address?: string }) {
    try {
      await api.createRestaurant({ ...values, address: values.address || undefined });
      notify.success(t('restaurant.created'));
      onDone();
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
        <TextField
          form={form}
          name="name"
          label={t('fields.restaurantName')}
          autoComplete="organization"
        />
        <TextField form={form} name="city" label={t('fields.city')} autoComplete="address-level2" />
        <TextField
          form={form}
          name="address"
          label={t('fields.address')}
          autoComplete="street-address"
        />
        <FormRootError form={form} />
        <SubmitButton pending={form.formState.isSubmitting} pendingLabel={t('restaurant.creating')}>
          {t('restaurant.create')}
        </SubmitButton>
      </form>
    </Form>
  );
}

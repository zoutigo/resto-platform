'use client';

import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Alert, AlertDescription } from '@resto/ui/components/ui/alert';
import { Button } from '@resto/ui/components/ui/button';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@resto/ui/components/ui/form';
import { Input } from '@resto/ui/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@resto/ui/components/ui/input-otp';
import type { AnyForm } from '../feedback/zod-form';
import { useI18n } from '../i18n';

/** Le strict nécessaire d'un formulaire pour lire son message général. */
interface ErrorSource {
  formState: { errors: object };
}

/** Message général d'un échec d'envoi (identifiants, 429, 500, réseau coupé…). */
export function FormRootError({ form }: { form: ErrorSource }) {
  const message = (form.formState.errors as { root?: { server?: { message?: string } } }).root
    ?.server?.message;
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert" data-testid="form-error">
      <AlertCircle />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

interface FieldProps {
  form: AnyForm;
  name: string;
  label: string;
  description?: string;
  autoComplete?: string;
  disabled?: boolean;
}

const MASK = '[-webkit-text-security:disc]';

/** PIN à 6 chiffres : saisie numérique masquée, clavier numérique sur mobile. */
export function PinField({ form, name, label, description, autoComplete, disabled }: FieldProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <InputOTP
                maxLength={6}
                inputMode="numeric"
                pattern="^[0-9]*$"
                autoComplete={autoComplete ?? 'off'}
                disabled={disabled}
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot key={index} index={index} className={visible ? '' : MASK} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </FormControl>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? t('common.hide') : t('common.show')}
              aria-pressed={visible}
            >
              {visible ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Code à 6 chiffres reçu par email (visible, avec saisie semi-automatique du SMS/email). */
export function CodeField({ form, name, label, description, disabled }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <InputOTP
              maxLength={6}
              inputMode="numeric"
              pattern="^[0-9]*$"
              autoComplete="one-time-code"
              disabled={disabled}
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Téléphone camerounais : préfixe +237 affiché, la saisie reste libre (espaces tolérés). */
export function PhoneField({ form, name, label, description, autoComplete, disabled }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <span
              className="text-muted-foreground rounded-md border px-3 py-2 text-sm"
              aria-hidden="true"
            >
              +237
            </span>
            <FormControl>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete={autoComplete ?? 'tel-national'}
                placeholder="6 77 12 34 56"
                disabled={disabled}
                {...field}
                value={field.value ?? ''}
              />
            </FormControl>
          </div>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Champ texte simple relié au formulaire. */
export function TextField({
  form,
  name,
  label,
  description,
  autoComplete,
  disabled,
  type = 'text',
  inputMode,
}: FieldProps & { type?: string; inputMode?: 'text' | 'email' | 'numeric' }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={type}
              inputMode={inputMode}
              autoComplete={autoComplete}
              disabled={disabled}
              {...field}
              value={field.value ?? ''}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Mot de passe avec bouton afficher/masquer. */
export function PasswordField({
  form,
  name,
  label,
  description,
  autoComplete,
  disabled,
}: FieldProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="flex items-center gap-2">
            <FormControl>
              <Input
                type={visible ? 'text' : 'password'}
                autoComplete={autoComplete ?? 'current-password'}
                disabled={disabled}
                {...field}
                value={field.value ?? ''}
              />
            </FormControl>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? t('common.hide') : t('common.show')}
              aria-pressed={visible}
            >
              {visible ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Bouton d'envoi : état de chargement et protection contre le double clic. */
export function SubmitButton({
  pending,
  children,
  pendingLabel,
  className,
  disabled,
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={className ?? 'w-full'}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

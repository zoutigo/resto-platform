'use client';

import {
  type Role,
  STAFF_ROLES,
  type TeamMember,
  addStaffSchema,
  canManageRole,
} from '@resto/shared';
import {
  FormRootError,
  PhoneField,
  SubmitButton,
  TextField,
  handleSubmitError,
  notify,
  useAuth,
  useI18n,
  useZodForm,
} from '@resto/ui';
import { Badge } from '@resto/ui/components/ui/badge';
import { Button } from '@resto/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@resto/ui/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@resto/ui/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@resto/ui/components/ui/form';
import { NativeSelect, NativeSelectOption } from '@resto/ui/components/ui/native-select';
import { Skeleton } from '@resto/ui/components/ui/skeleton';
import { useCallback, useEffect, useState } from 'react';
import { TemporaryPinDialog } from './temporary-pin-dialog';

const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Douala',
  }).format(new Date(iso));

function AddStaffForm({
  restaurantId,
  actorRole,
  onAdded,
}: {
  restaurantId: string;
  actorRole: Role;
  onAdded: (result: { name: string; temporaryPin: string | null }) => void;
}) {
  const translator = useI18n();
  const { t } = translator;
  const { api } = useAuth();
  const roles = STAFF_ROLES.filter((r) => canManageRole(actorRole, r));
  const form = useZodForm(addStaffSchema, {
    name: '',
    phone: '',
    role: roles[roles.length - 1] ?? 'WAITER',
  });

  async function submit(values: { name: string }) {
    try {
      const result = await api.addStaff(restaurantId, values);
      notify.success(t('team.added'));
      form.reset();
      onAdded({ name: values.name, temporaryPin: result.temporaryPin });
    } catch (error) {
      handleSubmitError(error, { form, translator });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 md:grid-cols-2" noValidate>
        <TextField form={form} name="name" label={t('fields.name')} autoComplete="off" />
        <PhoneField form={form} name="phone" label={t('fields.phone')} />
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('fields.role')}</FormLabel>
              <FormControl>
                <NativeSelect {...field} className="w-full">
                  {roles.map((role) => (
                    <NativeSelectOption key={role} value={role}>
                      {t(`roles.${role}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormControl>
            </FormItem>
          )}
        />
        <div className="space-y-2 md:col-span-2">
          <FormRootError form={form} />
          <SubmitButton pending={form.formState.isSubmitting} className="w-full md:w-auto">
            {t('team.addSubmit')}
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}

function MemberRow({
  member,
  actorRole,
  restaurantId,
  onChanged,
  onPin,
}: {
  member: TeamMember;
  actorRole: Role;
  restaurantId: string;
  onChanged: () => void;
  onPin: (name: string, pin: string) => void;
}) {
  const translator = useI18n();
  const { t, locale } = translator;
  const { api } = useAuth();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const manageable = canManageRole(actorRole, member.role);
  const roles = STAFF_ROLES.filter((r) => canManageRole(actorRole, r));

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      handleSubmitError(error, { translator });
    }
  }

  return (
    <li
      data-testid={`member-${member.phone ?? member.userId}`}
      className="flex flex-col gap-3 rounded-lg border p-3 md:grid md:grid-cols-[1fr_auto] md:items-center"
    >
      <div className="space-y-1">
        <p className="font-medium">{member.name}</p>
        <p className="text-muted-foreground text-sm">{member.phone}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{t(`roles.${member.role}`)}</Badge>
          {member.mustChangePin ? <Badge variant="outline">{t('team.mustChange')}</Badge> : null}
          {member.recoveryPendingUntil ? (
            <Badge variant="destructive">
              {t('team.recoveryPending', { date: formatDate(member.recoveryPendingUntil, locale) })}
            </Badge>
          ) : null}
        </div>
      </div>

      {manageable ? (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            size="sm"
            aria-label={`${t('fields.role')} — ${member.name}`}
            value={member.role}
            onChange={(event) =>
              run(async () => {
                await api.changeStaffRole(restaurantId, member.userId, event.target.value);
                notify.success(t('team.roleChanged'));
                onChanged();
              })
            }
          >
            {roles.map((role) => (
              <NativeSelectOption key={role} value={role}>
                {t(`roles.${role}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          {member.pinResettable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                run(async () => {
                  const { temporaryPin } = await api.resetStaffPin(restaurantId, member.userId);
                  onChanged();
                  onPin(member.name, temporaryPin);
                })
              }
            >
              {t('team.resetPin')}
            </Button>
          ) : null}

          {member.recoveryPendingUntil ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                run(async () => {
                  await api.cancelStaffRecovery(restaurantId, member.userId);
                  notify.success(t('team.recoveryCancelled'));
                  onChanged();
                })
              }
            >
              {t('team.cancelRecovery')}
            </Button>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => setConfirmRemove(true)}
          >
            {t('team.removeAction')}
          </Button>

          <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('team.removeAction')}</DialogTitle>
                <DialogDescription>
                  {t('team.confirmRemove', { name: member.name })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmRemove(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() =>
                    run(async () => {
                      await api.removeStaff(restaurantId, member.userId);
                      notify.success(t('team.removed'));
                      setConfirmRemove(false);
                      onChanged();
                    })
                  }
                >
                  {t('team.removeAction')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </li>
  );
}

/** Gestion de l'équipe : ajout, rôles, PIN temporaire, annulation de récupération, retrait. */
export function TeamPanel({ restaurantId, actorRole }: { restaurantId: string; actorRole: Role }) {
  const translator = useI18n();
  const { t } = translator;
  const { api } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [pin, setPin] = useState<{ name: string; pin: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await api.team(restaurantId));
    } catch (error) {
      handleSubmitError(error, { translator });
      setMembers((current) => current ?? []);
    }
    // `translator` change avec la langue : on ne recharge pas la liste pour autant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, restaurantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('team.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('team.add')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AddStaffForm
            restaurantId={restaurantId}
            actorRole={actorRole}
            onAdded={({ name, temporaryPin }) => {
              void load();
              if (temporaryPin) setPin({ name, pin: temporaryPin });
              else notify.info(t('team.pinExisting', { name }));
            }}
          />
        </CardContent>
      </Card>

      {members === null ? (
        <Skeleton className="h-24 w-full" aria-label={t('common.loading')} />
      ) : members.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('team.empty')}</p>
      ) : (
        <ul className="space-y-2" aria-label={t('team.title')}>
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              actorRole={actorRole}
              restaurantId={restaurantId}
              onChanged={() => void load()}
              onPin={(name, value) => setPin({ name, pin: value })}
            />
          ))}
        </ul>
      )}

      <TemporaryPinDialog
        name={pin?.name ?? ''}
        pin={pin?.pin ?? null}
        onClose={() => setPin(null)}
      />
    </div>
  );
}

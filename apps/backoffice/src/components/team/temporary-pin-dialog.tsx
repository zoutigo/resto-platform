'use client';

import { Check, Copy } from 'lucide-react';
import { notify, useI18n } from '@resto/ui';
import { Button } from '@resto/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@resto/ui/components/ui/dialog';
import { useState } from 'react';

/** Affiche le PIN temporaire une seule fois, pour le transmettre à l'employé en personne. */
export function TemporaryPinDialog({
  name,
  pin,
  onClose,
}: {
  name: string;
  pin: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      notify.success(t('common.copied'));
    } catch {
      // le PIN reste lisible à l'écran
    }
  }

  return (
    <Dialog open={pin !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('team.pinTitle')}</DialogTitle>
          <DialogDescription>{t('team.pinText', { name })}</DialogDescription>
        </DialogHeader>
        <output
          data-testid="temporary-pin"
          aria-label={t('team.pinTitle')}
          className="bg-muted block rounded-lg border p-4 text-center font-mono text-3xl font-semibold tracking-[0.5em] select-all"
        >
          {pin}
        </output>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
          <Button type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@resto/ui/components/ui/button';
import { Checkbox } from '@resto/ui/components/ui/checkbox';
import { Label } from '@resto/ui/components/ui/label';
import { notify } from '../feedback/notify';
import { useI18n } from '../i18n';

/**
 * Affiche le code de secours une seule fois. L'utilisateur doit confirmer l'avoir noté
 * avant de continuer : sans lui, un PIN oublié = compte perdu.
 */
export function RecoveryCodeScreen({
  code,
  onContinue,
  intro,
}: {
  code: string;
  onContinue: () => void;
  intro?: string;
}) {
  const { t } = useI18n();
  const [noted, setNoted] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      notify.success(t('auth.recoveryCode.copyDone'));
    } catch {
      // Presse-papiers indisponible : le code reste lisible à l'écran.
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{intro ?? t('auth.recoveryCode.help')}</p>
      <div className="bg-muted flex items-center justify-between gap-2 rounded-lg border p-4">
        <output
          aria-label={t('fields.recoveryCode')}
          data-testid="recovery-code"
          className="font-mono text-lg font-semibold tracking-widest select-all"
        >
          {code}
        </output>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="code-noted" checked={noted} onCheckedChange={(v) => setNoted(v === true)} />
        <Label htmlFor="code-noted" className="leading-snug">
          {t('auth.recoveryCode.confirm')}
        </Label>
      </div>
      <Button type="button" className="w-full" disabled={!noted} onClick={onContinue}>
        {t('auth.recoveryCode.continue')}
      </Button>
    </div>
  );
}

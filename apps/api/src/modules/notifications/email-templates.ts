export type Locale = 'fr' | 'en';
export type EmailKind = 'register' | 'addEmail' | 'reset';

const MINUTES = 15;

const TEXTS: Record<Locale, Record<EmailKind, { subject: string; intro: string }>> = {
  fr: {
    register: {
      subject: 'Votre code de vérification',
      intro: 'Voici votre code pour créer votre compte :',
    },
    addEmail: {
      subject: 'Confirmez votre adresse email',
      intro: 'Voici votre code pour confirmer cette adresse :',
    },
    reset: {
      subject: 'Réinitialisation de votre accès',
      intro: 'Voici votre code pour réinitialiser votre accès :',
    },
  },
  en: {
    register: {
      subject: 'Your verification code',
      intro: 'Here is your code to create your account:',
    },
    addEmail: {
      subject: 'Confirm your email address',
      intro: 'Here is your code to confirm this address:',
    },
    reset: { subject: 'Reset your access', intro: 'Here is your code to reset your access:' },
  },
};

const OUTRO: Record<Locale, string> = {
  fr: `Ce code est valable ${MINUTES} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : personne ne peut agir sans ce code.`,
  en: `This code is valid for ${MINUTES} minutes. If you did not request it, ignore this message: nobody can act without this code.`,
};

export function emailCodeMessage(kind: EmailKind, code: string, locale: Locale) {
  const t = TEXTS[locale][kind];
  return { subject: t.subject, text: `${t.intro}\n\n${code}\n\n${OUTRO[locale]}` };
}

export const EMAIL_CODE_MINUTES = MINUTES;

import { Logger, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Canal d'envoi d'email (une des implémentations de `NotificationChannel`). */
export interface EmailChannel {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_CHANNEL = Symbol('EMAIL_CHANNEL');

/** Développement : affiche le message dans la console (le code est visible). */
export class ConsoleEmailChannel implements EmailChannel {
  private readonly logger = new Logger('Email');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`→ ${message.to} | ${message.subject}\n${message.text}`);
  }
}

/** Tests : conserve les messages pour les relire. */
export class MemoryEmailChannel implements EmailChannel {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** Dernier message adressé à `to`. */
  lastTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }

  /** Code à 6 chiffres du dernier message adressé à `to`. */
  lastCodeTo(to: string): string | undefined {
    return this.lastTo(to)?.text.match(/\b(\d{6})\b/)?.[1];
  }
}

/** Production sans SMTP configuré : on refuse d'envoyer plutôt que de journaliser des codes. */
export class DisabledEmailChannel implements EmailChannel {
  async send(): Promise<void> {
    throw new ServiceUnavailableException({
      statusCode: 503,
      error: 'ServiceUnavailable',
      message: 'email.notConfigured',
    });
  }
}

export interface MailTransport {
  sendMail(options: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/** SMTP générique : fonctionne avec n'importe quel fournisseur (Brevo, Resend, Mailgun…). */
export class SmtpEmailChannel implements EmailChannel {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.from, ...message });
    } catch (error) {
      new Logger('Email').error(`Échec d'envoi vers ${message.to}: ${(error as Error).message}`);
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'ServiceUnavailable',
        message: 'email.sendFailed',
      });
    }
  }
}

/** Choisit le canal selon l'environnement. */
export function createEmailChannel(
  env: Record<string, string | undefined> = process.env,
): EmailChannel {
  if (env.NODE_ENV === 'test') return new MemoryEmailChannel();
  if (env.SMTP_URL) {
    return new SmtpEmailChannel(
      nodemailer.createTransport(env.SMTP_URL),
      env.MAIL_FROM ?? 'Resto <no-reply@localhost>',
    );
  }
  return env.NODE_ENV === 'production' ? new DisabledEmailChannel() : new ConsoleEmailChannel();
}

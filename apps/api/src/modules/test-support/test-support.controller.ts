import { Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common';
import {
  EMAIL_CHANNEL,
  type EmailChannel,
  MemoryEmailChannel,
} from '../notifications/email.channel.js';

/**
 * Routes réservées aux tests fonctionnels (Playwright) : lire les emails « envoyés »,
 * qui ne quittent jamais le processus. Chargé uniquement si NODE_ENV=test (voir
 * app.module.ts) ; le contrôle est répété ici par sécurité.
 */
@Controller('__test')
export class TestSupportController {
  constructor(@Inject(EMAIL_CHANNEL) private readonly channel: EmailChannel) {}

  @Get('emails')
  emails(@Query('to') to?: string) {
    if (process.env.NODE_ENV !== 'test' || !(this.channel instanceof MemoryEmailChannel)) {
      throw new NotFoundException();
    }
    const messages = to
      ? this.channel.sent.filter((m) => m.to === to.toLowerCase())
      : this.channel.sent;
    return messages.map((m) => ({
      ...m,
      code: m.text.match(/\b(\d{6})\b/)?.[1] ?? null,
    }));
  }
}

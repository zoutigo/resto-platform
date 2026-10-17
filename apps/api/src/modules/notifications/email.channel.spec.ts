import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleEmailChannel,
  DisabledEmailChannel,
  MemoryEmailChannel,
  SmtpEmailChannel,
  createEmailChannel,
} from './email.channel.js';
import { EMAIL_CODE_MINUTES, emailCodeMessage } from './email-templates.js';

describe('MemoryEmailChannel', () => {
  it('garde les messages et retrouve le dernier code d’un destinataire', async () => {
    const channel = new MemoryEmailChannel();
    await channel.send({ to: 'a@b.cm', subject: 's', text: 'Votre code :\n\n123456\n\nvalable' });
    await channel.send({ to: 'a@b.cm', subject: 's', text: 'Votre code :\n\n654321\n\nvalable' });
    await channel.send({ to: 'x@y.cm', subject: 's', text: 'Votre code :\n\n111222\n' });
    expect(channel.sent).toHaveLength(3);
    expect(channel.lastCodeTo('a@b.cm')).toBe('654321');
    expect(channel.lastCodeTo('nobody@y.cm')).toBeUndefined();
  });
});

describe('SmtpEmailChannel', () => {
  it('transmet le message avec l’expéditeur configuré', async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({}) };
    await new SmtpEmailChannel(transport, 'Resto <no-reply@resto.cm>').send({
      to: 'a@b.cm',
      subject: 'S',
      text: 'T',
    });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'Resto <no-reply@resto.cm>',
      to: 'a@b.cm',
      subject: 'S',
      text: 'T',
    });
  });

  it('traduit une panne SMTP en 503 sans exposer le détail', async () => {
    const transport = { sendMail: vi.fn().mockRejectedValue(new Error('535 mot de passe secret')) };
    const channel = new SmtpEmailChannel(transport, 'x@y.cm');
    await expect(channel.send({ to: 'a@b.cm', subject: 'S', text: 'T' })).rejects.toMatchObject({
      status: 503,
      response: { message: 'email.sendFailed' },
    });
  });
});

describe('createEmailChannel', () => {
  it('test → mémoire', () => {
    expect(createEmailChannel({ NODE_ENV: 'test' })).toBeInstanceOf(MemoryEmailChannel);
  });
  it('SMTP_URL → SMTP', () => {
    expect(createEmailChannel({ SMTP_URL: 'smtp://u:p@localhost:2525' })).toBeInstanceOf(
      SmtpEmailChannel,
    );
  });
  it('développement sans SMTP → console', () => {
    expect(createEmailChannel({ NODE_ENV: 'development' })).toBeInstanceOf(ConsoleEmailChannel);
    expect(createEmailChannel({})).toBeInstanceOf(ConsoleEmailChannel);
  });
  it('production sans SMTP → désactivé (jamais de code dans les journaux)', async () => {
    const channel = createEmailChannel({ NODE_ENV: 'production' });
    expect(channel).toBeInstanceOf(DisabledEmailChannel);
    await expect(channel.send({ to: 'a@b.cm', subject: 'S', text: 'T' })).rejects.toMatchObject({
      status: 503,
      response: { message: 'email.notConfigured' },
    });
  });
});

describe('emailCodeMessage', () => {
  it.each(['fr', 'en'] as const)('contient le code et la durée (%s)', (locale) => {
    for (const kind of ['register', 'addEmail', 'reset'] as const) {
      const m = emailCodeMessage(kind, '482915', locale);
      expect(m.text).toContain('482915');
      expect(m.text).toContain(String(EMAIL_CODE_MINUTES));
      expect(m.subject.length).toBeGreaterThan(5);
    }
  });

  it('change de langue', () => {
    expect(emailCodeMessage('reset', '111111', 'fr').subject).not.toBe(
      emailCodeMessage('reset', '111111', 'en').subject,
    );
  });
});

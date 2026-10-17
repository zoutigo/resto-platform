import { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleEmailChannel, MemoryEmailChannel } from '../notifications/email.channel.js';
import { TestSupportController } from './test-support.controller.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('TestSupportController', () => {
  async function filled() {
    const channel = new MemoryEmailChannel();
    await channel.send({ to: 'a@b.cm', subject: 'S1', text: 'Votre code :\n\n482915\n' });
    await channel.send({ to: 'x@y.cm', subject: 'S2', text: 'Pas de code ici' });
    return new TestSupportController(channel);
  }

  it('liste les emails avec leur code, filtrables par destinataire', async () => {
    const controller = await filled();
    expect(controller.emails('a@b.cm')).toEqual([
      { to: 'a@b.cm', subject: 'S1', text: 'Votre code :\n\n482915\n', code: '482915' },
    ]);
    expect(controller.emails()).toHaveLength(2);
    expect(controller.emails('x@y.cm')[0]?.code).toBeNull();
    expect(controller.emails('A@B.CM')).toHaveLength(1);
  });

  it('répond 404 hors environnement de test, même si le module était chargé', async () => {
    const controller = await filled();
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => controller.emails()).toThrow(NotFoundException);
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => controller.emails()).toThrow(NotFoundException);
  });

  it('répond 404 si le canal n’est pas le canal mémoire des tests', () => {
    const controller = new TestSupportController(new ConsoleEmailChannel());
    expect(() => controller.emails()).toThrow(NotFoundException);
  });
});

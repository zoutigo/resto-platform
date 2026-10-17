import type { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AudiencePipe } from '../modules/auth/audience.pipe.js';
import { RetryAfterFilter } from './retry-after.filter.js';
import { ZodValidationPipe, parseOrThrow } from './zod-validation.pipe.js';

const schema = z.object({ name: z.string().min(2, 'name.tooShort'), age: z.coerce.number() });

describe('parseOrThrow / ZodValidationPipe', () => {
  it('renvoie la valeur validée et transformée', () => {
    expect(parseOrThrow(schema, { name: 'Awa', age: '30' })).toEqual({ name: 'Awa', age: 30 });
    expect(new ZodValidationPipe(schema).transform({ name: 'Awa', age: 1 })).toEqual({
      name: 'Awa',
      age: 1,
    });
  });

  it('lève 400 avec les champs fautifs', () => {
    try {
      parseOrThrow(schema, { name: 'A', age: 'x' });
      expect.unreachable();
    } catch (e) {
      const err = e as HttpException;
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse()).toMatchObject({
        error: 'ValidationError',
        message: 'validation.failed',
        issues: expect.arrayContaining([{ path: 'name', message: 'name.tooShort' }]),
      });
    }
  });

  it('refuse un corps absent', () => {
    expect(() => parseOrThrow(schema, undefined)).toThrow();
  });
});

describe('AudiencePipe', () => {
  const pipe = new AudiencePipe();
  it('accepte staff et customer', () => {
    expect(pipe.transform('staff')).toBe('staff');
    expect(pipe.transform('customer')).toBe('customer');
  });
  it.each(['admin', '', 'STAFF'])('répond 404 pour « %s »', (v) => {
    expect(() => pipe.transform(v)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('RetryAfterFilter', () => {
  function run(exception: HttpException) {
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    new RetryAfterFilter().catch(exception, host);
    return res;
  }

  it('ajoute Retry-After sur un 429', () => {
    const res = run(new HttpException({ message: 'x', retryAfter: 42 }, 429));
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ message: 'x', retryAfter: 42 });
  });

  it('ne touche pas aux autres erreurs', () => {
    const res = run(new HttpException({ message: 'nope' }, 403));
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('gère une réponse sous forme de chaîne', () => {
    const res = run(new HttpException('texte', 400));
    expect(res.json).toHaveBeenCalledWith('texte');
  });
});

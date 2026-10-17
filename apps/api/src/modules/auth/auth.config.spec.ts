import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth.config.js';

const base = {
  AUTH_JWT_SECRET: 'j'.repeat(32),
  AUTH_PEPPER: 'p'.repeat(32),
};

describe('loadAuthConfig', () => {
  it('lit les secrets et les origines', () => {
    const config = loadAuthConfig({ ...base, WEB_ORIGINS: 'https://a.cm, https://b.cm ,' });
    expect(config.webOrigins).toEqual(['https://a.cm', 'https://b.cm']);
    expect(config.pepper.toString()).toBe(base.AUTH_PEPPER);
    expect(config.accessTtlSeconds).toBe(900);
  });

  it('refuse un secret JWT trop court', () => {
    expect(() => loadAuthConfig({ ...base, AUTH_JWT_SECRET: 'court' })).toThrow();
  });

  it('refuse un pepper absent', () => {
    expect(() => loadAuthConfig({ AUTH_JWT_SECRET: base.AUTH_JWT_SECRET })).toThrow();
  });

  it('active les cookies sécurisés uniquement en production', () => {
    expect(loadAuthConfig({ ...base, NODE_ENV: 'production' }).secureCookies).toBe(true);
    expect(loadAuthConfig({ ...base, NODE_ENV: 'development' }).secureCookies).toBe(false);
  });
});

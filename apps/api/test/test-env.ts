// Chargé avant tout module : force une base DÉDIÉE aux tests, jamais la base de dev.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://resto:resto@localhost:5433/resto_test';
process.env.NODE_ENV = 'test';
process.env.AUTH_JWT_SECRET = 'test-only-jwt-secret-0123456789abcdefghij';
process.env.AUTH_PEPPER = 'test-only-pepper-0123456789abcdefghijkl';
process.env.WEB_ORIGINS = 'http://localhost:3000,http://localhost:3001';
process.env.TRUST_PROXY = '1';

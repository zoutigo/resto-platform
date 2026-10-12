// Chargé avant tout module : force une base DÉDIÉE aux tests, jamais la base de dev.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://resto:resto@localhost:5433/resto_test';
process.env.NODE_ENV = 'test';

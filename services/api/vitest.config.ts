import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],

    /**
     * Pure unit tests (src/modules/ * /*.rules.ts) import no infrastructure and
     * need none of this. These defaults exist so that INTEGRATION tests — which
     * do import config/env.ts through db/redis — can boot without a .env file.
     * CI overrides them with real service-container URLs.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/appdb_test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test_secret_that_is_at_least_32_characters_long',
      CORS_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'error',
    },

    coverage: {
      reporter: ['text', 'html'],
      include: ['src/modules/**/*.ts', 'src/lib/**/*.ts'],
    },
  },
});

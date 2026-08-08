import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],

    /**
     * Integration tests run against a REAL Postgres — the correctness argument
     * rests on row locks and guarded UPDATEs, so mocking the database would
     * test nothing. CI supplies a service container; locally, compose exposes
     * Postgres on 127.0.0.1:55432.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://app:app@127.0.0.1:55432/cinemaseat',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      LOG_LEVEL: 'error',
      HOLD_TTL_SECONDS: '120',
    },

    /**
     * The concurrency suite deliberately contends on the same rows. Running
     * suites in parallel against one database would make the oversell
     * assertions flaky for reasons unrelated to the code under test.
     */
    fileParallelism: false,
    testTimeout: 30_000,

    coverage: {
      reporter: ['text', 'html'],
      include: ['src/modules/**/*.ts', 'src/lib/**/*.ts'],
    },
  },
});

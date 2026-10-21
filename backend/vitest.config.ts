import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts', 'test/**/*.test.ts', 'plugins/**/*.test.ts'],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/cognimetric_test', NODE_ENV: 'test', DEV_TIME_SCALE: '1' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

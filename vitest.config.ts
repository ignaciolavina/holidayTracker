import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['server/test/globalSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: [
        'shared/src/engine/**/*.ts',
        'server/src/services/balance/**/*.ts',
        'server/src/services/antiCheat/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      reporter: ['text-summary', 'text', 'json-summary'],
    },
  },
});

import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, '../app', ''));

  return {
    test: {
      include: ['src/**/*.test.ts'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      pool: 'forks',
      fileParallelism: false,
    },
  };
});

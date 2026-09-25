import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'compat-proxy-entry': 'src/compat-proxy-entry.ts',
    'db/migrate': 'src/db/migrate.ts',
    'scripts/validate-editorial': 'scripts/validate-editorial.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: ['@context-reader/contracts'],
});

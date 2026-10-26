import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/seed.ts', 'src/scripts/runJob.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // shared/ is TypeScript source: bundle it into the server build
  noExternal: ['@ht/shared'],
});

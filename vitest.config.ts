import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.ts',
      // Every acceptance audit, collected on every `pnpm test`.
      //
      // They used to be listed one by one, which meant a file added to docs/acceptance
      // was never transpiled by anything until a live run touched it: the file that
      // started this could not be parsed at all (biome wraps a `typeof import(...)` type with
      // a trailing comma, TypeScript accepts it, esbuild does not), and `pnpm typecheck`
      // waved it through. A test nothing collects is not a gate; a test nothing transpiles
      // is worse, because it looks like one. Env-gated files still skip themselves - they
      // just now have to parse and import first.
      'docs/acceptance/*.audit.test.ts',
      // Repo-level gates that used to be a human habit (PR title shape). Cheap,
      // deterministic, so they run with the normal suite.
      'scripts/__tests__/**/*.test.mjs',
    ],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

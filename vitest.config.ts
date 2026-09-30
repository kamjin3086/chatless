import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.ts',
      // The workspace/output-budget gates used to live only in an explicit
      // acceptance run and stayed red for a whole release. They are cheap and
      // deterministic, so they run with the normal suite now.
      'docs/acceptance/workspace-budget.audit.test.ts',
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

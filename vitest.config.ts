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
      // Two more audits that need nothing generated: dense-fusion is pure, and
      // final-plan builds its own SQLite fixture inline. A test nothing collects
      // is not a gate, so anything runnable lives here.
      'docs/acceptance/dense-fusion.audit.test.ts',
      'docs/acceptance/final-plan.audit.test.ts',
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

import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['docs/acceptance/*.audit.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
});

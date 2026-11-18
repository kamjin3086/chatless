import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  test: { environment: 'node', include: ['docs/architecture/review-*-2026-10-24.probe.ts'] },
});

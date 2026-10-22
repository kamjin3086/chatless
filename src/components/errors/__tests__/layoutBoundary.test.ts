import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('the root layout', () => {
  it('mounts the route boundary around routed children only', () => {
    const layout = readFileSync(
      fileURLToPath(new URL('../../../app/layout.tsx', import.meta.url)),
      'utf8',
    );
    expect(layout).toMatch(
      /<RouteErrorBoundary>\s*\{children\}\s*<\/RouteErrorBoundary>/,
    );
  });
});

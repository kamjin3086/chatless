import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

describe('route boundary wiring', () => {
  it('mounts the root boundary around routed children only', () => {
    expect(source('../../../app/layout.tsx')).toMatch(
      /<RouteErrorBoundary>\s*\{children\}\s*<\/RouteErrorBoundary>/,
    );
  });

  it('wires a nested chat boundary with the conversation reset key', () => {
    const chatLayout = source('../../../components/layout/ChatLayout.tsx');
    expect(chatLayout).toMatch(
      /<RouteErrorBoundary resetKey=\{currentConversationId \?\? ''\}>\s*\{children\}\s*<\/RouteErrorBoundary>/,
    );
  });
});

/**
 * The check for #153's first step. `streamdown` (with shiki, mermaid and katex) is the
 * single most expensive thing on the chat route - 866 kB of first-load JS before the
 * renderer was made lazy, 595 kB after. A component that imports `./StreamingMarkdown`
 * directly silently puts all of it back into the page's initial graph, and nothing in the
 * rendered output would look different.
 *
 * So this reads the imports. The wrapper is the only place allowed to name the module.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CHAT = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Comments stripped first: a comment naming the module is not an import of it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the markdown renderer is loaded on demand', () => {
  it('only the lazy wrapper imports StreamingMarkdown', () => {
    const importers = sourceFiles(CHAT)
      .filter((file) => {
        const text = code(readFileSync(file, 'utf8'));
        return /from\s+['"]\.\/StreamingMarkdown['"]/.test(text);
      })
      .map((file) => path.basename(file));

    expect(importers).toEqual(['LazyStreamingMarkdown.tsx']);
  });

  it('the wrapper is what the message views render', () => {
    for (const view of ['MessageTextContent.tsx', 'ThinkingBar.tsx']) {
      const text = code(readFileSync(path.join(CHAT, view), 'utf8'));
      expect(text, view).toContain("from './LazyStreamingMarkdown'");
    }
  });
});

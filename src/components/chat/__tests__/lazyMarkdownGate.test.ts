/**
 * The check for #153's first step. `streamdown` (with shiki, mermaid and katex) is the single
 * most expensive module any answer-bearing page loads; deferring it behind
 * `LazyStreamingMarkdown` took the chat route from 866 kB to 595 kB of first-load JS and the
 * extensions page from preloading a 600 kB chunk to not needing it.
 *
 * An import of `StreamingMarkdown` anywhere else silently puts all of it back, and the
 * rendered output looks identical - so this reads the imports. It scans all of `src`, both
 * spellings (`./StreamingMarkdown`, `@/components/chat/StreamingMarkdown`) and dynamic
 * `import()`, because the first version of this gate walked only `components/chat` and one
 * spelling while `SkillMdRenderer` was already importing the module by another.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');
const WRAPPER = 'LazyStreamingMarkdown.tsx';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
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

/** Tests and the module itself are not call sites. */
function importsRenderer(source: string): boolean {
  // `(?<![A-Za-z])` keeps `LazyStreamingMarkdown` - the wrapper every view should use - from
  // being counted as an import of the renderer itself.
  return /(?:from\s+|import\s*\(\s*)['"][^'"]*(?<![A-Za-z])StreamingMarkdown['"]/.test(
    code(source),
  );
}

describe('the markdown renderer is loaded on demand', () => {
  it('only the lazy wrapper imports StreamingMarkdown, under any spelling', () => {
    const importers = sourceFiles(SRC)
      .filter((file) => path.basename(file) !== 'StreamingMarkdown.tsx')
      .filter((file) => importsRenderer(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file));

    expect(importers).toEqual([path.join('components/chat', WRAPPER)]);
  });

  it('the views that render markdown go through the wrapper', () => {
    for (const view of [
      'components/chat/MessageTextContent.tsx',
      'components/chat/ThinkingBar.tsx',
      'components/skills/SkillMdRenderer.tsx',
    ]) {
      const text = code(readFileSync(path.join(SRC, view), 'utf8'));
      expect(text, view).toMatch(/from\s+['"][^'"]*LazyStreamingMarkdown['"]/);
    }
  });
});

/**
 * The markdown renderer stays behind the lazy boundary (#153).
 *
 * The chat route pays for `streamdown`'s dependency set - `shiki`, `mermaid`, `katex`,
 * `react-markdown` - only once an answer exists, because the renderer sits behind a dynamic
 * import. That is worth having only if nothing pulls it back into the initial graph, and
 * "nothing" is a property of the import graph, so it is checked here with a source scan, the
 * same shape as the glass contract.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const SRC = path.join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).map((file) => ({
  rel: path.relative(ROOT, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

/** The one module allowed to import the renderer directly, and the renderer itself. */
const LAZY_OWNER = 'src/components/chat/LazyStreamingMarkdown.tsx';
const RENDERER = 'src/components/chat/StreamingMarkdown.tsx';

describe('the markdown renderer is only reached through its lazy wrapper', () => {
  it('no module outside the wrapper imports StreamingMarkdown', () => {
    const offenders = FILES.filter((file) => file.rel !== RENDERER && file.rel !== LAZY_OWNER)
      .filter((file) => /from\s+['"][^'"]*\/StreamingMarkdown['"]/.test(file.text))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assess, decide, main, parseArgs } from '../format-policy.mjs';

/**
 * The rule this repo's pre-commit hook now delegates to, pinned without depending on
 * `npx biome` (which is slow and resolves its config from the tree): cleanliness comes in
 * through `isClean`, so the interesting behaviour - *when is a file held to the format at
 * all* - is what gets asserted.
 *
 * The point of the whole file: a change PR may not turn a file biome already refused into
 * formatted output, because that buries the change in churn. `--no-verify` was the escape
 * from that trap; this is the replacement.
 */

const roots = [];
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

/** A file is "clean" here when its text starts with a space-free, two-space indent. */
const isCleanText = (text) => !text.includes('\t');
const fakeHead = (map) => (_root, file) => (file in map ? map[file] : null);

function capture(fn) {
  const write = process.stdout.write.bind(process.stdout);
  const lines = [];
  process.stdout.write = (chunk) => lines.push(String(chunk));
  try {
    return { code: fn(), out: lines.join('') };
  } finally {
    process.stdout.write = write;
  }
}

describe('deciding when a file is held to the format', () => {
  it('fails a file this change made dirty', () => {
    expect(decide({ headClean: true, workClean: false })).toBe('regression');
  });

  it('does not blame a change for dirt it did not add', () => {
    expect(decide({ headClean: false, workClean: false })).toBe('pre-existing');
  });

  it('passes what is formatted either way', () => {
    expect(decide({ headClean: false, workClean: true })).toBe('clean');
    expect(decide({ headClean: true, workClean: true })).toBe('clean');
  });
});

describe('assessing files', () => {
  it("treats a file that is new at HEAD as fully its author's", () => {
    const root = tree({ 'src/new.ts': 'export const a = 1;\n' });
    const [row] = assess(['src/new.ts'], {
      root,
      isClean: isCleanText,
      headText: fakeHead({}),
    });
    expect(row.status).toBe('clean');
  });

  it('ignores files biome has nothing to say about', () => {
    const root = tree({ 'docs/a.md': '\tsomething\n' });
    expect(
      assess(['docs/a.md'], {
        root,
        isClean: isCleanText,
        headText: fakeHead({ 'docs/a.md': '\tsomething\n' }),
      }),
    ).toEqual([]);
  });

  it('reports each file once, with the reason attached', () => {
    const root = tree({
      'src/dirty.ts': '\texport const a = 1;\n',
      'src/fresh.ts': '\texport const b = 2;\n',
    });
    const rows = assess(['src/dirty.ts', 'src/fresh.ts', 'src/gone.ts'], {
      root,
      isClean: isCleanText,
      headText: fakeHead({ 'src/dirty.ts': '\texport const a = 0;\n' }),
    });
    expect(rows.map((r) => [r.file, r.status])).toEqual([
      ['src/dirty.ts', 'pre-existing'],
      ['src/fresh.ts', 'regression'],
      ['src/gone.ts', 'clean'],
    ]);
  });
});

describe('the command surface', () => {
  it('refuses to be pointed at a tree', () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['--write'])).toThrow(/name the files/);
  });

  it('will not reformat a directory, even when asked directly', () => {
    const root = tree({ 'src/lib/a.ts': 'export const a = 1;\n' });
    const { code, out } = capture(() =>
      main(['--write', 'src/lib'], { root, run: () => ({ status: 0 }) }),
    );
    expect(code).toBe(2);
    expect(out).toMatch(/refusing directories/);
  });

  it('declines to reflow a file HEAD left unformatted, and does not exit 0', () => {
    const root = tree({ 'src/lib/a.ts': '\texport const a = 1;\n' });
    const written = [];
    const { code, out } = capture(() =>
      main(['--write', 'src/lib/a.ts'], {
        root,
        isClean: isCleanText,
        headText: fakeHead({ 'src/lib/a.ts': '\texport const a = 0;\n' }),
        run: (_c, args) => {
          written.push(args.join(' '));
          return { status: 0 };
        },
      }),
    );
    expect(out).toMatch(/skipped src\/lib\/a\.ts/);
    expect(written).toEqual([]);
    expect(code).toBe(1);
  });

  it('formats a file whose dirt this change caused, when told to', () => {
    const root = tree({ 'src/lib/a.ts': '\texport const a = 1;\n' });
    const written = [];
    const { code } = capture(() =>
      main(['--write', 'src/lib/a.ts', '--allow-reflow'], {
        root,
        isClean: isCleanText,
        headText: fakeHead({ 'src/lib/a.ts': '\texport const a = 0;\n' }),
        run: (_c, args) => {
          written.push(args.join(' '));
          return { status: 0 };
        },
      }),
    );
    expect(code).toBe(0);
    expect(written.length).toBe(1);
    expect(written[0]).toMatch(/--write src\/lib\/a\.ts/);
  });

  it('names the files a --check would reject', () => {
    const root = tree({
      'src/lib/a.ts': '\texport const a = 1;\n',
      'src/lib/b.ts': 'export const b = 1;\n',
    });
    const { code, out } = capture(() =>
      main(['--check', 'src/lib/a.ts', 'src/lib/b.ts'], {
        root,
        isClean: isCleanText,
        headText: fakeHead({}),
        run: () => ({ status: 0 }),
      }),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/not formatted - src\/lib\/a\.ts/);
    expect(out).not.toMatch(/not formatted - src\/lib\/b\.ts/);
    expect(out).toMatch(/pnpm fmt/);
  });
});

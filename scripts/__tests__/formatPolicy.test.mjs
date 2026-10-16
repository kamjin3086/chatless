import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assess,
  decide,
  main,
  makeBiomeCleanCheck,
  parseArgs,
} from '../format-policy.mjs';

/**
 * The rule the pre-commit hook now delegates to, pinned without depending on `npx biome` -
 * cleanliness arrives through `isClean`, so what gets asserted is the thing that matters:
 * *when is a file held to the format at all*.
 *
 * The point of the whole file: a change commit may not turn a file biome already refused into
 * formatted output, because that buries the change. `--no-verify` was the escape from that
 * trap; this is the replacement.
 *
 * "Dirty" here means "contains a tab", which keeps the fixtures readable and the runs fast.
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

function gitRepo(files) {
  const root = tree(files);
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'tests@example.invalid');
  git('config', 'user.name', 'tests');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return { root, git };
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

const isCleanText = (text) => !text.includes('\t');
const fake = (map) => (_root, file) => (file in map ? map[file] : null);

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
  it("treats a file with no history as fully its author's", () => {
    const root = tree({});
    const [row] = assess(['src/new.ts'], {
      root,
      isClean: isCleanText,
      subject: fake({ 'src/new.ts': '\texport const a = 1;\n' }),
      head: fake({}),
    });
    expect(row.status).toBe('regression');
  });

  it('ignores files biome has nothing to say about', () => {
    const root = tree({});
    expect(
      assess(['docs/a.md'], {
        root,
        isClean: isCleanText,
        subject: fake({ 'docs/a.md': '\tsomething\n' }),
        head: fake({ 'docs/a.md': '\tsomething\n' }),
      }),
    ).toEqual([]);
  });

  it('reports each file once, with the reason attached', () => {
    const root = tree({});
    const rows = assess(['src/dirty.ts', 'src/fresh.ts'], {
      root,
      isClean: isCleanText,
      subject: fake({
        'src/dirty.ts': '\texport const a = 1;\n',
        'src/fresh.ts': '\texport const b = 2;\n',
      }),
      head: fake({ 'src/dirty.ts': '\texport const a = 0;\n' }),
    });
    expect(rows.map((r) => [r.file, r.status])).toEqual([
      ['src/dirty.ts', 'pre-existing'],
      ['src/fresh.ts', 'regression'],
    ]);
  });

  it('refuses to guess when it cannot read the bytes under judgement', () => {
    const root = tree({});
    expect(() =>
      assess(['src/gone.ts'], {
        root,
        isClean: isCleanText,
        subject: fake({}),
        head: fake({}),
      }),
    ).toThrow(/cannot read src\/gone\.ts/);
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

  it('says so when a named file does not exist, instead of formatting thin air', () => {
    const root = tree({});
    const { code, out } = capture(() =>
      main(['--check', 'src/lib/nope.ts'], {
        root,
        isClean: isCleanText,
        head: fake({}),
      }),
    );
    expect(code).toBe(2);
    expect(out).toMatch(/cannot read/);
  });

  it('declines to reflow a file HEAD left unformatted, and does not exit 0', () => {
    const root = tree({ 'src/lib/a.ts': '\texport const a = 1;\n' });
    const written = [];
    const { code, out } = capture(() =>
      main(['--write', 'src/lib/a.ts'], {
        root,
        isClean: isCleanText,
        head: fake({ 'src/lib/a.ts': '\texport const a = 0;\n' }),
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

  it('does not report success when biome failed to write', () => {
    const root = tree({ 'src/lib/a.ts': '\texport const a = 1;\n' });
    const { code, out } = capture(() =>
      main(['--write', 'src/lib/a.ts', '--allow-reflow'], {
        root,
        isClean: isCleanText,
        head: fake({ 'src/lib/a.ts': 'export const a = 0;\n' }),
        run: () => ({ status: 1 }),
      }),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/left untouched/);
    expect(out).not.toMatch(/^formatted/m);
  });

  it('formats a file whose dirt this change caused, when told to', () => {
    const root = tree({ 'src/lib/a.ts': '\texport const a = 1;\n' });
    const written = [];
    const { code } = capture(() =>
      main(['--write', 'src/lib/a.ts', '--allow-reflow'], {
        root,
        isClean: isCleanText,
        head: fake({ 'src/lib/a.ts': 'export const a = 0;\n' }),
        run: (_c, args) => {
          written.push(args.join(' '));
          return { status: 0 };
        },
      }),
    );
    expect(code).toBe(0);
    expect(written[0]).toMatch(/--write src\/lib\/a\.ts/);
  });

  it('names the files a --check would reject', () => {
    const root = tree({});
    const { code, out } = capture(() =>
      main(['--check', 'src/lib/a.ts', 'src/lib/b.ts'], {
        root,
        isClean: isCleanText,
        subject: fake({
          'src/lib/a.ts': '\texport const a = 1;\n',
          'src/lib/b.ts': 'export const b = 1;\n',
        }),
        head: fake({}),
        run: () => ({ status: 0 }),
      }),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/not formatted - src\/lib\/a\.ts/);
    expect(out).not.toMatch(/not formatted - src\/lib\/b\.ts/);
    expect(out).toMatch(/pnpm fmt/);
  });
});

describe('what --staged actually looks at', () => {
  it('judges the index, because that is what git is about to commit', () => {
    const { root, git } = gitRepo({ 'src/d.ts': 'export const d = 1;\n' });
    fs.writeFileSync(path.join(root, 'src/d.ts'), '\texport const d = 1;\n');
    git('add', 'src/d.ts');
    // working tree tidied again without staging it: the commit would still carry the tab
    fs.writeFileSync(path.join(root, 'src/d.ts'), 'export const d = 1;\n');

    const { code, out } = capture(() =>
      main(['--staged'], {
        root,
        isClean: isCleanText,
        run: () => ({ status: 0 }),
      }),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/not formatted - src\/d\.ts/);
  });

  it('does not blame a commit for dirt that was never staged', () => {
    const { root, git } = gitRepo({ 'src/c.ts': 'export const c = 1;\n' });
    fs.writeFileSync(
      path.join(root, 'src/c.ts'),
      'export const c = 1;\n\nexport const extra = 2;\n',
    );
    git('add', 'src/c.ts');
    fs.writeFileSync(path.join(root, 'src/c.ts'), '\texport const c = 1;\n');

    const { code } = capture(() =>
      main(['--staged'], {
        root,
        isClean: isCleanText,
        run: () => ({ status: 0 }),
      }),
    );
    expect(code).toBe(0);
  });

  it('leaves a staged deletion alone', () => {
    const { root, git } = gitRepo({
      'src/gone.ts': '\texport const gone = 1;\n',
    });
    fs.rmSync(path.join(root, 'src/gone.ts'));
    git('rm', '-q', 'src/gone.ts');
    const { code } = capture(() =>
      main(['--staged'], {
        root,
        isClean: isCleanText,
        run: () => ({ status: 0 }),
      }),
    );
    expect(code).toBe(0);
  });
});

describe('when the check itself cannot run', () => {
  it('exits 2 rather than calling an unread file clean', () => {
    const root = tree({ 'src/lib/a.ts': 'export const a = 1;\n' });
    const { code, out } = capture(() =>
      main(['--check', 'src/lib/a.ts'], {
        root,
        isClean: () => {
          throw new Error('biome could not run (npx missing)');
        },
        head: fake({}),
      }),
    );
    expect(code).toBe(2);
    expect(out).toMatch(/biome could not run/);
  });

  it('treats a biome process that died as unavailable, not as dirty', () => {
    const root = tree({ 'src/lib/a.ts': 'export const a = 1;\n' });
    const check = makeBiomeCleanCheck(root, () => ({
      status: null,
      signal: 'SIGKILL',
    }));
    expect(() => check('export const a = 1;\n', 'src/lib/a.ts')).toThrow(
      /could not run/,
    );
  });
});

describe('a reflow is not a free change', () => {
  // Retrospective: three PRs this week carried whole-file biome reflows mixed into logic
  // changes. `pnpm fmt` refuses to create one; calling biome directly gets past that, and
  // the per-file policy, which only looks for new dirt, had nothing to say. A file HEAD left
  // unformatted that is now fully formatted is a reflow, and it belongs in its own commit.
  it('names the state that used to be invisible', async () => {
    const { decide } = await import('../format-policy.mjs');
    expect(decide({ headClean: true, workClean: true, reflow: 99 })).toBe(
      'clean',
    );
    expect(decide({ headClean: false, workClean: true, reflow: 99 })).toBe(
      'reflow',
    );
    expect(decide({ headClean: true, workClean: false })).toBe('regression');
    expect(decide({ headClean: false, workClean: false })).toBe('pre-existing');
  });

  it('only pays for the HEAD question when the file actually changed', async () => {
    const { assess } = await import('../format-policy.mjs');
    const asked = [];
    const rows = assess(['same.ts', 'reflowed.ts'], {
      root: '/r',
      isClean: (text) => {
        if (text === 'bytes-before') asked.push('bytes-before');
        // what HEAD left unformatted stays unformatted as far as this spy is concerned
        return text !== 'bytes-before';
      },
      subject: () => 'bytes-after',
      head: (_r, f) => (f === 'same.ts' ? 'bytes-after' : 'bytes-before'),
      reflowMinLines: 1,
    });
    // only the file whose bytes moved asks HEAD anything
    expect(asked).toEqual(['bytes-before']);
    expect(rows.map((r) => [r.file, r.status])).toEqual([
      ['same.ts', 'clean'],
      ['reflowed.ts', 'reflow'],
    ]);
  });

  it('lets a small cleanup through, because that is not what the rule guards', async () => {
    const { decide } = await import('../format-policy.mjs');
    expect(decide({ headClean: false, workClean: true, reflow: 2 })).toBe(
      'clean',
    );
    expect(decide({ headClean: false, workClean: true, reflow: 60 })).toBe(
      'reflow',
    );
  });

  it('is reported as something to split, not as clean', async () => {
    const { describeReflow } = await import('../format-policy.mjs');
    const line = describeReflow(['src/a.ts']);
    expect(line).toContain('src/a.ts');
    expect(line).toContain('--allow-reflow');
  });
});

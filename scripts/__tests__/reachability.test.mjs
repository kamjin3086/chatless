import { describe, expect, it } from 'vitest';
import {
  analyze,
  namedInStrings,
  report,
  resolveSpecifier,
} from '../reachability.mjs';

/**
 * The graph is only worth reading if the fixture below says what a bug would look like: a module
 * that is alive because a page imports it, two dead modules that keep each other company, one
 * alone, and one that only a test still imports. Each of those classes was present in the real
 * tree on the first run (79 unreachable, 14 test-only, 6 clusters), and each one is a different
 * mistake to get wrong.
 */
const TREE = {
  'package.json': JSON.stringify({
    scripts: { 'dev:db': 'tsx src/scripts/dev-db-reset.ts' },
  }),
  'src/app/page.tsx': `import { Live } from '@/components/Live';\nexport default () => <Live />;`,
  'src/app/other/page.tsx': `import '@/lib/fromAnotherPage';`,
  'src/lib/fromAnotherPage.ts': `export const x = 1;`,
  'src/components/Live.tsx': `import { helper } from '../lib/fromAnotherPage';\nexport const Live = () => null; void helper;`,
  'src/components/dead/Orphan.tsx': `export const orphan = 1;`,
  'src/components/dead/Pair.tsx': `import { b } from './PairB';\nexport const a = 1; void b;`,
  'src/components/dead/PairB.ts': `import { a } from './Pair';\nexport const b = 2; void a;`,
  'src/components/dead/Tested.tsx': `export const tested = 3;`,
  'src/components/dead/__tests__/Tested.test.ts': `import { tested } from '../Tested';\nit('works', () => tested);`,
  'src/scripts/dev-db-reset.ts': `console.log('reset');`,
  'src/scripts/dev-db-check.ts': `console.log('nobody runs this');`,
  'src/instrumentation-client.ts': `export {};`,
};

const opts = {
  root: '/virtual',
  files: Object.keys(TREE),
  readText: (f) => TREE[f] ?? '',
  scripts: [['dev:db', 'tsx src/scripts/dev-db-reset.ts']],
};

const run = () => analyze(opts);

describe('the graph', () => {
  it('follows @/ and relative paths, and treats framework-loaded files as roots', () => {
    const r = run();
    expect(r.counts.entries).toBe(4); // two pages, instrumentation, the package-referenced script
    expect(r.unreachable).not.toContain('src/lib/fromAnotherPage.ts');
    expect(r.unreachable).not.toContain('src/components/Live.tsx');
  });

  it('counts a script nobody runs as dead, and one a package script runs as an entry', () => {
    const r = run();
    expect(r.unreachable).toContain('src/scripts/dev-db-check.ts');
    expect(r.unreachable).not.toContain('src/scripts/dev-db-reset.ts');
  });

  it('separates what only a test still imports from what nothing imports', () => {
    const r = run();
    expect(r.testOnly).toEqual(['src/components/dead/Tested.tsx']);
    // Orphan, the pair, and the script nobody runs. Tested is not among them: a test is a root
    // for the "kept alive by tests only" line, never for "reachable from the shipped app".
    expect(r.unreachable.sort()).toEqual(
      [
        'src/components/dead/Orphan.tsx',
        'src/components/dead/Pair.tsx',
        'src/components/dead/PairB.ts',
        'src/scripts/dev-db-check.ts',
      ].sort(),
    );
    expect(r.counts.noImportersAtAll).toBe(2); // Orphan and the unrun script
  });

  it('groups dead code that only references itself, so a deletion is one decision', () => {
    const r = run();
    const pair = r.clusters.find((g) => g.length === 2);
    expect(pair).toEqual([
      'src/components/dead/Pair.tsx',
      'src/components/dead/PairB.ts',
    ]);
  });
});

describe('what the report owns', () => {
  it('resolves a specifier the way the bundler does, and says null for anything external', () => {
    const have = new Set([
      'src/a/b.ts',
      'src/a/index.ts',
      'src/a/b.css',
      'package.json',
    ]);
    expect(resolveSpecifier('@/a/b', 'src/app/page.tsx', have)).toBe(
      'src/a/b.ts',
    );
    expect(resolveSpecifier('../../a', 'src/lib/x/y.ts', have)).toBe(
      'src/a/index.ts',
    );
    expect(resolveSpecifier('./b.css', 'src/a/x.ts', have)).toBe('src/a/b.css');
    expect(resolveSpecifier('react', 'src/app/page.tsx', have)).toBeNull();
    expect(
      resolveSpecifier('@tauri-apps/api/path', 'src/app/page.tsx', have),
    ).toBeNull();
  });

  it('calls a path-shaped string a suspect and a word in a sentence not', () => {
    const sources = new Map([
      [
        'src/app/page.tsx',
        `const label = 'retry the request';\n// import x from '@/dead/Orphan';\nconst y = '@dead/Orphan';`,
      ],
    ]);
    const live = new Set(['src/app/page.tsx']);
    const tracked = new Set(['src/app/page.tsx', 'src/dead/Orphan.ts']);
    const suspects = namedInStrings({
      candidates: new Set(['src/dead/Orphan.ts']),
      live,
      tracked,
      sources,
    });
    // one hit, the comment: 'retry the request' is prose, and prose is not an edge.
    expect(suspects.size).toBe(1);
    expect(suspects.get('src/dead/Orphan.ts')[0]).toContain(
      'comment in src/app/page.tsx',
    );
  });

  it('names its own blind spots in the first line, so a reader knows what was not looked at', () => {
    const lines = [];
    report(run(), (l) => lines.push(l));
    expect(lines[0]).toContain('11 source modules, 4 entry points');
    expect(lines.join('\n')).toContain('blind spots');
    expect(lines.join('\n')).toContain('kept alive by tests only');
  });
});

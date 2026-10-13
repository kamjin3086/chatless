import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The repo has two vitest configs and the one that is *not* wired to CI is easy
 * to write about carelessly: an `include` entry that matches nothing collects
 * silently, and a doc can claim a runner does not exist when it does. Both are
 * machine-checkable, so they are checked here instead of trusted to prose.
 */
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const configs = ['vitest.config.ts', 'docs/acceptance/vitest.config.ts'];
const skipDirs = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'target',
  'coverage',
  '.turbo',
]);

/** @param {string} configPath path relative to the repo root */
/**
 * Drop `//` comment tails without touching quoted strings.
 *
 * The include list is full of prose explaining why each entry is there, and a glob in a
 * comment is not a glob: without this, a comment mentioning `typeof import('x').Y` becomes
 * an "entry that collects nothing" and the checker reports a wiring problem that does not
 * exist. Quote-aware, so real entries containing slashes survive.
 */
function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => {
      let quote = '';
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = '';
          continue;
        }
        if (ch === "'" || ch === '"') quote = ch;
        else if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** The include globs a vitest config declares, comments excluded. */
function parseIncludeEntries(text) {
  const block = stripLineComments(text).match(/include:\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error('no include list');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function includeEntries(configPath) {
  const text = fs.readFileSync(path.join(repoRoot, configPath), 'utf8');
  try {
    return parseIncludeEntries(text);
  } catch {
    throw new Error(`${configPath} declares no include list`);
  }
}

/** @returns {Generator<string>} every tracked-ish file path, repo-relative */
function* walk(dir = '') {
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), {
    withFileTypes: true,
  })) {
    if (skipDirs.has(entry.name)) continue;
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(relative);
    else yield relative;
  }
}

function toRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else out += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`);
}

function collectedBy(patterns) {
  const matchers = patterns.map(toRegExp);
  return [...walk()].filter((file) => matchers.some((re) => re.test(file)));
}

describe('include list parsing', () => {
  it('ignores globs and quoted words inside comments', () => {
    const text = `export default defineConfig({
  test: {
    include: [
      // A comment mentioning 'x' or 'docs/acceptance/*.audit.test.ts' is prose, not wiring.
      'src/**/*.test.ts', // trailing note about 'nothing.test.ts'
    ],
  },
});`;
    expect(parseIncludeEntries(text)).toEqual(['src/**/*.test.ts']);
  });

  it('still fails loudly when there is no include list at all', () => {
    expect(() => parseIncludeEntries('export default {};')).toThrow();
  });
});

describe('vitest include wiring', () => {
  for (const config of configs) {
    it(`${config}: every include entry matches real files`, () => {
      const entries = includeEntries(config);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        const matched = collectedBy([entry]);
        expect(
          matched.length,
          `${config}: "${entry}" collects nothing`,
        ).toBeGreaterThan(0);
      }
    });
  }

  it('every acceptance audit is transpiled by the normal suite', () => {
    const audits = [...walk()].filter((file) =>
      file.endsWith('.audit.test.ts'),
    );
    expect(audits.length).toBeGreaterThan(0);
    // Coverage by *either* config was the old claim, and it was the hole: the acceptance
    // config only runs when an operator sets an endpoint variable, so an audit collected
    // only there is never even transpiled in CI. `pnpm test` has to collect every one of
    // them - skipping themselves is fine, never having been parsed is not.
    const collected = new Set(collectedBy(includeEntries('vitest.config.ts')));
    const orphans = audits.filter((file) => !collected.has(file));
    expect(
      orphans,
      `not collected by vitest.config.ts, so nothing transpiles them until a live run: ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});

describe('maintenance.md wiring claims', () => {
  const doc = fs.readFileSync(
    path.join(repoRoot, 'docs/agents/maintenance.md'),
    'utf8',
  );

  it('names both vitest configs, so it cannot claim the acceptance runner is missing', () => {
    for (const config of configs) expect(doc).toContain(config);
  });

  it('only cites acceptance audit files that exist', () => {
    const cited = [
      ...doc.matchAll(/docs\/acceptance\/[\w-]+\.audit\.test\.ts/g),
    ].map((m) => m[0]);
    expect(cited.length).toBeGreaterThan(0);
    const missing = [...new Set(cited)].filter(
      (file) => !fs.existsSync(path.join(repoRoot, file)),
    );
    expect(
      missing,
      `docs cite files that do not exist: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});

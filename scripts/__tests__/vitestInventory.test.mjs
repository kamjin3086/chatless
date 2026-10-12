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
function includeEntries(configPath) {
  const text = fs.readFileSync(path.join(repoRoot, configPath), 'utf8');
  const block = text.match(/include:\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error(`${configPath} declares no include list`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
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

  it('every acceptance audit is collected by at least one config', () => {
    const audits = [...walk()].filter((file) =>
      file.endsWith('.audit.test.ts'),
    );
    expect(audits.length).toBeGreaterThan(0);
    const collected = new Set(
      configs.flatMap((config) => collectedBy(includeEntries(config))),
    );
    const orphans = audits.filter((file) => !collected.has(file));
    expect(
      orphans,
      `not collected by either config: ${orphans.join(', ')}`,
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

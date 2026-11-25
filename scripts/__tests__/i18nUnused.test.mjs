import { describe, expect, it } from 'vitest';
import { declaredKeys, main, unusedKeys, usageOf } from '../i18n-unused.mjs';

/**
 * Deleting a component without its locale keys is invisible, and it happened: ten `skillRisk.*`
 * keys outlived the store that rendered them, in a PR whose body said the strings had been
 * checked key by key. Reviewers found it twice by hand, with hand-written censuses - one of
 * which counted composed keys as orphans, which is how a census earns being ignored.
 */
describe('what the code asks for', () => {
  it('knows a literal key, a hole in a template, and a concatenated key', () => {
    const usage = usageOf([
      `const a = t('skill.card.run');`,
      'const b = `${t("thinkingSwitch.label")}: ${readout}`;',
      'const c = `settings.sync.connection.${state}`;',
      'const d = labelFor(`provider.${name}.label`);',
    ]);
    const key = (k) => unusedKeys([k], usage).unused.includes(k);
    expect(key('skill.card.run')).toBe(false);
    // the quoted-inside-a-hole shape, which is what made nine live keys look orphaned at first
    expect(key('thinkingSwitch.label')).toBe(false);
    expect(key('settings.sync.connection.connected')).toBe(false); // composed: prefix + suffix
    expect(key('provider.openai.label')).toBe(false);
    // the prefix is itself a use (the code composes it), a name nothing composes is not
    expect(key('settings.sync.connection')).toBe(false);
    expect(key('nothing.asks.for.this')).toBe(true);
  });

  it('does not let one key certify another that merely contains it', () => {
    // `settings.advanced.logLevel` is inside the literal of `…logLevelChanged`. A substring
    // rule that loose certifies half the catalog from the other half, and the census stops
    // meaning anything.
    const usage = usageOf([`t('settings.advanced.logLevelChanged')`]);
    expect(unusedKeys(['settings.advanced.logLevel'], usage).unused).toEqual([
      'settings.advanced.logLevel',
    ]);
  });

  it('reads the two catalog shapes: object entries and the union of keys', () => {
    expect([
      ...declaredKeys("  'a.one': 'One',\n  'a.two': 'Two',", 'locale'),
    ]).toEqual(['a.one', 'a.two']);
    expect(
      [...declaredKeys("  | 'a.one'\n  | 'a.two',", 'types')].sort(),
    ).toEqual(['a.one', 'a.two']);
  });
});

describe('the check itself', () => {
  it('names the orphan and fails, pointing at the file that decides', () => {
    const written = [];
    const code = main([], {
      root: process.cwd(),
      read: (file) => {
        if (file.endsWith('allowlist.json')) return '[]';
        if (file.endsWith('en-US.ts')) return "  'gone.key': 'Gone',\n";
        if (file.endsWith('zh-CN.ts')) return "  'gone.key': '没了',\n";
        if (file.endsWith('types.ts')) return "  | 'gone.key',\n";
        return '';
      },
      write: (l) => written.push(l),
    });
    expect(code).toBe(1);
    expect(written.join('\n')).toContain('gone.key');
    expect(written.join('\n')).toContain('i18n-unused.allowlist.json');
  });

  it('keeps an allowlisted orphan tolerated but not forgotten, and drops entries that rot', () => {
    const read = (file) => {
      if (file.endsWith('allowlist.json'))
        return JSON.stringify(['gone.key', 'not.declared']);
      if (file.endsWith('en-US.ts')) return "  'gone.key': 'Gone',\n";
      if (file.endsWith('zh-CN.ts')) return "  'gone.key': '没了',\n";
      if (file.endsWith('types.ts')) return "  | 'gone.key',\n";
      return '';
    };
    const written = [];
    expect(
      main([], { root: process.cwd(), read, write: (l) => written.push(l) }),
    ).toBe(1);
    // `not.declared` is allowlisted but no longer exists at all - the list has to stay honest.
    expect(written.join('\n')).toContain('stale allowlist entry: not.declared');
  });

  it('passes on the tree as it stands, so a new deletion is what turns it red', () => {
    const written = [];
    expect(
      main([], { root: process.cwd(), write: (l) => written.push(l) }),
    ).toBe(0);
    expect(written.join('\n')).toMatch(/unreferenced/);
  });
});

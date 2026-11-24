import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSkillIndex, skillIndexBlocks } from '../skillIndex';
import type { SkillIndexEntryView } from '../skillIndex';

/**
 * What is valuable about `skillIndex.ts` is that it is pure: entries in, text out, no
 * third world involved.
 *
 * That is not a style preference. Four paths into this area never worked, and each one was
 * paid for by someone reading the store or the disk from inside the renderer: every extra
 * read adds a timing question, and a timing question in a prompt shows up as one user's
 * index differing from another's - the hardest class of report to trace. So purity is
 * asserted here rather than commented: whoever adds an import back runs into this test and
 * the explanation, instead of discovering in integration that the index has become
 * unpredictable.
 */
const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/lib/skills/skillIndex.ts'),
  'utf8',
);

// Comments mention `SkillManager` by name (the seam's other side), so the scan runs on the
// code with comments removed: this test is about what is actually imported, not about which
// words appear in prose.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /(^|[^:])\/\/.*$/gm,
  '$1',
);

/** Everything the module may import. Adding a line here is the moment "read from disk" becomes a decision again. */
const ALLOWED_IMPORTS = [
  '@/lib/mcp/prompt/composition', // type only: PromptBlock
  './types',
  './invocation',
];

/** Dependencies that would put a world behind the seam: disk, store, Tauri, loaders. */
const FORBIDDEN_IMPORTS = [
  'node:fs',
  'node:path',
  '@tauri-apps',
  './SkillManager',
  './LocalSkillLoader',
  './RemoteSkillLoader',
  '@/store',
];

/** Reads that make the same input produce different bytes. */
const FORBIDDEN_CALLS = [
  'Date.now',
  'Math.random',
  'process.env',
  'localStorage',
];

function importSources(): string[] {
  const statics = [...CODE.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  );
  const dynamics = [...CODE.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (m) => m[1],
  );
  return [...statics, ...dynamics];
}

describe('the skill index stays a pure module', () => {
  it('reads a real file, so a rename fails here rather than passing vacuously', () => {
    expect(SOURCE.length).toBeGreaterThan(500);
  });

  it('imports nothing but the prompt block type, the policy and its own types', () => {
    const sources = importSources();

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(
        ALLOWED_IMPORTS,
        `skillIndex.ts must not import ${source}`,
      ).toContain(source);
    }
  });

  it('names and refuses the dependencies that would put a world behind the seam', () => {
    const sources = importSources();
    for (const forbidden of FORBIDDEN_IMPORTS) {
      expect(
        sources.some((s) => s.startsWith(forbidden)),
        `skillIndex.ts reached for ${forbidden}`,
      ).toBe(false);
    }
  });

  it('touches no clock and no randomness, so a call cannot depend on when it happens', () => {
    for (const needle of FORBIDDEN_CALLS) {
      expect(CODE, `skillIndex.ts reached for ${needle}`).not.toContain(needle);
    }
  });

  it('is synchronous', () => {
    expect(CODE).not.toMatch(/\basync\b/);
    expect(CODE).not.toMatch(/\bawait\b/);
    expect(CODE).not.toMatch(/\bPromise\b/);
  });

  it('returns the same bytes for the same input, twice over', () => {
    const entries: SkillIndexEntryView[] = [
      { id: 'b', name: 'B', description: 'Second skill.' },
      { id: 'a', name: 'A', description: 'First skill.' },
    ];
    const once = skillIndexBlocks(buildSkillIndex(entries));
    const twice = skillIndexBlocks(buildSkillIndex(entries));

    expect(twice).toEqual(once);
    // Sorting may not consult locale either: two machines with the same skills must send
    // the same bytes.
    const shuffled = skillIndexBlocks(buildSkillIndex([...entries].reverse()));
    expect(shuffled).toEqual(once);
  });
});

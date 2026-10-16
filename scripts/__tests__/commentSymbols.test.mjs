import { describe, expect, it } from 'vitest';
import {
  CommentCheckUnavailable,
  commentSymbolMentions,
  findMissingSymbols,
  main,
} from '../comment-symbols.mjs';

/**
 * Two review rounds in a row caught the same class: a comment that names a symbol which
 * does not exist. One of them told the reader to "call `normalizeModelParameters` when a
 * complete bag is needed" - a function the same PR had deleted. CODING_STANDARDS calls this
 * overstated evidence; it is also mechanical enough that no reviewer should ever have to
 * spot it again.
 */
describe('what a comment promises', () => {
  it('collects the camelCase names a comment says the code has', () => {
    const lines = [
      ' * call `normalizeModelParameters` when a complete bag is needed',
      '  // `resolveSendParameters` folds the one-shot in',
      ' * prose about `auto` and `medium` is not a symbol',
      '  const temperature = 1; // not a comment-only mention: code line',
      ' * `sanitizeParameterPatch` cleans; `getProviderConfig` looks up',
    ];
    expect(commentSymbolMentions(lines).sort()).toEqual([
      'getProviderConfig',
      'normalizeModelParameters',
      'resolveSendParameters',
      'sanitizeParameterPatch',
    ]);
  });

  it('reports the names nothing defines', () => {
    const found = findMissingSymbols(
      ['normalizeModelParameters', 'getProviderConfig'],
      (name) => name === 'getProviderConfig',
    );
    expect(found).toEqual(['normalizeModelParameters']);
  });

  it('says which file made the promise, so it can be fixed', () => {
    const written = [];
    const code = main(['src/types/model-params.ts'], {
      read: () => [
        ' * call `normalizeModelParameters` when a complete bag is needed',
      ],
      exists: () => false,
      write: (line) => written.push(line),
    });
    expect(code).toBe(1);
    expect(written.join('\n')).toContain('normalizeModelParameters');
    expect(written.join('\n')).toContain('src/types/model-params.ts');
  });

  it('passes on a repo where every promise is kept', () => {
    const written = [];
    const code = main(['src/lib/model-parameters.ts'], {
      read: () => [' * `sanitizeParameterPatch` drops what it cannot trust'],
      exists: () => true,
      write: (line) => written.push(line),
    });
    expect(code).toBe(0);
    expect(written).toEqual([]);
  });
});

describe('a check that cannot run does not get to accuse anybody', () => {
  it('exits 2 when the lookup itself is broken, not 1 on every comment', async () => {
    // grep missing from PATH is the realistic case: "no match" and "no grep" would otherwise
    // look identical, and the hook would blame every comment in the tree for a missing tool.
    const { main } = await import('../comment-symbols.mjs');
    const written = [];
    const code = main(['src/a.ts'], {
      read: () => [' * `sanitizeParameterPatch` drops what it cannot trust'],
      exists: () => {
        throw new CommentCheckUnavailable(
          'grep is not available, so symbol promises cannot be checked',
        );
      },
      write: (line) => written.push(line),
    });
    expect(code).not.toBe(0);
    expect(written.join('\n')).toContain('cannot be checked');
  });
});

describe('a mention is not a definition', () => {
  it('does not let the doc that tells the story certify the stale pointer', async () => {
    // check-quoted names below are the point, not an oversight: comment-symbols:ignore
    // The first version grepped the bare name anywhere, so `normalizeModelParameters` - the
    // deleted function this check exists to catch - was found in the maintenance note about
    // it, in the check's own header, and in this file's fixtures. The check could never have
    // failed on its own motivating case.
    const { definesSymbol } = await import('../comment-symbols.mjs');
    const onlyComment =
      'docs/agents/maintenance.md: * call `normalizeModelParameters` when needed';
    expect(definesSymbol('normalizeModelParameters', onlyComment)).toBe(false);
    expect(
      definesSymbol(
        'sanitizeParameterPatch',
        'src/lib/model-parameters.ts:export function sanitizeParameterPatch(raw) {',
      ),
    ).toBe(true);
    expect(definesSymbol('getProviderConfig', '')).toBe(false);
  });
});

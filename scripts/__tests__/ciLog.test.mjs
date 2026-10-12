import { describe, expect, it } from 'vitest';
import {
  cleanLogLine,
  isRelevant,
  keepRuleFor,
  parseArgs,
  selectRelevant,
} from '../ci-log.mjs';

// Lines arrive from `gh run view --log` as: job \t step \t timestamp + ANSI + text.
const RAW =
  'frontend-checks\tRun unit tests\t2026-10-12T06:47:01.4322075Z  \x1b[32m✓\x1b[39m scripts/__tests__/repoState.test.mjs \x1b[2m(17 tests)\x1b[22m';
const RAW_TITLE =
  'frontend-checks\tCheck PR title\t2026-10-12T06:46:11.7991860Z check-pr-title: ok - feat(x): y';
const RAW_NOISE =
  'frontend-checks\tSetup Node\t2026-10-12T06:44:01.0000000Z downloading node 20.9.0 ...';

describe('cleanLogLine', () => {
  it('drops the job, step and timestamp prefixes and the ANSI codes', () => {
    expect(cleanLogLine(RAW)).toBe(
      '✓ scripts/__tests__/repoState.test.mjs (17 tests)',
    );
  });

  it('leaves a line with no prefix alone', () => {
    expect(cleanLogLine('plain text')).toBe('plain text');
  });

  it('strips the caret notation gh logs actually contain', () => {
    // verified with `gh run view --job <id> --log | od -c`: the codes are "^[[32m",
    // a literal caret and brackets, not an ESC byte
    expect(
      cleanLogLine('job	step	2026-10-12T06:47:01.4322075Z  ^[[32m✓^[[39m x'),
    ).toBe('✓ x');
  });
});

describe('isRelevant', () => {
  it('keeps the lines that answer "what did CI actually run"', () => {
    expect(isRelevant(cleanLogLine(RAW))).toBe(true);
    expect(isRelevant(cleanLogLine(RAW_TITLE))).toBe(true);
  });

  it('drops setup chatter', () => {
    expect(isRelevant(cleanLogLine(RAW_NOISE))).toBe(false);
  });

  it('keeps the failures a reviewer cannot afford to miss', () => {
    // the first filter dropped all five of these, so a red typecheck printed nothing
    for (const line of [
      'error TS2345: Type "string" is not assignable to type "number".',
      'Failed to compile.',
      '✖ 3 problems (3 errors, 0 warnings)',
      'Tests  2 failed | 502 passed (504)',
      'test result: FAILED. 0 passed; 1 failed',
    ]) {
      expect(isRelevant(line)).toBe(true);
    }
  });

  it('keeps the classes a second round of red-job evidence exposed', () => {
    // each of these came back DROP from a reviewer running a genuinely red run
    for (const line of [
      'Unhandled Errors',
      'Unhandled Rejection. Error: boom-unhandled',
      'Errors  1 error',
      'Build failed because of webpack errors',
      'Failed to collect page data for /settings',
      'TypeError: Cannot read properties of undefined (reading "map")',
      'Found 3 errors',
      'ERROR: Coverage for lines (41.2%) does not meet global threshold (80%)',
    ]) {
      expect(isRelevant(line), line).toBe(true);
    }
  });

  it('names the rule that kept a line', () => {
    // the table is the documentation of "which failures survive"; a label going empty
    // means a class quietly stopped being covered
    expect(keepRuleFor('Tests  2 failed | 502 passed (504)')).toBe(
      'test summary',
    );
    expect(keepRuleFor('error TS2345: nope')).toBe('typescript');
    expect(keepRuleFor('downloading node 20.9.0 ...')).toBe(null);
  });

  it('does not light up on the word error inside a crate name', () => {
    // the first version matched bare `error`, so `Compiling thiserror-impl` poured in
    expect(isRelevant('Compiling thiserror-impl v2.0.18')).toBe(false);
    expect(isRelevant('Checking serde_path_to_error v0.1.17')).toBe(false);
    expect(isRelevant('error[E0308]: mismatched types')).toBe(true);
  });

  it('honours an extra pattern from the caller', () => {
    expect(isRelevant('cargo: some rust thing', 'cargo')).toBe(true);
  });
});

describe('parseArgs', () => {
  it('keeps a bare PR number positional when no flag is present', () => {
    expect(parseArgs(['94'])).toMatchObject({
      positional: ['94'],
      job: undefined,
      all: false,
    });
  });

  it('pairs flag values and keeps the PR number alongside them', () => {
    expect(parseArgs(['94', '--grep', 'cargo'])).toMatchObject({
      positional: ['94'],
      extra: 'cargo',
    });
    expect(parseArgs(['--job', '1147', '--all'])).toMatchObject({
      positional: [],
      job: '1147',
      all: true,
    });
  });
});

describe('selectRelevant', () => {
  it('keeps the indented reason that follows a failed check', () => {
    // the red job printed `✖ check-pr-title failed` and then, indented, the actual
    // reason; the first filter kept the headline and dropped the answer
    const head =
      'frontend-checks\tCheck PR title\t2026-10-12T06:46:11.799186Z ✖ check-pr-title failed';
    const why =
      'frontend-checks\tCheck PR title\t2026-10-12T06:46:11.799187Z   - title is 84 characters, keep it under 80';
    const fix =
      'frontend-checks\tCheck PR title\t2026-10-12T06:46:11.799188Z   Fix: retitle the PR with pnpm check:pr-title "..."';
    const out = selectRelevant(
      [RAW_NOISE, head, why, fix, RAW_NOISE].join('\n'),
    );
    expect(out).toContain('✖ check-pr-title failed');
    expect(out).toContain('- title is 84 characters, keep it under 80');
    expect(out).toContain('Fix: retitle the PR with pnpm check:pr-title "..."');
    expect(out).not.toContain('downloading node 20.9.0 ...');
  });

  it('dedupes while keeping order', () => {
    const out = selectRelevant([RAW, RAW, RAW_NOISE, RAW_TITLE].join('\n'));
    expect(out).toEqual([
      '✓ scripts/__tests__/repoState.test.mjs (17 tests)',
      'check-pr-title: ok - feat(x): y',
    ]);
  });
});

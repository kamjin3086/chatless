import { describe, expect, it } from 'vitest';
import {
  formatState,
  mergedInFromError,
  parseSha,
  parseWorktrees,
} from '../repo-state.mjs';

const SHA_A = '2ce6d2f111111111111111111111111111111111';
const SHA_B = 'd9e84fe222222222222222222222222222222222';

const porcelain = [
  'worktree /home/dev/chatless',
  `HEAD ${SHA_A}`,
  'branch refs/heads/refactor/filesystem-seam-1',
  '',
  'worktree /tmp/wt/pr84',
  `HEAD ${SHA_B}`,
  'detached',
  '',
].join('\n');

describe('parseWorktrees', () => {
  it('reads path, branch and head out of git worktree list --porcelain', () => {
    expect(parseWorktrees(porcelain)).toEqual([
      {
        path: '/home/dev/chatless',
        branch: 'refactor/filesystem-seam-1',
        head: SHA_A,
      },
      { path: '/tmp/wt/pr84', branch: null, head: SHA_B },
    ]);
  });

  it('keeps the full sha, because ancestry is counted with it', () => {
    const [first] = parseWorktrees(porcelain);
    expect(first.head).toHaveLength(40);
  });
});

describe('formatState', () => {
  const base = {
    main: {
      shortSha: '413a5fb',
      source: 'git/ref/heads/main',
      sourceKind: 'authoritative',
    },
    branch: 'feat/thing',
    dirty: 0,
    ahead: 1,
    mainMergedIn: false,
    worktrees: [
      {
        path: '/home/dev/chatless',
        branch: 'feat/thing',
        head: SHA_A,
        behindMain: 3,
      },
    ],
    prs: [],
    prsAvailable: true,
    prsWindowFull: false,
  };

  it('prints the authoritative main pointer and the branch state', () => {
    const out = formatState(base);
    expect(out).toContain('main            = 413a5fb (git/ref/heads/main)');
    expect(out).toContain('branch          = feat/thing dirty=0 ahead=1');
    expect(out).toContain('main merged in  = no');
    // full sha in, seven characters out
    expect(out).toContain(
      '/home/dev/chatless feat/thing 2ce6d2f behind-main=3',
    );
    expect(out).toContain('open PRs: none');
  });

  it('reports a merged branch as merged', () => {
    expect(formatState({ ...base, mainMergedIn: true })).toContain(
      'main merged in  = yes',
    );
  });

  it('renders PR truth from state only - mergeable is not merged', () => {
    const out = formatState({
      ...base,
      prs: [
        {
          number: 90,
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          title: 'chore(hooks): x',
        },
      ],
    });
    expect(out).toContain('#90 OPEN');
    expect(out).not.toContain('#90 MERGED');
  });

  it('says unknown instead of none when gh could not answer', () => {
    expect(formatState({ ...base, prs: [], prsAvailable: false })).toContain(
      'open PRs: unknown (gh could not answer)',
    );
  });

  it('says unknown even if a caller forgot the flag', () => {
    const { prsAvailable, ...state } = { ...base, prs: [] };
    expect(formatState(state)).toContain('open PRs: unknown');
  });

  it('says when the PR window is full instead of implying a complete list', () => {
    const out = formatState({
      ...base,
      prs: [{ number: 1, state: 'OPEN', title: 't' }],
      prsWindowFull: true,
      prsCap: 100,
    });
    expect(out).toContain('open PRs (>=100, window full) (1):');
  });

  it('labels the list PRs, not open PRs, once a non-open one is in it', () => {
    const out = formatState({
      ...base,
      prs: [{ number: 91, state: 'MERGED', title: 't' }],
    });
    expect(out).toContain('PRs (1):');
    expect(out).not.toContain('open PRs (1):');
  });

  it('shows the merge time when a PR really merged', () => {
    const out = formatState({
      ...base,
      prs: [
        {
          number: 91,
          state: 'MERGED',
          mergedAt: '2026-10-12T04:45:22Z',
          title: 'chore(checks): y',
        },
      ],
    });
    expect(out).toContain('#91 MERGED 2026-10-12T04:45:22Z');
  });

  it('says unknown when merge-base could not resolve the revs', () => {
    expect(formatState({ ...base, mainMergedIn: null })).toContain(
      'main merged in  = unknown',
    );
  });

  it('flags a main pointer that came from a local ref, by kind not by prose', () => {
    const out = formatState({
      ...base,
      main: {
        shortSha: '413a5fb',
        source: 'origin/main local ref (gh could not answer)',
        sourceKind: 'local',
      },
    });
    expect(out).toContain('main merged in  = no [main is a local ref here');
  });

  it('prints unknown for behind-main and ahead instead of guessing', () => {
    const out = formatState({
      ...base,
      ahead: null,
      worktrees: [
        { path: '/gone', branch: 'x', head: SHA_A, behindMain: null },
      ],
    });
    expect(out).toContain('ahead=unknown');
    expect(out).toContain('/gone x 2ce6d2f behind-main=unknown');
  });
});

describe('mergedInFromError', () => {
  it('reads exit 1 as a real "no"', () => {
    expect(mergedInFromError(1)).toBe(false);
  });

  it('reads any other failure as no answer at all', () => {
    expect(mergedInFromError(128)).toBe(null);
    expect(mergedInFromError(undefined)).toBe(null);
    expect(mergedInFromError('ETIMEDOUT')).toBe(null);
  });
});

describe('parseSha', () => {
  it('accepts the bare value gh --jq prints', () => {
    expect(parseSha(`${SHA_A}\n`)).toBe(SHA_A);
  });

  it('rejects anything that is not a commit sha rather than passing it through', () => {
    expect(() => parseSha('null')).toThrow(/not a commit sha/);
    expect(() => parseSha('2ce6d2f')).toThrow(/not a commit sha/);
    expect(() => parseSha(`{"sha":"${SHA_A}"}`)).toThrow(/not a commit sha/);
  });
});

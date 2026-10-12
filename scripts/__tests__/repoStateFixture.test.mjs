import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end tests over the exec seam of repo-state.mjs, driven by a fake `gh`
 * that shadows the real one on PATH and refuses any call it did not sign up for.
 *
 * Seams pinned here - most broke once in this repo's history; a couple are pinned only
 * in repoState.test.mjs and are named there:
 *   - the bare sha `gh --jq` prints must not be JSON.parsed
 *   - gh failing must print `unknown`, never `none`
 *   - the open query must stay `--state open` with `-L <cap>` adjacent, and the
 *     branch-scoped query must stay `--state all --search head:<the current branch>`
 *   - a saturated window prints `>=N`, not a count that reads as complete
 *   - merge-base exit 1 prints `no`, which is a different answer from `unknown`
 *   - ahead, behind-main, dirty and the branch name come from real git, and a failure
 *     to resolve any of them prints `unknown` instead of a confident value
 *   - a PR reported by both queries renders with the branch-scoped record winning,
 *     and the list is ordered by number
 * parseSha's guard and the exit-code *meaning* live in repoState.test.mjs.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', 'repo-state.mjs');
const IS_WINDOWS = process.platform === 'win32'; // the stub is a bash script
const itUnix = IS_WINDOWS ? it.skip : it;

// Strict about argv on purpose: an earlier stub read only $1, so `--state` and `-L`
// mutations survived; a later one matched "100" anywhere, so `-L` could go missing.
const GH_STUB = [
  '#!/usr/bin/env bash',
  'set -u',
  'if [ -n "${FAKE_GH_FAIL:-}" ]; then echo "gh: simulated failure" >&2; exit 1; fi',
  'if [ "$1" = "--version" ]; then echo "gh version fixture"; exit 0; fi',
  'pair() { local want="$1" prev="" a; for a in "${@:2}"; do if [ "$prev" = "$want" ]; then printf "%s" "$a"; return 0; fi; prev="$a"; done; return 1; }',
  'if [ "$1" = "api" ]; then',
  '  case "$2" in repos/acme/widget/git/ref/heads/main) printf "%s\\n" "$FAKE_GH_MAIN_SHA"; exit 0;; esac',
  '  echo "unexpected api path: $2" >&2; exit 42',
  'fi',
  'if [ "$1" = "pr" ]; then',
  '  found="$(pair "--search" "$@")" || found=""',
  '  if [ -n "$found" ]; then',
  '    case "$found" in "head:") echo "branch query sent an empty head value" >&2; exit 42;; head:*) ;; *) echo "branch query lost its head:<branch> form: $found" >&2; exit 42;; esac',
  '    if [ -n "${FAKE_GH_BRANCH:-}" ]; then',
  '      [ "$found" = "head:${FAKE_GH_BRANCH}" ] || { echo "branch query asked about the wrong branch: $found" >&2; exit 42; }',
  '    fi',
  '    [ "$(pair "--state" "$@")" = "all" ] || { echo "branch query is not --state all" >&2; exit 42; }',
  '    printf "%s\\n" "${FAKE_GH_MINE:-[]}"; exit 0',
  '  fi',
  '  [ "$(pair "--state" "$@")" = "open" ] || { echo "open query is not --state open" >&2; exit 42; }',
  '  [ "$(pair "-L" "$@")" = "100" ] || { echo "open query lost its -L 100 pair" >&2; exit 42; }',
  '  printf "%s\\n" "${FAKE_GH_OPEN:-[]}"; exit 0',
  'fi',
  'echo "unexpected gh call: $*" >&2',
  'exit 42',
  '',
].join('\n');

const OPEN_CAP = 100;

let root = '';
const repos = {};

/**
 * The developer's machine must not be able to break or bend a run: config files are
 * pinned, ambient git env is stripped, and the identity is fixed so a hostile
 * GIT_AUTHOR_NAME or GIT_COMMITTER_DATE cannot make the fixture's own commits fail.
 */
function gitEnv(extra = {}) {
  const env = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_PAGER: 'cat',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    ...extra,
  };
  for (const k of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_ALLOW_PROTOCOL',
    'GIT_CONFIG_COUNT',
  ]) {
    delete env[k];
  }
  return { ...process.env, ...env };
}

function gitAt(cwd) {
  // An empty or relative cwd silently means "wherever vitest happens to be running",
  // which once committed fixture files onto a real branch. Refuse it.
  if (!path.isAbsolute(cwd)) {
    throw new Error(
      `fixture git cwd must be absolute, got ${JSON.stringify(cwd)}`,
    );
  }
  return (args) =>
    execFileSync(
      'git',
      // hooksPath pinned locally so an injected core.hooksPath cannot point git at a
      // hook directory that does not exist here
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=.git/hooks',
        ...args,
      ],
      {
        cwd,
        encoding: 'utf8',
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
}

function run(cwd, extraEnv = {}) {
  if (!path.isAbsolute(cwd)) {
    throw new Error(`fixture cwd must be absolute, got ${JSON.stringify(cwd)}`);
  }
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: gitEnv({
        PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
        ...extraEnv,
      }),
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return {
      code: error.status,
      out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

const openList = (n, start = 1) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      number: start + i,
      state: 'OPEN',
      title: `pr ${start + i}`,
    })),
  );

/**
 * One place to build a repo, because four near-copies of this sequence is how a
 * hermeticity hole gets forgotten. `remoteRef` creates refs/remotes/origin/main
 * directly instead of pushing, so no transport protocol is involved at all.
 */
function makeRepo(name, { withOriginUrl = true } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const g = gitAt(dir);
  g(['init', '-q']);
  g(['config', 'user.email', 'fixture@example.com']);
  g(['config', 'user.name', 'fixture']);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), `${name}\n`);
  g(['add', 'tracked.txt']);
  g(['commit', '-q', '-m', 'base commit']);
  const head = g(['rev-parse', 'HEAD']).trim();
  const branch = g(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (withOriginUrl)
    g(['remote', 'add', 'origin', 'https://github.com/acme/widget.git']);
  g(['update-ref', 'refs/remotes/origin/main', head]);
  return { dir, head, branch, git: g };
}

beforeAll(() => {
  if (IS_WINDOWS) return;

  root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-state-fixture-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'gh'), GH_STUB, { mode: 0o755 });

  // a clone whose origin/main is an ancestor of HEAD: the happy path
  repos.main = makeRepo('main-line');
  // a commit that exists here but is not an ancestor of HEAD: merge-base answers "no"
  repos.side = makeRepo('side');
  const gm = repos.main.git;
  // bring the side commit's objects into the main clone under a real ref, so the
  // sha passes repo-state's `cat-file -e` guard and merge-base gets to answer "no"
  gm(['fetch', '-q', path.join(root, 'side'), 'HEAD:refs/remotes/side/head']);

  const noOrigin = makeRepo('no-origin', { withOriginUrl: false });
  repos.noOrigin = { ...noOrigin, git: undefined };

  const unborn = makeRepo('unborn');
  unborn.git(['checkout', '-q', '--orphan', 'ghost']);
  repos.unborn = { ...unborn, git: undefined };

  const broken = makeRepo('broken');
  broken.git([
    'worktree',
    'add',
    '-q',
    path.join(root, 'gone-dir'),
    '-b',
    'gone-dir',
  ]);
  fs.rmSync(path.join(root, 'gone-dir'), { recursive: true, force: true });
  repos.broken = { ...broken, git: undefined };

  for (const { dir } of Object.values(repos)) {
    if (!dir.startsWith(root)) {
      throw new Error(`fixture escaped the temp dir: ${dir}`);
    }
  }
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('repo-state against a strict fake gh', () => {
  itUnix(
    'accepts the bare sha --jq prints, as the authoritative pointer',
    () => {
      const { code, out } = run(repos.main.dir, {
        FAKE_GH_MAIN_SHA: repos.main.head,
        FAKE_GH_OPEN: '[]',
        FAKE_GH_BRANCH: repos.main.branch,
      });
      expect(code).toBe(0);
      // the sha arrives as a bare value, not JSON; a JSON.parse here silently downgrades
      // every run to the local ref, which is what happened the first time
      expect(out).toMatch(
        new RegExp(
          `main\\s+= ${repos.main.head.slice(0, 7)} \\(git/ref/heads/main\\)`,
        ),
      );
      expect(out).toContain('main merged in  = yes');
      expect(out).not.toContain('[main is a local ref here');
      expect(out).toContain('open PRs: none');
    },
  );

  itUnix('reports the real branch name, not a fallback', () => {
    const { out } = run(repos.main.dir, {
      FAKE_GH_MAIN_SHA: repos.main.head,
      FAKE_GH_OPEN: '[]',
      FAKE_GH_BRANCH: repos.main.branch,
    });
    // kills hard-coding `branch = unknown`, which the unborn case alone would not catch
    expect(out).toMatch(new RegExp(`branch\\s+= ${repos.main.branch} dirty=`));
  });

  itUnix('refuses to guess when gh is not answering', () => {
    const { code, out } = run(repos.main.dir, { FAKE_GH_FAIL: '1' });
    expect(code).toBe(0);
    expect(out).toContain('gh could not answer');
    expect(out).toContain('main merged in  = yes [main is a local ref here');
    expect(out).toContain('open PRs: unknown (gh could not answer)');
  });

  itUnix('asks about the current branch, not some other one', () => {
    // the stub only answers head:<this branch>, so a collector that sends a fixed or
    // empty value gets an error and prints unknown instead of a plausible list
    const wrong = run(repos.broken.dir, {
      FAKE_GH_MAIN_SHA: repos.broken.head,
      FAKE_GH_OPEN: '[]',
      FAKE_GH_MINE: JSON.stringify([
        {
          number: 7,
          state: 'MERGED',
          mergedAt: 'x',
          headRefName: 'other',
          title: 't',
        },
      ]),
      FAKE_GH_BRANCH: 'a-different-branch',
    });
    expect(wrong.out).toContain('open PRs: unknown (gh could not answer)');
  });

  itUnix(
    'says the window is full instead of implying a complete open list',
    () => {
      const { out } = run(repos.main.dir, {
        FAKE_GH_MAIN_SHA: repos.main.head,
        FAKE_GH_OPEN: openList(OPEN_CAP),
        FAKE_GH_BRANCH: repos.main.branch,
      });
      expect(out).toContain(
        `open PRs (>=${OPEN_CAP}, window full) (${OPEN_CAP}):`,
      );
      expect(out).toContain(`#${OPEN_CAP} OPEN pr ${OPEN_CAP}`);
    },
  );

  itUnix('renders this branch own merged PR, absent from the open list', () => {
    const { out } = run(repos.main.dir, {
      FAKE_GH_MAIN_SHA: repos.main.head,
      FAKE_GH_OPEN: '[]',
      FAKE_GH_BRANCH: repos.main.branch,
      FAKE_GH_MINE: JSON.stringify([
        {
          number: 7,
          state: 'MERGED',
          mergedAt: '2026-10-12T07:18:32Z',
          headRefName: repos.main.branch,
          title: 'chore: x',
        },
      ]),
    });
    expect(out).toContain('#7 MERGED 2026-10-12T07:18:32Z');
    expect(out).toContain('PRs (1):');
  });

  itUnix(
    'lets the branch-scoped record win when both queries report one PR',
    () => {
      const { out } = run(repos.main.dir, {
        FAKE_GH_MAIN_SHA: repos.main.head,
        FAKE_GH_OPEN: JSON.stringify([
          { number: 9, state: 'OPEN', title: 'stale open view' },
        ]),
        FAKE_GH_BRANCH: repos.main.branch,
        FAKE_GH_MINE: JSON.stringify([
          {
            number: 9,
            state: 'MERGED',
            mergedAt: '2026-10-12T09:00:00Z',
            headRefName: repos.main.branch,
            title: 'chore: y',
          },
        ]),
      });
      expect(out).toContain('#9 MERGED 2026-10-12T09:00:00Z chore: y');
      expect(out).not.toContain('stale open view');
    },
  );

  itUnix('lists PRs by number even when gh returns them shuffled', () => {
    const { out } = run(repos.main.dir, {
      FAKE_GH_MAIN_SHA: repos.main.head,
      FAKE_GH_OPEN: JSON.stringify([
        { number: 12, state: 'OPEN', title: 'later' },
        { number: 3, state: 'OPEN', title: 'earlier' },
      ]),
      FAKE_GH_BRANCH: repos.main.branch,
    });
    expect(out.indexOf('#3 OPEN earlier')).toBeGreaterThan(-1);
    expect(out.indexOf('#3 OPEN earlier')).toBeLessThan(
      out.indexOf('#12 OPEN later'),
    );
  });

  itUnix('prints no, not unknown, when merge-base really answers no', () => {
    // FETCH_HEAD is an object in this clone, so the sha passes the cat-file guard and
    // merge-base gets to answer "no" with exit 1
    const { out } = run(repos.main.dir, {
      FAKE_GH_MAIN_SHA: repos.side.head,
      FAKE_GH_OPEN: '[]',
      FAKE_GH_BRANCH: repos.main.branch,
    });
    expect(out).toContain('(git/ref/heads/main)');
    expect(out).toContain('main merged in  = no');
  });

  itUnix('names not-fetched-here, and still flags main as a local ref', () => {
    const missing = 'deadbeef'.padEnd(40, '0');
    const { out } = run(repos.main.dir, {
      FAKE_GH_MAIN_SHA: missing,
      FAKE_GH_OPEN: '[]',
      FAKE_GH_BRANCH: repos.main.branch,
    });
    expect(out).toContain('authoritative sha not fetched here');
    expect(out).toContain('[main is a local ref here');
    expect(out).toMatch(/main merged in\s+= (yes|no)/);
  });

  itUnix('says so when there is no origin remote to ask', () => {
    const { code, out } = run(repos.noOrigin.dir, {
      FAKE_GH_MAIN_SHA: repos.noOrigin.head,
      FAKE_GH_OPEN: '[]',
    });
    expect(out).toContain('no origin remote here');
    expect(out).toContain('[main is a local ref here');
    expect(out).not.toContain('(git/ref/heads/main)');
    expect(code).toBe(0);
  });

  itUnix(
    'answers unknown, never a number, when the revs cannot be resolved',
    () => {
      // kills the `catch { ahead = 0 }` and `catch { mainMergedIn = false }` reflexes
      const { out } = run(repos.unborn.dir, {
        FAKE_GH_MAIN_SHA: repos.unborn.head,
        FAKE_GH_OPEN: '[]',
      });
      expect(out).toContain('ahead=unknown');
      expect(out).toContain('main merged in  = unknown');
    },
  );

  itUnix('answers unknown for a worktree whose directory is gone', () => {
    // kills `catch { behindMain = 0 }`, which would read as "perfectly up to date"
    const { out } = run(repos.broken.dir, {
      FAKE_GH_MAIN_SHA: repos.broken.head,
      FAKE_GH_OPEN: '[]',
    });
    expect(out).toContain('behind-main=unknown');
  });

  itUnix('counts a dirty tree as dirty', () => {
    const dirty = path.join(repos.broken.dir, 'dirty.txt');
    fs.writeFileSync(dirty, 'd\n');
    const { out } = run(repos.broken.dir, {
      FAKE_GH_MAIN_SHA: repos.broken.head,
      FAKE_GH_OPEN: '[]',
    });
    fs.rmSync(dirty);
    expect(out).toContain('dirty=1');
  });

  itUnix('counts ahead with real git arithmetic', () => {
    const g = gitAt(repos.main.dir);
    g(['checkout', '-q', '-b', 'ahead-case']);
    fs.writeFileSync(path.join(repos.main.dir, 'more.txt'), 'y\n');
    g(['add', 'more.txt']);
    g(['commit', '-q', '-m', 'ahead commit']);
    const { out } = run(repos.main.dir, {
      FAKE_GH_MAIN_SHA: repos.main.head,
      FAKE_GH_OPEN: '[]',
      FAKE_GH_BRANCH: 'ahead-case',
    });
    expect(out).toMatch(/ahead=1\b/);
    expect(out).toContain('behind-main=0');
  });
});

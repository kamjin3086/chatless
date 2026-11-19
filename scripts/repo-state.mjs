/**
 * One read-only answer to "what is the actual state here".
 *
 * This repo had two incidents that came from reading human-oriented tool output
 * as a fact: `gh pr view` printing MERGEABLE and being read as MERGED, and a
 * `git merge` typed without a rev quietly merging the branch's own upstream and
 * printing "Already up to date". Both questions - where is main, and is my work
 * on it - are machine-checkable, so they get a command instead of an opinion.
 *
 * The one sin this tool must never commit is printing an absence it did not prove.
 * Every value it cannot establish prints `unknown`, and every fallback names the
 * cause that was actually observed, never a guessed one.
 *
 * Usage: pnpm repo:state
 * Exit code is 0 unless the tool itself cannot run. It reports what it read; the one
 * verdict it repeats is the commit-title gate's, printed as that gate's own wording,
 * because the gate otherwise judges a push only after it happened.
 */
import { execFileSync } from 'node:child_process';
import { checkPrTitle } from './check-pr-title.mjs';

const PR_WINDOW = 100;

/** @param {string} porcelain output of `git worktree list --porcelain` */
export function parseWorktrees(porcelain) {
  const rows = [];
  let current = null;
  for (const line of `${porcelain}\n`.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) rows.push(current);
      current = {
        path: line.slice('worktree '.length),
        branch: null,
        head: '',
      };
    } else if (line.startsWith('HEAD ') && current) {
      // Full sha: callers count ancestry with it. Abbreviate only when printing.
      current.head = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch refs/heads/') && current) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === '' && current) {
      rows.push(current);
      current = null;
    }
  }
  return current ? [...rows, current] : rows;
}

/**
 * `git merge-base --is-ancestor` answers with an exit code: 1 means "definitely not
 * an ancestor", anything else (bad rev, 128) is not an answer. Reading both as "no"
 * is how a stale pointer turns into a false green.
 * @param {number|undefined} status @returns {boolean|null}
 */
export function mergedInFromError(status) {
  return status === 1 ? false : null;
}

/**
 * @param {{main: {shortSha: string, source: string, sourceKind: string}, branch: string,
 *   dirty: number, ahead: number|null, mainMergedIn: boolean|null, worktrees: Array<object>,
 *   prs: Array<object>, prsAvailable: boolean, prsWindowFull?: boolean, prsCap?: number}} state
 * @returns {string}
 */
export function formatState(state) {
  const mergedIn =
    state.mainMergedIn === null
      ? 'unknown (git merge-base could not resolve the revs)'
      : state.mainMergedIn
        ? 'yes'
        : 'no';
  // Provenance is a field, not a substring of prose: rewording a message must not
  // silently flip how much the reader is allowed to trust it.
  const staleNote =
    state.main.sourceKind === 'authoritative'
      ? ''
      : ' [main is a local ref here: fetch or use gh before trusting this]';
  const lines = [
    `main            = ${state.main.shortSha} (${state.main.source})`,
    `branch          = ${state.branch} dirty=${state.dirty} ahead=${state.ahead ?? 'unknown'}`,
    `main merged in  = ${mergedIn}${staleNote}`,
  ];

  lines.push('worktrees:');
  for (const wt of state.worktrees) {
    const branch = wt.branch ?? 'detached';
    const behind =
      wt.behindMain === null || wt.behindMain === undefined
        ? ' behind-main=unknown'
        : ` behind-main=${wt.behindMain}` +
          // The number is not trivia: a `git reset --soft origin/main` here quietly stages
          // the reversal of those commits, and the only thing that ever caught it this week
          // was a pre-commit typecheck failing on a deleted function.
          (Number(wt.behindMain) > 0
            ? ` (a soft reset here reverts ${wt.behindMain})`
            : '');
    lines.push(
      `  ${wt.path} ${branch} ${String(wt.head).slice(0, 7)}${behind}`,
    );
  }

  const cap = state.prsCap ?? PR_WINDOW;
  if (state.prsAvailable !== true) {
    lines.push('open PRs: unknown (gh could not answer)');
  } else if (state.prs.length === 0) {
    lines.push('open PRs: none');
  } else {
    const allOpen = state.prs.every((pr) => pr.state === 'OPEN');
    const head = allOpen ? 'open PRs' : 'PRs';
    const window = state.prsWindowFull ? ` (>=${cap}, window full)` : '';
    lines.push(`${head}${window} (${state.prs.length}):`);
    for (const pr of state.prs) {
      lines.push(
        `#${pr.number} ${pr.state}${pr.mergedAt ? ` ${pr.mergedAt}` : ''} ${pr.title}`,
      );
      // The title gate runs in CI, which means a bad title is discovered after the
      // push - and its workflow has no `edited` trigger, so a retitle alone does not
      // clear the red check. The title is already here; say so before the push.
      if (pr.state === 'OPEN') {
        const [problem] = checkPrTitle(pr.title);
        if (problem) lines.push(`  title gate: ${problem}`);
      }
    }
  }
  return lines.join('\n');
}

function git(args, cwd) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd,
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** Run git, answering `fallback` where this repository simply has no answer. */
function tryGit(args, fallback) {
  try {
    return git(args);
  } catch {
    return fallback;
  }
}

function ghJson(args) {
  return JSON.parse(
    execFileSync('gh', args, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
}

/**
 * `gh --jq` prints the extracted value, not JSON, so this path must not JSON.parse
 * it. Parsing `.object.sha` as JSON threw every single time and silently downgraded
 * the tool to the local ref while gh was working fine - a tool that reports state
 * must not misreport its own provenance.
 * @param {string[]} args
 */
function ghText(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * @param {string} text @returns {string} a 40-character sha, else throws instead of
 * handing back a value the caller would mistake for a real pointer.
 */
export function parseSha(text) {
  const sha = String(text).trim().replace(/^"|"$/g, '');
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `not a commit sha: ${JSON.stringify(String(text).slice(0, 40))}`,
    );
  }
  return sha;
}

function ghAvailable() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The local fallback, with the reason actually observed. "gh unavailable" would be
 * a guess in three of these four cases: gh is installed but unauthenticated, gh is
 * rate limited, or the remote url is not a github repo this command can query.
 * @param {string} reason
 */
function localMainRef(reason) {
  return {
    sha: git(['rev-parse', 'origin/main']),
    source: `origin/main local ref (${reason})`,
    sourceKind: 'local',
  };
}

function resolveMain(hasGh) {
  if (!hasGh) return localMainRef('gh not installed');

  let match;
  try {
    match = git(['remote', 'get-url', 'origin']).match(
      /([^/]+)\/([^/.]+)(\.git)?$/,
    );
  } catch {
    return localMainRef('no origin remote here');
  }
  if (!match) return localMainRef('origin is not a github owner/repo url');

  let sha;
  try {
    sha = parseSha(
      ghText([
        'api',
        `repos/${match[1]}/${match[2]}/git/ref/heads/main`,
        '--jq',
        '.object.sha',
      ]),
    );
  } catch {
    return localMainRef(
      'gh could not answer: not authenticated, rate limited, or offline',
    );
  }

  // The authoritative sha is only usable if this clone has the object; a merge that
  // landed on GitHub is not in the local object DB until someone fetches.
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    return localMainRef('authoritative sha not fetched here');
  }
  return { sha, source: 'git/ref/heads/main', sourceKind: 'authoritative' };
}

function resolvePrs(hasGh, branch) {
  if (!hasGh) return { prs: [], prsAvailable: false, prsWindowFull: false };
  try {
    // Two queries on purpose. The open list answers "what is open"; the head: query
    // answers "what happened to my branch's PR" - a single newest-N list of all
    // states would age that answer out of the window and print "none".
    const open = ghJson([
      'pr',
      'list',
      '--state',
      'open',
      '-L',
      String(PR_WINDOW),
      '--json',
      'number,state,title',
    ]);
    const mine = ghJson([
      'pr',
      'list',
      '--search',
      `head:${branch}`,
      '--state',
      'all',
      '--json',
      'number,state,title,mergedAt,headRefName',
    ]);
    const byNumber = new Map();
    for (const pr of [...open, ...mine]) {
      byNumber.set(pr.number, { ...byNumber.get(pr.number), ...pr });
    }
    return {
      prs: [...byNumber.values()].sort((a, b) => a.number - b.number),
      prsAvailable: true,
      prsWindowFull: open.length >= PR_WINDOW,
    };
  } catch {
    return { prs: [], prsAvailable: false, prsWindowFull: false };
  }
}

function collect() {
  const hasGh = ghAvailable();
  const main = resolveMain(hasGh);
  const mainSha = main.sha;
  const short = (sha) => String(sha).slice(0, 7);

  const worktrees = parseWorktrees(
    git(['worktree', 'list', '--porcelain']),
  ).map((wt) => {
    let behindMain = null;
    try {
      behindMain = Number(
        git(['rev-list', '--count', `${wt.head}..${mainSha}`], wt.path),
      );
    } catch {
      behindMain = null;
    }
    return { ...wt, behindMain };
  });

  // An unborn HEAD (fresh init, --orphan) makes `rev-parse --abbrev-ref HEAD` exit 128,
  // which used to take the whole report down. A branch name is usually still available,
  // and everything that genuinely cannot be known prints unknown instead.
  const branch =
    tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], '') ||
    tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], '') ||
    'unknown';
  let mainMergedIn;
  try {
    git(['merge-base', '--is-ancestor', mainSha, 'HEAD']);
    mainMergedIn = true;
  } catch (error) {
    mainMergedIn = mergedInFromError(error && error.status);
  }

  let ahead = null;
  try {
    ahead = Number(git(['rev-list', '--count', `${mainSha}..HEAD`]));
  } catch {
    ahead = null;
  }

  return {
    main: {
      shortSha: short(mainSha),
      source: main.source,
      sourceKind: main.sourceKind,
    },
    branch,
    dirty: git(['status', '--porcelain']).split('\n').filter(Boolean).length,
    ahead,
    mainMergedIn,
    worktrees,
    prsCap: PR_WINDOW,
    ...resolvePrs(hasGh, branch),
  };
}

if (process.argv[1] && process.argv[1].endsWith('repo-state.mjs')) {
  try {
    console.log(formatState(collect()));
  } catch (error) {
    console.error(
      `repo-state: cannot read state (${error instanceof Error ? error.message.split('\n')[0] : error})`,
    );
    process.exit(1);
  }
}

#!/usr/bin/env node
/**
 * Read what CI actually executed, without re-deriving the gh incantation each time.
 *
 * `gh run view --log` is the only evidence that a test really ran on the runner, but
 * its lines arrive as `job \t step \t 2026-...Z <ansi>text`, so every session ends up
 * hand-piping the same `sed | sed | grep | sort -u` - and a first attempt that matches
 * nothing looks identical to "the tests did not run". This is that pipeline, with the
 * filters named.
 *
 * Usage:
 *   pnpm ci:log 94                 # latest run for PR #94's head
 *   pnpm ci:log --job 114700150772
 *   pnpm ci:log 94 --grep cargo    # keep lines containing this substring
 *   pnpm ci:log 94 --all           # clean but unfiltered
 */
import { execFileSync } from 'node:child_process';

// gh's log export emits colour codes as the caret notation "^[[32m" (literal caret and
// bracket), not a real ESC byte, so both spellings have to go.
const ANSI = /\u001b\[[0-9;]*m|\^\[\[[0-9;]*m/g;
/**
 * Named keep-rules, so "which failure classes survive this filter" is answered by the
 * table instead of by squinting at one regex. Two real mistakes sit behind it: a first
 * version matched bare `error` (Rust crates poured in) and missed `error TS2345`,
 * `Failed to compile.` and a failed summary (a red typecheck printed "nothing
 * matched"); a second version still swallowed unhandled rejections, next build errors,
 * biome counts and vitest's indented detail lines, so a red job looked green.
 * Everything here is a *view*: `--all` is the raw log and is always the safer answer.
 */
const KEEP_RULES = [
  { label: 'test result lines', re: /^\s*(✓|✗|×|↓|✖)\s/ },
  {
    label: 'test summary',
    re: /Test Files|Tests\s+\d+.*\b(failed|passed)\b|Errors\s+\d+ error/,
  },
  {
    label: 'vitest failure header',
    re: /\bFAIL\b|Unhandled (Errors|Rejection)/,
  },
  {
    label: 'thrown error',
    re: /\b(?:TypeError|ReferenceError|RangeError|SyntaxError|AggregateError|Error): /,
  },
  { label: 'typescript', re: /error TS\d|Failed to compile/ },
  { label: 'rust', re: /error\[|error: |test result: FAILED/ },
  {
    label: 'eslint and biome',
    re: /problems \(\d+ error|Found \d+ error|No ESLint/,
  },
  { label: 'coverage threshold', re: /coverage threshold|ERROR.*[Cc]overage/i },
  {
    label: 'next build',
    re: /Build failed|Failed to collect page data|Compiled successfully|Generating static|Exporting/,
  },
  { label: 'pr title gate', re: /check-pr-title|retitle the PR/ },
  { label: 'npm failure', re: /ELIFECYCLE|npm error/ },
];

/** @param {string} text @returns {string|null} the keep-rule label, or null */
export function keepRuleFor(text) {
  for (const rule of KEEP_RULES) if (rule.re.test(text)) return rule.label;
  return null;
}

/**
 * @param {string} text
 * @param {string} [grepFor] free-text keep, the `--grep` escape hatch
 * @returns {boolean}
 */
export function isRelevant(text, grepFor) {
  if (grepFor && text.includes(grepFor)) return true;
  return keepRuleFor(text) !== null;
}

/**
 * @param {string} raw
 * @param {string} [grepFor] @returns {string[]}
 */
export function selectRelevant(raw, grepFor) {
  const seen = new Set();
  const out = [];
  let kept = false;
  for (const line of String(raw).split('\n')) {
    const clean = cleanLogLine(line);
    if (!clean) continue;
    // a failed check puts its reason on the following indented line; dropping those is
    // how `✖ title is too long` survived while `  - 84 characters, keep it under 80`
    // did not
    const continuation = kept && /^\s{2,}\S/.test(logFragment(line));
    if (!continuation && !isRelevant(clean, grepFor)) {
      kept = false;
      continue;
    }
    kept = true;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/** @param {string} line @returns {string} */
export function cleanLogLine(line) {
  return logFragment(line).trim();
}

/**
 * Strip gh's `job \t step \t stamp ` prefix and vitest's \r rewrites, keeping the
 * leading indentation, which is where a failure detail announces itself.
 * @param {string} line @returns {string}
 */
function logFragment(line) {
  const last = String(line).split('\t').pop() ?? '';
  // the stamp is removed without its trailing spaces: indentation is what marks a
  // line as the detail belonging to the failure above it
  const noStamp = last.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z/, '');
  const fragment = noStamp.split('\r').filter(Boolean).pop() ?? noStamp;
  return fragment.replace(ANSI, '');
}

/** @param {string} raw @param {string} [grepFor] @returns {string[]} */

/**
 * What a board of check-runs says about a commit, without the log export.
 *
 * `gh pr checks` and this script's log path both ride GraphQL, and GraphQL is the first
 * channel to die on this network - which left a merge decision with nothing to read. The REST
 * check-runs endpoint kept answering, so the verdict gets built here. An empty board is
 * called out on purpose: twice a pull request had no run at all, because Actions never
 * received the event, and "no rows" reads like "still queued" to whoever is waiting.
 */
export function summariseCheckRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  if (!list.length) {
    return {
      registered: false,
      // Not "still running": a board with no rows and a board still filling up are different
      // answers, and the second one is the only one worth waiting on.
      settled: false,
      pass: false,
      failed: [],
      pending: [],
      note: 'no workflow run is registered for this commit. That is not the paths filter skipping a build - Actions never took the event. Push again (any commit, or --force-with-lease) to re-trigger it.',
    };
  }
  // Anything that is not success, skip or neutral is a red board, whatever it is called:
  // a cancelled or action-required run is exactly the thing a merge should not walk past.
  const OK = new Set(['success', 'skipped', 'neutral']);
  const failed = list
    .filter((r) => r.status === 'completed' && !OK.has(r.conclusion))
    .map((r) => r.name);
  const pending = list
    .filter((r) => r.status !== 'completed')
    .map((r) => r.name);
  return {
    registered: true,
    settled: pending.length === 0,
    pass: pending.length === 0 && failed.length === 0,
    failed,
    pending,
    note: list
      .map(
        (r) =>
          `${r.name}=${r.status}${r.conclusion && r.conclusion !== 'neutral' ? `/${r.conclusion}` : ''}`,
      )
      .join(' '),
  };
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * `--job <id>` and `--grep <text>` take a value; `--all` does not; anything else is
 * positional (the PR number). Hand-rolled index arithmetic here once swallowed the
 * PR number whenever neither flag was present.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const flags = { '--all': 0, '--grep': 1, '--job': 1, '--checks': 1 };
  const skip = new Set();
  for (const [flag, arity] of Object.entries(flags)) {
    const at = argv.indexOf(flag);
    if (at < 0) continue;
    skip.add(at);
    for (let i = 1; i <= arity; i += 1) skip.add(at + i);
  }
  const grepAt = argv.indexOf('--grep');
  const jobAt = argv.indexOf('--job');
  const checksAt = argv.indexOf('--checks');
  return {
    all: argv.includes('--all'),
    extra: grepAt >= 0 ? argv[grepAt + 1] : undefined,
    job: jobAt >= 0 ? argv[jobAt + 1] : undefined,
    checks: checksAt >= 0 ? argv[checksAt + 1] : undefined,
    positional: argv.filter(
      (a, i) => !skip.has(i) && !Object.keys(flags).includes(a),
    ),
  };
}

if (process.argv[1] && process.argv[1].endsWith('ci-log.mjs')) {
  const cli = parseArgs(process.argv.slice(2));
  const { all, extra, positional, job } = cli;

  try {
    let raw;
    if (cli.checks) {
      // A PR number or a commit sha; the REST path is chosen over `gh pr checks` because the
      // latter needs GraphQL, which is the part that fails when this script is useful.
      const target = cli.checks;
      const isSha = /^[0-9a-f]{7,40}$/i.test(target);
      const sha = isSha
        ? target
        : gh([
            'api',
            'repos/{owner}/{repo}/pulls/' + target,
            '--jq',
            '.head.sha',
          ]).trim();
      const board = gh([
        'api',
        `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`,
        '--jq',
        '.check_runs[] | [.name, .status, .conclusion // ""] | @tsv',
      ]);
      const runs = board
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, status, conclusion] = line.split('\t');
          return { name, status, conclusion: conclusion || null };
        });
      const verdict = summariseCheckRuns(runs);
      console.log(`${isSha ? sha : `PR ${target}`} @ ${sha.slice(0, 7)}`);
      console.log(verdict.note);
      if (verdict.registered) {
        console.log(
          verdict.pass
            ? 'verdict: green'
            : verdict.settled
              ? `verdict: not green (${verdict.failed.join(', ') || 'not all passing'})`
              : `verdict: still running (${verdict.pending.join(', ')})`,
        );
      }
      process.exit(
        verdict.pass ? 0 : verdict.registered ? (verdict.settled ? 1 : 3) : 4,
      );
    }
    if (job) {
      raw = gh(['run', 'view', '--job', job, '--log']);
    } else if (positional[0]) {
      const head = gh([
        'pr',
        'view',
        positional[0],
        '--json',
        'headRefName',
        '--jq',
        '.headRefName',
      ]).trim();
      const runId = gh([
        'run',
        'list',
        '--branch',
        head,
        '--limit',
        '1',
        '--json',
        'databaseId',
        '--jq',
        '.[0].databaseId',
      ]).trim();
      if (!runId) throw new Error(`no workflow run found for ${head}`);
      raw = gh(['run', 'view', runId, '--log']);
    } else {
      console.error(
        'usage: ci-log <pr-number> | --job <jobId> [--grep text] [--all] | --checks <pr|sha>',
      );
      process.exit(2);
    }

    const lines = all
      ? raw.split('\n').map(cleanLogLine).filter(Boolean)
      : selectRelevant(raw, extra);
    if (lines.length === 0) {
      console.log(
        'ci-log: nothing matched. The run produced no output for this filter - `--all` shows everything.',
      );
      process.exit(0);
    }
    console.log(lines.join('\n'));
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stderr ?? error.message) : error;
    console.error(`ci-log: ${String(detail).split('\n')[0]}`);
    process.exit(1);
  }
}

/**
 * Gate: a pull request title has to be Conventional Commits shaped and ASCII.
 *
 * Commits in this repository have always been English (579 commits, no Chinese
 * subject), but PR titles drifted, because nothing checked them. See
 * docs/agents/language.md (tier 2): the PR is the maintainer-side record, so the
 * title carries the language rule. Anyone with write access can retitle a PR, so
 * this is a one-line correction for an honest contributor, not a rejection.
 *
 * Usage:
 *   node scripts/check-pr-title.mjs "<title>"
 *   PR_TITLE="..." node scripts/check-pr-title.mjs
 * With no title argument outside GitHub Actions it resolves the open PR for this
 * branch through `gh`, and skips quietly when there is none.
 */
import { execFileSync } from 'node:child_process';

const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];
const SUBJECT_LIMIT = 80;

const TITLE_PATTERN = new RegExp(
  `^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9./-]*\\))?!?: \\S`,
);

/** @param {string} title @returns {string[]} problems, empty when the title passes */
export function checkPrTitle(title) {
  const problems = [];
  if (typeof title !== 'string' || title.trim() === '') {
    return ['title is empty'];
  }
  const value = title.trim();

  if (!TITLE_PATTERN.test(value)) {
    problems.push(
      `expected "type(scope): description" or "type: description", one of: ${TYPES.join(', ')}`,
    );
  }
  // Printable ASCII only. Chinese text is what this gate actually catches; other
  // scripts are rejected with the same rule so the record stays greppable.
  if (/[^\x20-\x7e]/.test(value)) {
    problems.push(
      'title must be ASCII (English); restate the description in English',
    );
  }
  if (value.length > SUBJECT_LIMIT) {
    problems.push(
      `title is ${value.length} characters, keep it under ${SUBJECT_LIMIT}`,
    );
  }
  return problems;
}

function resolveTitleFromEnv() {
  return process.env.PR_TITLE || process.env.GH_PR_TITLE || '';
}

function resolveTitleFromGh() {
  try {
    // `gh pr view` without arguments happily returns some other PR when the
    // current branch has none, so only trust it when the head branch matches.
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const line = execFileSync(
      'gh',
      [
        'pr',
        'view',
        '--json',
        'headRefName,title',
        '-q',
        '[.headRefName, .title] | @tsv',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    const [headRef, title] = line.split('\t');
    return headRef === branch ? title : '';
  } catch {
    return '';
  }
}

if (process.argv[1] && process.argv[1].endsWith('check-pr-title.mjs')) {
  const argTitle = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('-'))
    .join(' ');
  const title = argTitle || resolveTitleFromEnv() || resolveTitleFromGh();

  if (!title) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.error(
        'check-pr-title: no title available (wire PR_TITLE from github.event.pull_request.title)',
      );
      process.exit(1);
    }
    console.log('check-pr-title: skipped, no PR title for this branch');
    process.exit(0);
  }

  const problems = checkPrTitle(title);
  if (problems.length === 0) {
    console.log(`check-pr-title: ok - ${title}`);
    process.exit(0);
  }

  console.error(`check-pr-title: "${title}"\n  - ${problems.join('\n  - ')}`);
  console.error(
    '  Fix: retitle the PR (gh pr edit <n> --title "..."), see docs/agents/language.md',
  );
  process.exit(1);
}

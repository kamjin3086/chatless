import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// A detached, local-only reviewer checkout. Read the worktree through a private
// index so we never stage, stash or switch the operator's checkout.
export function createReviewSnapshot({
  cwd,
  base,
  destination,
  includeUntracked = false,
}) {
  const git = (args, options = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
  const pin = (ref) =>
    git([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${ref}^{commit}`,
    ]).trim();
  const baseline = pin(base);
  const head = pin('HEAD');
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const path = resolve(cwd, destination);
  if (
    path === root ||
    path.startsWith(`${root}/`) ||
    path.startsWith(`${root}\\`)
  ) {
    throw new Error('Choose a review worktree outside the source checkout');
  }
  git(['merge-base', baseline, head]);
  const staged = git(['write-tree']).trim();
  const scratch = mkdtempSync(join(tmpdir(), 'chatless-review-index-'));
  try {
    const options = {
      env: { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') },
    };
    git(['read-tree', staged], options);
    if (
      !includeUntracked &&
      git(['ls-files', '--others', '--exclude-standard', '-z'], options)
    ) {
      throw new Error(
        'Untracked files exist. Inspect git status before adding --include-untracked.',
      );
    }
    git(['add', includeUntracked ? '-A' : '-u', '--', ':/'], options);
    const tree = git(['write-tree'], options).trim();
    const snapshot = git([
      '-c',
      'user.name=Local Review Snapshot',
      '-c',
      'user.email=local-review@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit-tree',
      tree,
      '-p',
      head,
      '-m',
      'chore: capture local review snapshot',
    ]).trim();
    if (!git(['diff', '--name-only', `${baseline}...${snapshot}`]).trim())
      throw new Error('No changes against the review baseline');
    git(['worktree', 'add', '--detach', '--', path, snapshot]);
    return { path, baseline, snapshot };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('/review-snapshot.mjs')) {
  try {
    const [base, destination, ...extra] = process.argv.slice(2);
    if (
      !base ||
      !destination ||
      (extra.length && extra.join(' ') !== '--include-untracked')
    ) {
      throw new Error(
        'Usage: pnpm review:snapshot <base> <new-worktree-path> [--include-untracked]',
      );
    }
    console.log(
      JSON.stringify(
        createReviewSnapshot({
          cwd: process.cwd(),
          base,
          destination,
          includeUntracked: extra.length === 1,
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

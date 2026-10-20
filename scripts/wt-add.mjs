/**
 * Create a worktree you can actually run tests in.
 *
 * The hand-written version of this bit me once: `ln -s ../chatless/node_modules`
 * is fine next to the checkout and silently wrong under /tmp, where it produces
 * "Cannot find package 'vitest'" from the config loader instead of "your symlink
 * is a lie". This resolves everything to absolute paths before touching git.
 *
 * Usage:
 *   pnpm wt:add ../wt-topic -b feat/topic
 *   pnpm wt:add /tmp/wt-check --ref origin/main --dry-run
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{repoRoot: string, path: string, ref?: string, branch?: string}} input
 * @returns {{absPath: string, gitArgs: string[], link: {from: string, to: string}}}
 */
export function planWorktreeAdd({
  repoRoot,
  path: target,
  ref = 'origin/main',
  branch,
}) {
  if (!path.isAbsolute(repoRoot)) {
    throw new Error(
      `repoRoot must be absolute, got "${repoRoot}": a relative link target breaks in the new worktree`,
    );
  }
  const absPath = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(repoRoot, target);
  if (absPath === repoRoot || absPath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(
      `refusing to nest a worktree inside the checkout (${absPath} is under ${repoRoot}); name it as a sibling, e.g. ../${path.basename(absPath)}`,
    );
  }
  return {
    absPath,
    gitArgs: [
      'worktree',
      'add',
      ...(branch ? ['-b', branch] : []),
      absPath,
      ref,
    ],
    link: {
      from: path.join(absPath, 'node_modules'),
      to: path.join(repoRoot, 'node_modules'),
    },
  };
}

function parseArgs(argv) {
  const args = { dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-b' || arg === '--branch') args.branch = argv[++i];
    else if (arg === '--ref') args.ref = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else positional.push(arg);
  }
  args.path = positional[0];
  return args;
}

if (process.argv[1] && process.argv[1].endsWith('wt-add.mjs')) {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.path) {
    console.error('usage: wt-add <path> [-b branch] [--ref ref] [--dry-run]');
    process.exit(2);
  }
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  let plan;
  try {
    plan = planWorktreeAdd({
      repoRoot,
      path: cli.path,
      ref: cli.ref,
      branch: cli.branch,
    });
  } catch (error) {
    console.error(`wt-add: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (cli.dryRun) {
    console.log(`git ${plan.gitArgs.join(' ')}`);
    console.log(`ln -s ${plan.link.to} ${plan.link.from}`);
    process.exit(0);
  }

  try {
    execFileSync('git', plan.gitArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      timeout: 60000,
    });
  } catch {
    process.exit(1); // git already said why, stdio is inherited
  }

  try {
    if (fs.existsSync(plan.link.to) && !fs.existsSync(plan.link.from)) {
      // "junction" needs no elevated privileges on Windows, "dir" does.
      fs.symlinkSync(
        plan.link.to,
        plan.link.from,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      console.log(`linked ${plan.link.from} -> ${plan.link.to}`);
    } else if (!fs.existsSync(plan.link.to)) {
      console.log(
        `no node_modules at ${plan.link.to}; run pnpm install in ${plan.absPath}`,
      );
    }
  } catch (error) {
    console.error(
      `wt:add: worktree exists at ${plan.absPath}, but linking node_modules failed (${error instanceof Error ? (error.code ?? error.message) : error}); run pnpm install there instead`,
    );
    process.exit(1);
  }

  if (!cli.branch) {
    console.log(
      'note: detached HEAD (no -b given) - fine for reading, commit here only on a branch you own',
    );
  }
  console.log(`worktree ready: ${plan.absPath}`);
}

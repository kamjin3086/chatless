/**
 * Remove a worktree `pnpm wt:add` created, without destroying the checkout it
 * shares `node_modules` with.
 *
 * `wt:add` links `<worktree>/node_modules` to the main checkout's directory (a
 * junction on Windows). `git worktree remove` follows that link and deletes into
 * the main tree - one session lost `node_modules/.bin` that way and had to
 * reinstall before its tests would run. The link is unlinked first here; only
 * then does git remove the tree.
 *
 * Usage:
 *   pnpm wt:remove ../wt-topic
 *   pnpm wt:remove ../wt-topic --force    # discard uncommitted files in it
 *   pnpm wt:remove ../wt-topic --dry-run
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{repoRoot: string, target: string}} input
 * @returns {{absPath: string, linkPath: string, gitArgs: string[]}}
 */
export function planWorktreeRemove({ repoRoot, target }) {
  if (!path.isAbsolute(repoRoot)) {
    throw new Error(
      `repoRoot must be absolute, got "${repoRoot}": a relative base resolves against the wrong cwd`,
    );
  }
  const absPath = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(repoRoot, target);

  if (absPath === repoRoot || absPath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(
      `refusing to remove ${absPath}: that is the checkout itself or inside it (worktrees live beside it, e.g. ../wt-<topic>)`,
    );
  }

  return {
    absPath,
    linkPath: path.join(absPath, 'node_modules'),
    gitArgs: ['worktree', 'remove', absPath],
  };
}

/**
 * The `node_modules` link to unlink before git runs, or null.
 *
 * `lstat`, not `stat`: stat follows the link and would report the main checkout's
 * directory, which is exactly the tree this must never touch. A real directory is
 * not a link and is left for git (with --force) or the user to handle.
 *
 * @param {string} absPath @returns {string|null}
 */
export function linkedNodeModules(absPath) {
  const link = path.join(absPath, 'node_modules');
  try {
    return fs.lstatSync(link).isSymbolicLink() ? link : null;
  } catch {
    return null;
  }
}

/** @param {string} linkPath @returns {'unlink'|'rmdir'} */
export function unlinkNodeModulesLink(linkPath) {
  try {
    fs.unlinkSync(linkPath);
    return 'unlink';
  } catch (error) {
    // A directory junction answers with EPERM here; rmdir removes the junction
    // itself, never the directory it points at.
    if (['EPERM', 'EISDIR', 'ENOTDIR'].includes(error?.code)) {
      fs.rmdirSync(linkPath);
      return 'rmdir';
    }
    throw error;
  }
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { force: false, dryRun: false };
  const positional = [];
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else positional.push(arg);
  }
  args.path = positional[0];
  return args;
}

if (process.argv[1] && process.argv[1].endsWith('wt-remove.mjs')) {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.path) {
    console.error('usage: wt-remove <path> [--force] [--dry-run]');
    process.exit(2);
  }
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  let plan;
  try {
    plan = planWorktreeRemove({ repoRoot, target: cli.path });
  } catch (error) {
    console.error(`wt-remove: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (!fs.existsSync(plan.absPath)) {
    console.error(`wt-remove: nothing at ${plan.absPath}`);
    process.exit(1);
  }

  const link = linkedNodeModules(plan.absPath);
  const gitArgs = cli.force ? [...plan.gitArgs, '--force'] : plan.gitArgs;

  if (cli.dryRun) {
    console.log(link ? `unlink ${link}` : 'no node_modules link to unlink');
    console.log(`git ${gitArgs.join(' ')}`);
    process.exit(0);
  }

  if (link) {
    try {
      const how = unlinkNodeModulesLink(link);
      console.log(`${how === 'rmdir' ? 'unlinked junction' : 'unlinked'} ${link}`);
    } catch (error) {
      console.error(
        `wt-remove: could not unlink ${link} (${error instanceof Error ? (error.code ?? error.message) : error}); remove the worktree by hand rather than letting git follow the link`,
      );
      process.exit(1);
    }
  }

  try {
    execFileSync('git', gitArgs, { cwd: repoRoot, stdio: 'inherit', timeout: 60000 });
  } catch {
    process.exit(1); // git already said why, stdio is inherited
  }
  try {
    execFileSync('git', ['worktree', 'prune'], {
      cwd: repoRoot,
      stdio: 'ignore',
      timeout: 60000,
    });
  } catch {
    // prune is cosmetic once the directory is gone
  }
  console.log(`worktree removed: ${plan.absPath}`);
}

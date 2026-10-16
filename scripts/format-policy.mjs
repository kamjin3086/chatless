#!/usr/bin/env node
/**
 * When formatting is enforced, and when it is not.
 *
 * `main` is largely unformatted - 759 of 856 tracked files under src fail
 * `npx biome format <file>` as of writing - so a hook that demands "your staged files must
 * be formatted" cannot be satisfied without reflowing whole files, which buries the change
 * the commit is actually about. That mismatch is what sent people to `git commit
 * --no-verify`, and a habit of skipping the guardrail is worse than the dirt it checked.
 *
 * So the rule is per-file and mechanical: a file is held to biome only if the version being
 * committed already satisfied biome. Everything else is pre-existing dirt, and clearing it
 * is a formatting-only commit of its own, not a line inside someone's change PR.
 *
 *   --staged              the hook's mode; judges the *index*, which is what git commits
 *   --check <files…>      judge working-tree copies
 *   --write <files…>      format named files only. A directory is refused: `biome format
 *                         --write src` is how a 2,000-line accidental commit happens. A
 *                         file HEAD left unformatted is refused too, unless --allow-reflow.
 *
 * Exit codes: 0 nothing to complain about, 1 this change introduced dirt, 2 the check
 * itself could not run (biome unavailable, file unreadable). A check that cannot run must
 * never report the thing it failed to look at as clean.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;

/** Raised when the check itself could not run - distinct from "this file is dirty". */
export class FormatCheckUnavailable extends Error {}

/** The one decision this file exists for. */
export function decide({
  headClean,
  workClean,
  reflow = 0,
  reflowMinLines = 20,
}) {
  if (workClean) {
    if (headClean) return 'clean';
    // A file HEAD left unformatted that is now clean was reflowed. Small ones - an edit that
    // happens to clear the offending line - are not what this guards, so size decides.
    return reflow >= reflowMinLines ? 'reflow' : 'clean';
  }
  return headClean ? 'regression' : 'pre-existing';
}

/** Lines that differ between HEAD and what is being committed (order-insensitive). */
export function changedLineCount(base, bytes) {
  const before = new Set(String(base).split('\n'));
  const after = String(bytes).split('\n');
  let differing = 0;
  for (const line of after) if (!before.has(line)) differing += 1;
  return differing;
}

/** The message for a reflow, said once wherever the state is detected. */
export function describeReflow(files) {
  return `reflowed ${files.length} file(s) HEAD left unformatted: ${files.join(', ')} - that buries the change under biome's opinion. Put the formatting in its own commit, or pass --allow-reflow and say so in the PR.`;
}

/** Biome's exit status is the cleanliness signal; --config-path keeps the repo's rules. */
export function makeBiomeCleanCheck(root, run = spawnSync) {
  return function isCleanText(text, file) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatless-fmt-'));
    const tmp = path.join(dir, path.basename(file));
    fs.writeFileSync(tmp, text);
    try {
      const res = run('npx', ['biome', 'format', '--config-path', root, tmp], {
        cwd: root,
        encoding: 'utf8',
      });
      // npx missing, biome killed, biome OOM: not a verdict about this file.
      if (res.error || res.status === null || res.status === undefined) {
        throw new FormatCheckUnavailable(
          `biome could not run (${res.error?.message ?? `signal ${res.signal}`}); the format check cannot be trusted`,
        );
      }
      return res.status === 0;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function git(root, args, allowFail = false) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

const headText = (root, file) => git(root, ['show', `HEAD:${file}`], true);
const indexText = (root, file) => git(root, ['show', `:${file}`], true);

/**
 * `subject` supplies the bytes under judgement: the index for --staged (that is what git is
 * about to commit), the working tree for --check and --write. HEAD cleanliness is computed
 * only for a file that is already dirty, because each biome call costs about a quarter of
 * a second and the hook has a budget.
 */
export function assess(
  files,
  { root, isClean, subject = headText, head = headText, reflowMinLines = 20 },
) {
  return files
    .filter((file) => CODE_EXT.test(file))
    .map((file) => {
      const bytes = subject(root, file);
      if (bytes === null)
        throw new FormatCheckUnavailable(`cannot read ${file}`);
      const workClean = isClean(bytes, file);
      const base = head(root, file);
      // A file whose bytes did not move cannot have reflowed, so the HEAD question is not
      // asked for it - each biome call is about a quarter of a second and the hook has a
      // budget. Anything else pays the question, because "clean now" is only half the story:
      // clean now and dirty at HEAD is a whole-file reflow inside someone's change.
      if (workClean && (base === null || base === bytes))
        return { file, headClean: true, workClean, status: 'clean' };
      const headClean = base === null ? true : isClean(base, file);
      return {
        file,
        headClean,
        workClean,
        status: decide({
          headClean,
          workClean,
          reflow: base === null ? 0 : changedLineCount(base, bytes),
          reflowMinLines,
        }),
      };
    });
}

export function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith('--'));
  const files = rest.filter((a) => !a.startsWith('--'));
  if (!mode || !['--staged', '--check', '--write'].includes(mode)) {
    throw new Error(
      'usage: format-policy.mjs --staged | --check <files…> | --write <files…> [--allow-reflow]',
    );
  }
  if (mode !== '--staged' && files.length === 0) {
    throw new Error('name the files; no directory, no tree-wide formatting');
  }
  return {
    mode,
    files,
    allowReflow: flags.includes('--allow-reflow'),
    unknownFlags: flags.filter((f) => f !== '--allow-reflow'),
  };
}

function stagedFiles(root) {
  return git(
    root,
    ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'],
    true,
  )
    .split('\0')
    .filter(Boolean);
}

export function main(
  argv,
  { root = process.cwd(), run, isClean: injectedClean, subject, head } = {},
) {
  const say = (line) => process.stdout.write(`format-policy: ${line}\n`);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    say(err.message);
    return 2;
  }
  const { mode, files, allowReflow, unknownFlags } = parsed;
  if (unknownFlags.length) {
    say(`unknown flag ${unknownFlags[0]}`);
    return 2;
  }
  const dirs = files.filter((f) => {
    try {
      return fs.statSync(path.join(root, f)).isDirectory();
    } catch {
      return false;
    }
  });
  if (mode === '--write' && dirs.length) {
    say(
      `refusing directories (${dirs.join(', ')}). Name the files you changed.`,
    );
    return 2;
  }

  const runner = run ?? spawnSync;
  // Injectable so the rule can be tested without paying for biome on every case.
  const isClean = injectedClean ?? makeBiomeCleanCheck(root, runner);
  const contentSubject =
    subject ??
    (mode === '--staged'
      ? indexText
      : (_root, file) => {
          try {
            return fs.readFileSync(path.join(root, file), 'utf8');
          } catch {
            return null;
          }
        });

  let rows;
  try {
    const target = mode === '--staged' ? stagedFiles(root) : files;
    rows = assess(target, {
      root,
      isClean,
      subject: contentSubject,
      head: head ?? headText,
    });
  } catch (err) {
    say(err.message);
    return 2;
  }

  if (mode === '--write') {
    const blocked = rows.filter((r) => !r.headClean && !allowReflow);
    const todo = rows.filter((r) => r.headClean || allowReflow);
    for (const row of blocked) {
      say(
        `skipped ${row.file} - HEAD is already unformatted, reformatting would bury your change. Use --allow-reflow if this is a formatting-only commit.`,
      );
    }
    let failed = 0;
    for (const row of todo) {
      const res = runner(
        'npx',
        ['biome', 'format', '--config-path', root, '--write', row.file],
        {
          cwd: root,
          encoding: 'utf8',
        },
      );
      if (res?.status !== 0) {
        failed += 1;
        say(`biome could not format ${row.file} - the file was left untouched`);
      } else {
        process.stdout.write(`formatted ${row.file}\n`);
      }
    }
    // A skip or a failed write that exits 0 reads as success to whoever asked for it.
    return blocked.length || failed ? 1 : 0;
  }

  const reflows = allowReflow ? [] : rows.filter((r) => r.status === 'reflow');
  for (const row of rows.filter((r) => r.status === 'reflow')) {
    if (allowReflow)
      say(
        `reflow allowed for ${row.file} - the PR should say this commit is formatting`,
      );
  }
  if (reflows.length) say(describeReflow(reflows.map((r) => r.file)));
  const regressions = rows.filter((r) => r.status === 'regression');
  for (const row of rows.filter((r) => r.status === 'pre-existing')) {
    say(
      `not held to format - ${row.file} was already unformatted at HEAD (clear it in its own commit)`,
    );
  }
  for (const row of regressions) say(`not formatted - ${row.file}`);
  if (regressions.length) {
    say(
      `${regressions.length} file(s) introduced formatting dirt - run: pnpm fmt ${regressions.map((r) => r.file).join(' ')}`,
    );
  }
  return regressions.length || reflows.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}

#!/usr/bin/env node
/**
 * When formatting is enforced, and when it is not.
 *
 * `main` carries files that biome would reflow entirely. Reformatting one of those inside
 * a change PR buries the change in churn - the repo's own rule is no drive-by formatting -
 * yet a hook that demands "your staged files must be formatted" pushes straight past that
 * rule, because leaving a pre-existing dirty file dirty fails the hook. That is why
 * `git commit --no-verify` became a habit here, and a habit of skipping the guardrail is
 * worse than the original dirt.
 *
 * So the rule is per-file, and it is mechanical: a file is held to biome only if the
 * version at HEAD already satisfied biome. Otherwise the dirt is pre-existing and this
 * change PR is not the place to clear it. Clearing it is its own formatting-only PR.
 *
 *   --staged              the hook's mode; exits 1 if the change introduced the dirt
 *   --check <files...>    assess named files, same exit codes
 *   --write <files...>    format named files only. A directory is refused: `biome format
 *                         --write src` is how a 2,000-line accidental commit happens.
 *                         Refusing to reflow a file HEAD left unformatted is the same
 *                         rule, and needs --allow-reflow to override.
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODE_EXT = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;

/** The one decision this file exists for. */
export function decide({ headClean, workClean }) {
  if (workClean) return 'clean';
  return headClean ? 'regression' : 'pre-existing';
}

/** Biome's exit status is the cleanliness signal; --config-path keeps the repo's rules. */
export function makeBiomeCleanCheck(root, run = spawnSync) {
  return function isCleanText(text, file) {
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'chatless-fmt-')),
      path.basename(file),
    );
    fs.writeFileSync(tmp, text);
    try {
      const res = run('npx', ['biome', 'format', '--config-path', root, tmp], {
        cwd: root,
        encoding: 'utf8',
      });
      return res.status === 0;
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  };
}

function defaultHeadText(root, file) {
  try {
    return execFileSync('git', ['show', `HEAD:${file}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // not in HEAD: a new file, which has no pre-existing dirt to blame
  }
}

export function assess(files, { root, isClean, headText = defaultHeadText }) {
  return files
    .filter((file) => CODE_EXT.test(file))
    .map((file) => {
      const head = headText(root, file);
      const headClean = head === null ? true : isClean(head, file);
      let workClean = true;
      try {
        workClean = isClean(fs.readFileSync(path.join(root, file)), file);
      } catch {
        workClean = true; // deleted or unreadable here: nothing to format
      }
      return {
        file,
        headClean,
        workClean,
        status: decide({ headClean, workClean }),
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
  return execSync('git diff --cached --name-only --diff-filter=ACM', {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

export function main(
  argv,
  { root = process.cwd(), run, isClean: injectedClean, headText } = {},
) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stdout.write(`format-policy: ${err.message}\n`);
    return 2;
  }
  const { mode, files, allowReflow, unknownFlags } = parsed;
  if (unknownFlags.length) {
    process.stdout.write(`format-policy: unknown flag ${unknownFlags[0]}\n`);
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
    process.stdout.write(
      `format-policy: refusing directories (${dirs.join(', ')}). Name the files you changed.\n`,
    );
    return 2;
  }
  const runner = run ?? spawnSync;
  // Injectable so the rule can be tested without paying for biome on every case.
  const isClean = injectedClean ?? makeBiomeCleanCheck(root, runner);
  const heads = headText ?? ((r, file) => defaultHeadText(r, file));
  const target = mode === '--staged' ? stagedFiles(root) : files;
  const rows = assess(target, { root, isClean, headText: heads });

  if (mode === '--write') {
    const blocked = rows.filter((r) => !r.headClean && !allowReflow);
    const todo = rows.filter((r) => r.headClean || allowReflow);
    for (const row of blocked) {
      process.stdout.write(
        `format-policy: skipped ${row.file} - HEAD is already unformatted, reformatting would bury your change. Use --allow-reflow if this is a formatting-only commit.\n`,
      );
    }
    for (const row of todo) {
      runner(
        'npx',
        ['biome', 'format', '--config-path', root, '--write', row.file],
        { cwd: root },
      );
      process.stdout.write(`formatted ${row.file}\n`);
    }
    // A skip that exits 0 reads as success to whoever asked for the format.
    return blocked.length ? 1 : 0;
  }

  const regressions = rows.filter((r) => r.status === 'regression');
  const preExisting = rows.filter((r) => r.status === 'pre-existing');
  for (const row of preExisting) {
    process.stdout.write(
      `format-policy: not held to format - ${row.file} was already unformatted at HEAD (clear it in its own commit)\n`,
    );
  }
  for (const row of regressions) {
    process.stdout.write(`format-policy: not formatted - ${row.file}\n`);
  }
  if (regressions.length) {
    process.stdout.write(
      `format-policy: ${regressions.length} file(s) introduced formatting dirt - run: pnpm fmt ${regressions.map((r) => r.file).join(' ')}\n`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}

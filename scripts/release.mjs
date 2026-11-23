#!/usr/bin/env node
import { execFileSync, execSync } from 'node:child_process';

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function assertSemver(v) {
  const r = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
  if (!r.test(v)) throw new Error(`Invalid semver: ${v}`);
}

function usage() {
  console.log('Usage: node scripts/release.mjs <version>');
  console.log('Example: node scripts/release.mjs v0.2.1');
  process.exit(1);
}

try {
  const [, , input] = process.argv;
  if (!input) usage();

  // Accept with or without leading "v"
  let tag = input.startsWith('v') ? input : `v${input}`;
  const version = tag.slice(1);
  assertSemver(version);

  // Validate the changelog before writing version files, committing, or pushing.
  execFileSync(process.execPath, ['scripts/extract-changelog.mjs'], {
    env: { ...process.env, VERSION: version },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // 1) set version in files
  run('node scripts/set-version.mjs', { env: { ...process.env, VERSION: version } });

  // 2) commit and push
  run('git add package.json src-tauri/tauri.conf.json');
  run(`git commit -m "chore: release ${tag}"`);
  run('git push origin HEAD');

  // 3) create & push tag (force re-push if exists)
  run(`node scripts/repushtag.mjs ${tag} --message "${tag}"`);

  console.log('\n✅ Release preparation done. GitHub Actions will now build & publish the release.');
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
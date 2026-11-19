import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  linkedNodeModules,
  parseArgs,
  planWorktreeRemove,
} from '../wt-remove.mjs';

const REPO = path.resolve('/repo/chatless');
const WT_TOPIC = path.resolve(REPO, '../wt-topic');

describe('planWorktreeRemove', () => {
  it('resolves a relative path against the repo root, the sibling wt:add names', () => {
    const plan = planWorktreeRemove({ repoRoot: REPO, target: '../wt-topic' });
    expect(plan.absPath).toBe(WT_TOPIC);
    expect(plan.linkPath).toBe(path.join(WT_TOPIC, 'node_modules'));
    expect(plan.gitArgs).toEqual(['worktree', 'remove', WT_TOPIC]);
  });

  it('refuses the checkout itself', () => {
    expect(() => planWorktreeRemove({ repoRoot: REPO, target: REPO })).toThrow(
      /refusing to remove/,
    );
  });

  it('refuses a path inside the checkout', () => {
    expect(() =>
      planWorktreeRemove({ repoRoot: REPO, target: './src' }),
    ).toThrow(/refusing to remove/);
  });

  it('refuses a relative repo root, the same way wt:add does', () => {
    expect(() =>
      planWorktreeRemove({ repoRoot: 'chatless', target: '/tmp/wt-x' }),
    ).toThrow(/absolute/);
  });
});

describe('linkedNodeModules', () => {
  it('finds nothing when the worktree has no node_modules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remove-'));
    try {
      expect(linkedNodeModules(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never claims a real node_modules directory is a link', () => {
    // A real directory is the user's own install: git (with --force) or the user
    // removes it, and this script must not unlink into it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remove-'));
    try {
      fs.mkdirSync(path.join(dir, 'node_modules'));
      expect(linkedNodeModules(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('leaves a non-worktree dependency link intact even with --force', () => {
  const target = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wt-remove-unregistered-'),
  );
  try {
    const dependencies = path.join(target, 'dependencies');
    const link = path.join(target, 'node_modules');
    fs.mkdirSync(dependencies);
    fs.symlinkSync(dependencies, link, 'junction');
    const script = fileURLToPath(new URL('../wt-remove.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, target, '--force'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a linked worktree');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe('parseArgs', () => {
  it('takes one path plus the two switches', () => {
    expect(parseArgs(['../wt-topic', '--force'])).toMatchObject({
      path: '../wt-topic',
      force: true,
      dryRun: false,
    });
    expect(parseArgs(['--dry-run', '/tmp/wt'])).toMatchObject({
      path: '/tmp/wt',
      dryRun: true,
    });
  });
});

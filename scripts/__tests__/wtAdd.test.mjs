import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planWorktreeAdd } from '../wt-add.mjs';

const REPO = path.resolve('/repo/chatless');
const WT_TOPIC = path.resolve(REPO, '../wt-topic');
const WT_X = path.resolve('/tmp/wt-x');

describe('planWorktreeAdd', () => {
  it('defaults to origin/main and resolves a relative path against the repo root', () => {
    const plan = planWorktreeAdd({
      repoRoot: REPO,
      path: '../wt-topic',
    });
    expect(plan.absPath).toBe(WT_TOPIC);
    expect(plan.gitArgs).toEqual([
      'worktree',
      'add',
      WT_TOPIC,
      'origin/main',
    ]);
  });

  it('adds -b when a new branch is asked for', () => {
    const plan = planWorktreeAdd({
      repoRoot: REPO,
      path: WT_X,
      branch: 'feat/x',
      ref: 'main',
    });
    expect(plan.gitArgs).toEqual([
      'worktree',
      'add',
      '-b',
      'feat/x',
      WT_X,
      'main',
    ]);
  });

  it('links node_modules with absolute paths only', () => {
    const plan = planWorktreeAdd({
      repoRoot: REPO,
      path: WT_X,
    });
    expect(plan.link).toEqual({
      from: path.join(WT_X, 'node_modules'),
      to: path.join(REPO, 'node_modules'),
    });
    expect(path.isAbsolute(plan.link.from)).toBe(true);
    expect(path.isAbsolute(plan.link.to)).toBe(true);
  });

  it('refuses a relative repo root, because the link would break in the new worktree', () => {
    expect(() => planWorktreeAdd({ repoRoot: '.', path: WT_X })).toThrow(
      /absolute/,
    );
  });

  it('refuses to nest a worktree inside the checkout it links from', () => {
    expect(() =>
      planWorktreeAdd({ repoRoot: REPO, path: REPO }),
    ).toThrow(/nest/);
    expect(() =>
      planWorktreeAdd({ repoRoot: REPO, path: 'wt-topic' }),
    ).toThrow(/nest/);
    expect(() =>
      planWorktreeAdd({
        repoRoot: REPO,
        path: path.join(REPO, 'nested/deep'),
      }),
    ).toThrow(/nest/);
  });
});

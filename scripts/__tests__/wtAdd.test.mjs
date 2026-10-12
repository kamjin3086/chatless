import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planWorktreeAdd } from '../wt-add.mjs';

describe('planWorktreeAdd', () => {
  it('defaults to origin/main and resolves a relative path against the repo root', () => {
    const plan = planWorktreeAdd({
      repoRoot: '/repo/chatless',
      path: '../wt-topic',
    });
    expect(plan.absPath).toBe('/repo/wt-topic');
    expect(plan.gitArgs).toEqual([
      'worktree',
      'add',
      '/repo/wt-topic',
      'origin/main',
    ]);
  });

  it('adds -b when a new branch is asked for', () => {
    const plan = planWorktreeAdd({
      repoRoot: '/repo/chatless',
      path: '/tmp/wt-x',
      branch: 'feat/x',
      ref: 'main',
    });
    expect(plan.gitArgs).toEqual([
      'worktree',
      'add',
      '-b',
      'feat/x',
      '/tmp/wt-x',
      'main',
    ]);
  });

  it('links node_modules with absolute paths only', () => {
    const plan = planWorktreeAdd({
      repoRoot: '/repo/chatless',
      path: '/tmp/wt-x',
    });
    expect(plan.link).toEqual({
      from: '/tmp/wt-x/node_modules',
      to: '/repo/chatless/node_modules',
    });
    expect(path.isAbsolute(plan.link.from)).toBe(true);
    expect(path.isAbsolute(plan.link.to)).toBe(true);
  });

  it('refuses a relative repo root, because the link would break in the new worktree', () => {
    expect(() => planWorktreeAdd({ repoRoot: '.', path: '/tmp/wt-x' })).toThrow(
      /absolute/,
    );
  });

  it('refuses to nest a worktree inside the checkout it links from', () => {
    expect(() =>
      planWorktreeAdd({ repoRoot: '/repo/chatless', path: '/repo/chatless' }),
    ).toThrow(/nest/);
    expect(() =>
      planWorktreeAdd({ repoRoot: '/repo/chatless', path: 'wt-topic' }),
    ).toThrow(/nest/);
    expect(() =>
      planWorktreeAdd({
        repoRoot: '/repo/chatless',
        path: '/repo/chatless/nested/deep',
      }),
    ).toThrow(/nest/);
  });
});

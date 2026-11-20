import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReviewSnapshot } from '../review-snapshot.mjs';
import { countWorktreeChanges } from '../repo-state.mjs';

let temp;
let source;
let destination;
let git;
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'chatless-review-fixture-'));
  source = join(temp, 'source');
  destination = join(temp, 'review');
  execFileSync('git', ['init', '-q', source]);
  git = (args, cwd = source) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' });
  writeFileSync(join(source, '.gitignore'), 'private.txt\n');
  writeFileSync(join(source, 'tracked.ts'), 'base\n');
  git(['add', '.']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'base',
  ]);
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe('worktree review snapshots', () => {
  it('reviews a change made only of untracked files without changing the source', () => {
    writeFileSync(join(source, 'new.ts'), 'proposed\n');
    writeFileSync(join(source, 'private.txt'), 'ignored\n');
    const before = git(['status', '--porcelain']);
    expect(() =>
      createReviewSnapshot({ cwd: source, base: 'HEAD', destination }),
    ).toThrow('Untracked files exist');
    const result = createReviewSnapshot({
      cwd: source,
      base: 'HEAD',
      destination,
      includeUntracked: true,
    });
    expect(
      git(['diff', '--name-only', `${result.baseline}...HEAD`], destination),
    ).toBe('new.ts\n');
    expect(git(['rev-parse', 'HEAD'], destination).trim()).toBe(
      result.snapshot,
    );
    expect(git(['rev-parse', 'HEAD'], source).trim()).toBe(result.baseline);
    expect(git(['status', '--porcelain'])).toBe(before);
  });

  it('reviews the working version without overwriting the staged version', () => {
    writeFileSync(join(source, 'tracked.ts'), 'staged\n');
    git(['add', 'tracked.ts']);
    writeFileSync(join(source, 'tracked.ts'), 'working\n');
    createReviewSnapshot({ cwd: source, base: 'HEAD', destination });
    expect(git(['show', 'HEAD:tracked.ts'], destination)).toBe('working\n');
    expect(git(['show', ':tracked.ts'])).toBe('staged\n');
  });

  it('rejects an empty diff before creating a checkout', () => {
    expect(() =>
      createReviewSnapshot({ cwd: source, base: 'HEAD', destination }),
    ).toThrow('No changes');
    expect(git(['worktree', 'list', '--porcelain'])).not.toContain(destination);
  });
});

it('counts staged, unstaged and untracked paths without counting the old rename path', () => {
  expect(
    countWorktreeChanges(' M file\0MM other\0R  new\0old\0?? untracked\0'),
  ).toEqual({ staged: 2, unstaged: 2, untracked: 1 });
});

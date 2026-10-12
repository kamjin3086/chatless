import { describe, expect, it } from 'vitest';
import { checkPrTitle } from '../check-pr-title.mjs';

describe('checkPrTitle', () => {
  it.each([
    'fix(macos): stop the window event path from re-entering Tauri',
    'chore: release v0.7.1',
    'feat(agent-runtime): stream tool results through the event log',
    'docs(agents): record the collaboration language tiers',
    'refactor(tool-pipeline)!: move side effects out of the policy module',
  ])('accepts %s', (title) => {
    expect(checkPrTitle(title)).toEqual([]);
  });

  it('rejects a Chinese title', () => {
    const problems = checkPrTitle('chore: 删除可证零引用的工具路径');
    expect(problems.some((p) => p.includes('ASCII'))).toBe(true);
  });

  it('rejects a prose title with no conventional type', () => {
    expect(checkPrTitle('Update logo image in README_EN.md')).toHaveLength(1);
  });

  it('rejects an unknown type', () => {
    expect(checkPrTitle('wip: something')).not.toEqual([]);
  });

  it('rejects an empty or missing title', () => {
    expect(checkPrTitle('')).not.toEqual([]);
    expect(checkPrTitle(undefined)).not.toEqual([]);
  });

  it('rejects a title that is too long to read in the list', () => {
    expect(checkPrTitle(`fix(ui): ${'x'.repeat(90)}`)).not.toEqual([]);
  });
});

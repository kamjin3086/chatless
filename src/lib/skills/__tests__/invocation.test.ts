import { describe, expect, it } from 'vitest';
import {
  invocableByModel,
  invocableByUser,
  invocationPolicyOf,
} from '../invocation';

/**
 * 触发方式 (invocation policy) is derived from frontmatter, not from a user preference.
 * When both switches hold, `user-only` wins: letting the model load something unasked is
 * the more dangerous side, so it is the one refused first.
 */
describe('invocationPolicyOf', () => {
  it('defaults to both when nothing is declared', () => {
    expect(invocationPolicyOf(undefined)).toBe('model-and-user');
    expect(invocationPolicyOf(null)).toBe('model-and-user');
    expect(invocationPolicyOf({})).toBe('model-and-user');
  });

  it('keeps a model-only skill out of the user menu', () => {
    expect(invocationPolicyOf({ 'user-invocable': false })).toBe('model-only');
  });

  it('keeps a user-only skill out of the model index', () => {
    expect(invocationPolicyOf({ 'disable-model-invocation': true })).toBe(
      'user-only',
    );
  });

  it('resolves both switches at once against the model', () => {
    expect(
      invocationPolicyOf({
        'disable-model-invocation': true,
        'user-invocable': false,
      }),
    ).toBe('user-only');
  });

  it('treats an unrecognised value as not declared', () => {
    expect(
      invocationPolicyOf({
        'disable-model-invocation': undefined,
        'user-invocable': undefined,
      }),
    ).toBe('model-and-user');
  });
});

describe('the two predicates', () => {
  it('hides only user-only from the model, and only model-only from the user', () => {
    expect(invocableByModel(undefined)).toBe(true);
    expect(invocableByModel('model-and-user')).toBe(true);
    expect(invocableByModel('model-only')).toBe(true);
    expect(invocableByModel('user-only')).toBe(false);

    expect(invocableByUser(undefined)).toBe(true);
    expect(invocableByUser('model-and-user')).toBe(true);
    expect(invocableByUser('user-only')).toBe(true);
    expect(invocableByUser('model-only')).toBe(false);
  });
});

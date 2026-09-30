import { describe, expect, it } from 'vitest';
import { resolveConnectionHintStatus } from '@/lib/provider/connectionHintStatus';

describe('resolveConnectionHintStatus', () => {
  it('shows detecting only while a check is in flight', () => {
    expect(resolveConnectionHintStatus(true, {
      lastResult: 'NOT_CONNECTED',
    })).toBe('CONNECTING');
  });

  it('shows the completed result after the check finishes even if lastResult already exists', () => {
    expect(resolveConnectionHintStatus(false, {
      lastResult: 'NOT_CONNECTED',
    })).toBe('NOT_CONNECTED');
    expect(resolveConnectionHintStatus(false, {
      lastResult: 'CONNECTED',
    })).toBe('CONNECTED');
  });

  it('prefers missing-key over last result', () => {
    expect(resolveConnectionHintStatus(false, {
      configStatus: 'NO_KEY',
      lastResult: 'NOT_CONNECTED',
    })).toBe('NO_KEY');
  });

  it('hides the hint when idle with no result', () => {
    expect(resolveConnectionHintStatus(false, {})).toBeNull();
  });
});

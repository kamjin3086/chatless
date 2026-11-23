import { afterEach, expect, it, vi } from 'vitest';
import { formatResourceReferenceTime } from '../formatResourceReferenceTime';

const now = new Date('2024-04-18T12:00:00Z');
afterEach(() => vi.useRealTimers());

it('formats the same reference timestamp for each app locale', () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);

  const createdAt = '2024-04-18T11:55:00Z';
  expect(formatResourceReferenceTime(createdAt, 'en')).toBe('5 minutes ago');
  expect(formatResourceReferenceTime(createdAt, 'zh')).toBe('5 分钟前');
});

it('leaves an unrecognized timestamp unchanged', () => {
  expect(formatResourceReferenceTime('invalid timestamp', 'en')).toBe('invalid timestamp');
  expect(formatResourceReferenceTime('invalid timestamp', 'zh')).toBe('invalid timestamp');
});

/**
 * The clock in the prompt is a cache problem before it is a feature.
 *
 * Every request carries one system message, and its blocks are ordered so the
 * cacheable prefix stays contiguous - but the time block is still part of the
 * message, and a block that changes every minute makes every request a different
 * prompt. A server that reuses a prefix or a whole prompt (llama.cpp's cache, a
 * gateway's response cache) can only hit if what it receives is the same bytes.
 *
 * Minute precision bought nothing: an answer about "today" needs the date and the
 * weekday, not the wall clock. A day-precise block keeps the model right and lets
 * consecutive turns of a conversation be byte-identical again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSimpleTimeContext,
  buildTimeContextMessage,
  getCurrentTimeInfo,
} from '../TimeContext';

const CLOCK = /\b\d{1,2}:\d{2}\b/;

afterEach(() => {
  vi.useRealTimers();
});

describe('the time block a request carries', () => {
  it('names the date and the weekday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:18:00'));
    const message = buildTimeContextMessage(false);

    expect(message).toContain('2026-10-19');
    expect(message).toContain('Monday');
  });

  it('does not change from minute to minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T09:00:00'));
    const morning = buildTimeContextMessage(false);
    vi.setSystemTime(new Date('2026-10-19T23:59:00'));
    const evening = buildTimeContextMessage(false);

    expect(evening).toBe(morning);
    expect(morning).not.toMatch(CLOCK);
  });

  it('keeps the search guidance day-precise too, because a query needs a date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:18:00'));
    const message = buildTimeContextMessage(true);

    expect(message).toContain('2026-10-19');
    expect(message).not.toMatch(CLOCK);
  });

  it('is stable in the short follow-up form as well', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T09:00:00'));
    const first = buildSimpleTimeContext();
    vi.setSystemTime(new Date('2026-10-19T21:30:00'));

    expect(buildSimpleTimeContext()).toBe(first);
    expect(first).not.toMatch(CLOCK);
  });
});

describe('the time info still reports the clock, for whatever needs it', () => {
  it('keeps the wall clock out of `datetime` but available as `time`', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T16:18:00'));
    const info = getCurrentTimeInfo();

    expect(info.datetime).toBe('2026-10-19 Monday');
    expect(info.time).toBe('16:18');
  });
});

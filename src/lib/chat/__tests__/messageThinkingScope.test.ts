import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMessageScope,
  subscribeMessageScope,
  peekMessageScope,
  setMessageScope,
  takeMessageScope,
} from '../messageThinkingScope';

const CHOICE = { enableThinkingLevel: true, thinkingLevel: 'low' } as const;

describe('single-message thinking scope', () => {
  beforeEach(() => {
    clearMessageScope('c1');
    clearMessageScope('c2');
  });

  it('holds a choice until something takes it', () => {
    setMessageScope('c1', CHOICE);
    expect(peekMessageScope('c1')).toEqual(CHOICE);
    expect(peekMessageScope('c1')).toEqual(CHOICE);
  });

  it('is consumed once, so it cannot leak into the next message', () => {
    setMessageScope('c1', CHOICE);
    expect(takeMessageScope('c1')).toEqual(CHOICE);
    expect(takeMessageScope('c1')).toBe(null);
  });

  it('does not cross conversations', () => {
    setMessageScope('c1', CHOICE);
    expect(peekMessageScope('c2')).toBe(null);
    expect(takeMessageScope('c2')).toBe(null);
    expect(peekMessageScope('c1')).toEqual(CHOICE);
  });

  it('replaces a pending choice instead of stacking', () => {
    setMessageScope('c1', CHOICE);
    setMessageScope('c1', { enableThinkingLevel: true, thinkingLevel: 'high' });
    expect(peekMessageScope('c1')).toEqual({
      enableThinkingLevel: true,
      thinkingLevel: 'high',
    });
  });

  it('can be withdrawn before the message is sent', () => {
    setMessageScope('c1', CHOICE);
    clearMessageScope('c1');
    expect(peekMessageScope('c1')).toBe(null);
  });

  it('ignores an empty choice rather than storing a phantom pending state', () => {
    setMessageScope('c1', {});
    expect(peekMessageScope('c1')).toBe(null);
    expect(takeMessageScope('c1')).toBe(null);
  });

  it('hands back a copy, so a caller cannot mutate what is stored', () => {
    setMessageScope('c1', { enableThinkingLevel: true, thinkingLevel: 'low' });
    const got = peekMessageScope('c1');
    if (got) delete (got as Record<string, unknown>).thinkingLevel;
    expect(peekMessageScope('c1')).toEqual(CHOICE);
  });
});

describe('telling the screen a pending choice changed', () => {
  it('notifies while something is pending and stops when unsubscribed', () => {
    const seen: string[] = [];
    const off = subscribeMessageScope('c1', () => seen.push('tick'));
    setMessageScope('c1', CHOICE);
    expect(seen).toEqual(['tick']);
    clearMessageScope('c1');
    expect(seen).toEqual(['tick', 'tick']);
    off();
    setMessageScope('c1', CHOICE);
    expect(seen).toEqual(['tick', 'tick']);
  });

  it('does not wake a different conversation over this one', () => {
    const seen: string[] = [];
    subscribeMessageScope('c1', () => seen.push('c1'));
    setMessageScope('c2', CHOICE);
    expect(seen).toEqual([]);
    clearMessageScope('c2');
  });
});

/**
 * Where the new-conversation column puts the composer. Both render paths read this, so the
 * classes here are the whole layout decision: desktop centres the greeting above the
 * composer, Android anchors the pair to the bottom so the input is under the thumb.
 */
import { describe, expect, it } from 'vitest';
import { starterLayout } from '../starterLayout';

const DESKTOP_COLUMN =
  'flex min-h-0 flex-1 flex-col justify-center-safe overflow-y-auto';
const DESKTOP_BLOCK = 'max-w-3xl py-6';

describe('starter column on desktop', () => {
  it('keeps the incumbent centred composition', () => {
    expect(starterLayout(false, true)).toEqual({
      column: DESKTOP_COLUMN,
      block: DESKTOP_BLOCK,
    });
    expect(starterLayout(false, false)).toEqual({
      column: DESKTOP_COLUMN,
      block: DESKTOP_BLOCK,
    });
  });
});

describe('starter column on Android', () => {
  it('anchors the composer to the bottom of the column', () => {
    const { column, block } = starterLayout(true, true);
    expect(column).not.toContain('justify-center-safe');
    // A tall empty state must still scroll instead of being clipped above the top edge.
    expect(column).toContain('overflow-y-auto');
    expect(block).toContain('mt-auto');
  });

  it('leaves the gap to the home indicator on the anchored block', () => {
    expect(starterLayout(true, true).block).toContain(
      'env(safe-area-inset-bottom)',
    );
  });

  it('keeps the greeting centred when there is no composer to reach', () => {
    expect(starterLayout(true, false)).toEqual({
      column: DESKTOP_COLUMN,
      block: DESKTOP_BLOCK,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../RRFFusion';

describe('reciprocalRankFusion', () => {
  it('merges two ranked lists with RRF scores', () => {
    const dense = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
      { id: 'c', score: 0.7 },
    ];
    const bm25 = [
      { id: 'b', score: 1 },
      { id: 'd', score: 0.5 },
      { id: 'a', score: 0.4 },
    ];
    const fused = reciprocalRankFusion([dense, bm25], 60);
    expect(fused[0].id).toBe('b');
    expect(fused.some((x) => x.id === 'a')).toBe(true);
    expect(fused.some((x) => x.id === 'd')).toBe(true);
    expect(fused.find((x) => x.id === 'b')!.rrfScore).toBeGreaterThan(fused.find((x) => x.id === 'c')!.rrfScore);
  });
});

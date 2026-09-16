import { describe, expect, it } from 'vitest';
import { generateAvatarDataUrl, getAvatarInitials, hashSeed } from '@/lib/avatar';

describe('getAvatarInitials', () => {
  it('takes the first two latin letters for a single word', () => {
    expect(getAvatarInitials('homelab')).toBe('HO');
  });

  it('takes first letters of two words', () => {
    expect(getAvatarInitials('GPT Load')).toBe('GL');
  });

  it('uses the first CJK character', () => {
    expect(getAvatarInitials('智谱')).toBe('智');
  });
});

describe('generateAvatarDataUrl', () => {
  it('returns a stable svg data url for the same seed', () => {
    const a = generateAvatarDataUrl('homelab', 'homelab', 24);
    const b = generateAvatarDataUrl('homelab', 'homelab', 24);
    expect(a).toBe(b);
    expect(a.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('varies palette with seed', () => {
    const a = generateAvatarDataUrl('alpha', 'alpha', 24);
    const b = generateAvatarDataUrl('omega', 'omega', 24);
    expect(a).not.toBe(b);
    expect(hashSeed('alpha')).not.toBe(hashSeed('omega'));
  });

  it('uses a single letter at small sizes', () => {
    const svg = decodeURIComponent(generateAvatarDataUrl('homelab', 'homelab', 18).slice('data:image/svg+xml;utf8,'.length));
    expect(svg).toContain('H</text>');
    expect(svg).not.toContain('HL</text>');
  });
});

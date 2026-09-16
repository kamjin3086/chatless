/**
 * 为自定义 Provider 生成稳定、可辨识的图标（SVG data URL）。
 * 不引入第三方库：用策划配色 + 几何纹样，避免随机色块字母的廉价感。
 */

const PALETTES = [
  { from: '#D7EBFF', to: '#B4D2F5', fg: '#1E4B8C', motif: '#6EA4E6' },
  { from: '#D6F3EC', to: '#B3E2D4', fg: '#0F6754', motif: '#4DB89D' },
  { from: '#E4DEFB', to: '#C8BDF3', fg: '#4A2FA6', motif: '#8B7AE0' },
  { from: '#FFE6D4', to: '#F3C8A6', fg: '#9A4314', motif: '#E08A55' },
  { from: '#FCE0EA', to: '#F3BCCE', fg: '#9D1D4C', motif: '#E07198' },
  { from: '#DEE4FF', to: '#C0C9F8', fg: '#2C3AB0', motif: '#7382EE' },
  { from: '#D8F4F8', to: '#B3E3EB', fg: '#0E5F6C', motif: '#45B3C2' },
  { from: '#E6EDF5', to: '#CBD6E4', fg: '#334155', motif: '#8A9BB0' },
  { from: '#E2F0D6', to: '#C4DCAE', fg: '#3C641C', motif: '#7AAD52' },
  { from: '#F8E6D4', to: '#EBC39E', fg: '#854C14', motif: '#D09A5C' },
  { from: '#EDE0F6', to: '#D4C0E8', fg: '#6B21A8', motif: '#B07AD6' },
  { from: '#F3E4D6', to: '#E0C4A8', fg: '#73441C', motif: '#C49268' },
] as const;

export function hashSeed(seed: string): number {
  let h = 2166136261;
  const s = String(seed || 'seed');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 用于图标上的字母：多词取前两词首字母；单词取前两字母；中文取首字。 */
export function getAvatarInitials(label?: string, seed?: string): string {
  const raw = (label || seed || 'A').trim();
  if (!raw) return 'A';
  if (/[\u4e00-\u9fff]/.test(raw[0])) return raw[0];

  const parts = raw.split(/[\s\-_\.\/]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  const camel = raw.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  if (camel.length >= 2) {
    return (camel[0][0] + camel[1][0]).toUpperCase();
  }

  const letters = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (letters.length >= 2) return (letters[0] + letters[1]).toUpperCase();
  return (letters[0] || raw[0] || 'A').toUpperCase();
}

function motifSvg(kind: number, size: number, color: string): string {
  const s = size;
  switch (kind % 6) {
    case 0:
      return `<circle cx="${s * 0.82}" cy="${s * 0.78}" r="${s * 0.42}" fill="${color}" opacity="0.38"/>`;
    case 1:
      return `<circle cx="${s * 0.18}" cy="${s * 0.2}" r="${s * 0.34}" fill="${color}" opacity="0.34"/>
<circle cx="${s * 0.42}" cy="${s * -0.02}" r="${s * 0.28}" fill="${color}" opacity="0.22"/>`;
    case 2:
      return `<rect x="${-s * 0.15}" y="${s * 0.55}" width="${s * 1.4}" height="${s * 0.38}" rx="${s * 0.12}" transform="rotate(-18 ${s / 2} ${s / 2})" fill="${color}" opacity="0.32"/>`;
    case 3:
      return `<circle cx="${s * 0.72}" cy="${s * 0.28}" r="${s * 0.36}" fill="none" stroke="${color}" stroke-width="${Math.max(2, s * 0.1)}" opacity="0.4"/>`;
    case 4:
      return `<circle cx="${s * 0.22}" cy="${s * 0.78}" r="${s * 0.07}" fill="${color}" opacity="0.45"/>
<circle cx="${s * 0.38}" cy="${s * 0.78}" r="${s * 0.07}" fill="${color}" opacity="0.32"/>
<circle cx="${s * 0.22}" cy="${s * 0.62}" r="${s * 0.07}" fill="${color}" opacity="0.32"/>
<circle cx="${s * 0.38}" cy="${s * 0.62}" r="${s * 0.07}" fill="${color}" opacity="0.22"/>`;
    default:
      return `<rect x="0" y="0" width="${s * 0.28}" height="${s}" fill="${color}" opacity="0.28"/>`;
  }
}

export function generateAvatarDataUrl(seed: string, label?: string, size: number = 40): string {
  const hash = hashSeed(String(seed || 'seed'));
  const palette = PALETTES[hash % PALETTES.length];
  const kind = (hash >>> 8) % 6;
  const w = size;
  const rx = Math.round(size * 0.22);
  const uid = `av${hash.toString(16)}`;
  const twoLetter = size >= 28;
  const initials = getAvatarInitials(label, seed);
  const text = twoLetter ? initials : initials[0];
  const fontSize = Math.round(size * (text.length > 1 ? 0.36 : 0.46));

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 ${w} ${w}">
  <defs>
    <linearGradient id="${uid}g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.from}"/>
      <stop offset="100%" stop-color="${palette.to}"/>
    </linearGradient>
    <clipPath id="${uid}c">
      <rect width="${w}" height="${w}" rx="${rx}" ry="${rx}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#${uid}c)">
    <rect width="${w}" height="${w}" fill="url(#${uid}g)"/>
    ${motifSvg(kind, w, palette.motif)}
    <rect width="${w}" height="${w * 0.45}" fill="#ffffff" opacity="0.22"/>
  </g>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="${fontSize}" font-weight="650" fill="${palette.fg}" letter-spacing="${text.length > 1 ? -0.6 : 0}">${escapeXml(text)}</text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

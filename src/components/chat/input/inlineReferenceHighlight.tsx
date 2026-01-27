import React from 'react';

export type InlineReferenceKind = 'mcp' | 'skill';

const MCP_RE = /@([a-zA-Z0-9_-]{1,64})/g;
const SKILL_RE = /#([a-zA-Z0-9_-]{1,64})/g;

export function hasInlineReferences(text: string): { mcp: boolean; skill: boolean } {
  if (!text) return { mcp: false, skill: false };
  // 不使用 /g 以避免 lastIndex 副作用
  return {
    mcp: /@([a-zA-Z0-9_-]{1,64})/.test(text),
    skill: /#([a-zA-Z0-9_-]{1,64})/.test(text),
  };
}

function ensureOverlayTail(text: string): string {
  // 已弃用：不要通过“补字符”改变渲染字符串内容，避免任何可能的“原文污染”疑虑。
  // 末尾换行导致的覆盖层空行高度问题，改由容器 ::after 伪元素（仅布局）解决。
  return text;
}

const baseSpanStyle: React.CSSProperties = {
  fontFeatureSettings: '"liga" 0, "clig" 0',
  display: 'inline',
  borderRadius: '2px',
};

const mcpClass =
  'bg-emerald-100/80 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300';
const skillClass =
  'bg-violet-100/80 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300';

const mcpStyle: React.CSSProperties = {
  ...baseSpanStyle,
  boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.15)',
};

const skillStyle: React.CSSProperties = {
  ...baseSpanStyle,
  boxShadow: '0 0 0 2px rgba(139, 92, 246, 0.15)',
};

type Match = { index: number; text: string; kind: InlineReferenceKind };

export function renderInlineReferencesForOverlay(text: string): React.ReactNode[] {
  const src = ensureOverlayTail(text || '');

  const parts: React.ReactNode[] = [];
  const matches: Match[] = [];

  MCP_RE.lastIndex = 0;
  SKILL_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = MCP_RE.exec(src))) matches.push({ index: m.index, text: m[0], kind: 'mcp' });
  while ((m = SKILL_RE.exec(src))) matches.push({ index: m.index, text: m[0], kind: 'skill' });

  matches.sort((a, b) => a.index - b.index);

  let last = 0;
  for (const match of matches) {
    if (match.index > last) parts.push(src.slice(last, match.index));

    if (match.kind === 'mcp') {
      parts.push(
        <span key={`mcp-${match.index}`} className={mcpClass} style={mcpStyle}>
          {match.text}
        </span>
      );
    } else {
      parts.push(
        <span key={`skill-${match.index}`} className={skillClass} style={skillStyle}>
          {match.text}
        </span>
      );
    }

    last = match.index + match.text.length;
  }

  if (last < src.length) parts.push(src.slice(last));
  return parts;
}


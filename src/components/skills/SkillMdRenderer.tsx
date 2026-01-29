'use client';

import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { MemoizedMarkdown } from '@/components/chat/MemoizedMarkdown';

interface SkillMdRendererProps {
  content: string;
  className?: string;
}

/**
 * 简易 Markdown 渲染器
 * 支持基本的 Markdown 语法：标题、段落、列表、代码块、加粗、斜体、链接
 */
export function SkillMdRenderer({ content, className }: SkillMdRendererProps) {
  const markdown = useMemo(() => stripFrontmatter(String(content || '')), [content]);

  return (
    <MemoizedMarkdown
      content={markdown}
      sizeOverride="small"
      className={cn('prose prose-sm dark:prose-invert max-w-none', className)}
    />
  );
}

function stripFrontmatter(md: string): string {
  const s = String(md || '');
  const m = s.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/);
  if (m && m[0]) return s.slice(m[0].length);
  return s;
}


'use client';

import { cn } from '@/lib/utils';
import { useMemo } from 'react';

interface SkillMdRendererProps {
  content: string;
  className?: string;
}

/**
 * 简易 Markdown 渲染器
 * 支持基本的 Markdown 语法：标题、段落、列表、代码块、加粗、斜体、链接
 */
export function SkillMdRenderer({ content, className }: SkillMdRendererProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        // 自定义样式
        'prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-gray-100',
        'prose-h1:text-xl prose-h1:border-b prose-h1:border-gray-200 dark:prose-h1:border-gray-800 prose-h1:pb-2',
        'prose-h2:text-lg prose-h2:mt-6',
        'prose-h3:text-base prose-h3:mt-4',
        'prose-p:text-gray-600 dark:prose-p:text-gray-400',
        'prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline',
        'prose-code:text-pink-600 dark:prose-code:text-pink-400 prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm',
        'prose-pre:bg-gray-900 dark:prose-pre:bg-gray-950 prose-pre:text-gray-100 prose-pre:rounded-lg',
        'prose-ul:list-disc prose-ol:list-decimal',
        'prose-li:text-gray-600 dark:prose-li:text-gray-400',
        'prose-strong:text-gray-900 dark:prose-strong:text-gray-100',
        'prose-blockquote:border-l-4 prose-blockquote:border-gray-300 dark:prose-blockquote:border-gray-700 prose-blockquote:pl-4 prose-blockquote:italic',
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * 简易 Markdown 到 HTML 转换
 */
function renderMarkdown(md: string): string {
  if (!md) return '';

  let html = md;

  // 代码块 (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code.trim());
    return `<pre><code class="language-${lang || 'text'}">${escaped}</code></pre>`;
  });

  // 行内代码 (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 标题 (# ... ######)
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 加粗 (**...** 或 __...__)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // 斜体 (*...* 或 _..._)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 无序列表
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // 有序列表
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  
  // 引用块
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // 水平线
  html = html.replace(/^[-*_]{3,}$/gm, '<hr />');

  // 段落（连续非空行包裹为 <p>）
  const lines = html.split('\n');
  const blocks: string[] = [];
  let currentParagraph: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentParagraph.length > 0) {
        const text = currentParagraph.join(' ');
        // 如果不是已有的 HTML 标签，包裹为 <p>
        if (!isHtmlBlock(text)) {
          blocks.push(`<p>${text}</p>`);
        } else {
          blocks.push(text);
        }
        currentParagraph = [];
      }
    } else {
      currentParagraph.push(trimmed);
    }
  }

  // 处理最后一段
  if (currentParagraph.length > 0) {
    const text = currentParagraph.join(' ');
    if (!isHtmlBlock(text)) {
      blocks.push(`<p>${text}</p>`);
    } else {
      blocks.push(text);
    }
  }

  return blocks.join('\n');
}

/**
 * 检查是否是 HTML 块级元素
 */
function isHtmlBlock(text: string): boolean {
  const blockTags = ['<h1', '<h2', '<h3', '<h4', '<h5', '<h6', '<ul', '<ol', '<li', '<pre', '<blockquote', '<hr', '<p>'];
  return blockTags.some(tag => text.startsWith(tag));
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


"use client";

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Streamdown } from 'streamdown';
import { useMarkdownFontSize } from '@/hooks/useMarkdownFontSize';
// 主题系统已禁用 - 使用Streamdown原生渲染
// import { useMarkdownTheme } from '@/hooks/useMarkdownTheme';
// import { getThemeStyles } from '@/lib/markdown/themes';
import { createMarkdownRenderers } from '@/lib/markdown/renderers';
import { preprocessMarkdownForSafeRender } from './markdownPreprocess';

interface StreamingMarkdownProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

const BASE_THROTTLE_MS = 32; // ~30fps for short content
const MAX_THROTTLE_MS = 200; // Cap at ~5fps for very long content
const DYNAMIC_FACTOR = 0.05; // Increase throttle by 5ms for every 100 chars (approx)

/**
 * 流式Markdown渲染组件
 * 使用 Streamdown 以在流式输出时稳定解析未闭合的 Markdown
 */
export const StreamingMarkdown = React.memo(function StreamingMarkdown({ content, isStreaming, className }: StreamingMarkdownProps) {
  const { size } = useMarkdownFontSize();
  // 主题系统已禁用
  const themeStyles = useMemo(() => ({ headings: { h1: '', h2: '', h3: '', h4: '', h5: '', h6: '' }, paragraph: '', list: { ul: '', ol: '', li: '' }, blockquote: '', code: { inline: '', block: '' }, link: '', hr: '', table: { table: '', th: '', td: '' }, strong: '' }), []);
  
  const { renderers, containerClass } = useMemo(() => createMarkdownRenderers(size, themeStyles), [size, themeStyles]);

  // Throttled content state for display to reduce heavy rendering frequency
  const [displayContent, setDisplayContent] = useState(content);
  const lastUpdateRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // If not streaming or content is very short/empty, update immediately
    // Also if content shrank (cleared) or is identical, update immediately
    if (!isStreaming || content.length < 100 || content.length < displayContent.length) {
      if (content !== displayContent) {
        setDisplayContent(content);
        lastUpdateRef.current = Date.now();
      }
      return;
    }

    // Dynamic throttling based on content length
    // As content grows, rendering becomes more expensive, so we throttle more aggressively
    // to keep the UI responsive.
    const currentThrottleMs = Math.min(
      MAX_THROTTLE_MS,
      BASE_THROTTLE_MS + (content.length * DYNAMIC_FACTOR)
    );

    // During streaming, throttle updates
    const now = Date.now();
    if (now - lastUpdateRef.current >= currentThrottleMs) {
      setDisplayContent(content);
      lastUpdateRef.current = now;
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setDisplayContent(content);
        lastUpdateRef.current = Date.now();
      }, currentThrottleMs);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [content, isStreaming]); // displayContent intentionally omitted

  // Memoize heavy preprocessing
  const safe = useMemo(() => 
    preprocessMarkdownForSafeRender(displayContent, { wrapFullHtmlDocument: true }), 
    [displayContent]
  );

  return (
    <div className={`${containerClass} ${className || ''}`}>
      {/* 关键：禁用 Streamdown 的交互控件/潜在 HTML 预览，确保只展示为 Markdown + 代码块，不执行/不渲染 HTML */}
      <Streamdown
        // ⚠️ 修复：恢复流式动画，提升体验
        // 配合外部的 VISUAL_UPDATE_THROTTLE_MS (50ms)，Streamdown 的内部动画能平滑过渡 chunk 间的跳变
        isAnimating={isStreaming}
        components={renderers}
        controls={false}
        rehypePlugins={[]}
        remarkPlugins={[]}
      >
        {safe}
      </Streamdown>
    </div>
  );
});


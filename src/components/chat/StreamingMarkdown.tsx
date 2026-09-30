"use client";

import React, { useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';
import { useMarkdownFontSize } from '@/hooks/useMarkdownFontSize';
import { createMarkdownRenderers } from '@/lib/markdown/renderers';
import { preprocessMarkdownForSafeRender } from './markdownPreprocess';
import { streamdownRemarkPlugins } from '@/lib/markdown/remarkPlugins';
import { replaceAliasPathsForDisplayWithContext } from '@/lib/filesystemAllowlist/displayPathAliases';
import { convertHtmlBreaksToMd, escapeControlTags, splitOpenFence } from './streamTextPrep';

interface StreamingMarkdownProps {
  content: string;
  /** 流式进行中：此时不做逐行语法高亮，也不显示代码块控件。 */
  isStreaming?: boolean;
  className?: string;
  /** 可选：覆盖全局字号（用于“思考过程”等需要缩小一号的场景）。 */
  sizeOverride?: 'small' | 'medium' | 'large';
  /** 将 @WorkDir/@Alias 路径展示为绝对路径（用于 assistant 最终总结降低歧义）。 */
  resolvePathAliases?: boolean;
  /** 可选：用于解析 @WorkDir 的会话上下文。 */
  contextMessageId?: string;
  contextConversationId?: string;
}

/** 流式期间未闭合代码块的纯文本呈现：排版与 streamdown 的代码块保持一致。 */
function StreamingCodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div
      className="my-4 w-full overflow-hidden rounded-xl border"
      data-code-block-container
      data-language={lang}
      data-streaming-code-block
    >
      <div className="flex items-center justify-between bg-muted/80 p-3 text-muted-foreground text-xs" data-code-block-header>
        <span className="ml-1 font-mono lowercase">{lang}</span>
      </div>
      <pre className="overflow-x-auto whitespace-pre bg-muted/40 p-4 font-mono text-xs">{code}</pre>
    </div>
  );
}

/**
 * 消息正文的 Markdown 渲染入口（流式与最终态共用同一个组件）。
 *
 * 只保留一层节流：内容由调用方按帧给出（store 的 rAF 批处理），这里直接渲染，
 * 不再叠加实例级缓冲（旧的双层节流是"逐字追赶"和初始延迟的来源）。
 */
export const StreamingMarkdown = React.memo(function StreamingMarkdown({
  content,
  isStreaming = false,
  className,
  sizeOverride,
  resolvePathAliases,
  contextMessageId,
  contextConversationId,
}: StreamingMarkdownProps) {
  const { size } = useMarkdownFontSize();
  const effectiveSize = sizeOverride ?? size;

  const themeStyles = useMemo(() => ({
    headings: { h1: '', h2: '', h3: '', h4: '', h5: '', h6: '' },
    paragraph: '',
    list: { ul: '', ol: '', li: '' },
    blockquote: '',
    code: { inline: '', block: '' },
    link: '',
    hr: '',
    table: { table: '', th: '', td: '' },
    strong: '',
  }), []);

  const { renderers, containerClass } = useMemo(
    () => createMarkdownRenderers(effectiveSize, themeStyles),
    [effectiveSize, themeStyles]
  );

  const prepared = useMemo(() => {
    let text = escapeControlTags(content);
    text = convertHtmlBreaksToMd(text);
    if (resolvePathAliases) {
      text = replaceAliasPathsForDisplayWithContext({
        markdown: text,
        messageId: contextMessageId,
        conversationId: contextConversationId,
      });
    }
    const safe = preprocessMarkdownForSafeRender(text, { wrapFullHtmlDocument: true });
    return isStreaming ? splitOpenFence(safe) : { settled: safe, open: null };
  }, [content, isStreaming, resolvePathAliases, contextMessageId, contextConversationId]);

  return (
    <div className={cn(containerClass, className)}>
      <Streamdown
        isAnimating={isStreaming}
        components={renderers}
        controls={!isStreaming}
        remarkPlugins={streamdownRemarkPlugins}
      >
        {prepared.settled}
      </Streamdown>
      {prepared.open && <StreamingCodeBlock lang={prepared.open.lang} code={prepared.open.code} />}
    </div>
  );
});

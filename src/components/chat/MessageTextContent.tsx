"use client";

import { useMemo } from 'react';
import { splitTextAndToolJson } from '@/lib/chat/compactToolJson';
import { CompactToolJsonLine } from './CompactToolJsonLine';
import { StreamingMarkdown } from './StreamingMarkdown';
import { CitationRichText } from './CitationRichText';
import type { Citation } from '@/lib/rag/evidenceTypes';

export function MessageTextContent({
  text,
  isStreaming,
  citations,
}: {
  text: string;
  isStreaming: boolean;
  citations?: Citation[];
}) {
  // 父级每帧都会用新的 text 渲染；切分结果按文本缓存，避免重复扫描。
  const parts = useMemo(() => splitTextAndToolJson(text), [text]);
  const hasToolOnly = parts.length === 1 && parts[0]?.type === 'tool';

  if (hasToolOnly && parts[0]?.tool) {
    return <CompactToolJsonLine tool={parts[0].tool} />;
  }

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'tool' && part.tool) {
          return <CompactToolJsonLine key={`tool-${i}`} tool={part.tool} />;
        }
        const t = part.text.trim();
        if (!t) return null;
        if (citations?.length) {
          return (
            <div key={`text-${i}`} className="prose prose-sm dark:prose-invert max-w-none">
              <CitationRichText text={part.text} citations={citations} isStreaming={isStreaming} />
            </div>
          );
        }
        return (
          <StreamingMarkdown key={`text-${i}`} content={part.text} isStreaming={isStreaming} />
        );
      })}
    </>
  );
}

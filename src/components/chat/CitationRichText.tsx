'use client';

import type { Citation } from '@/lib/rag/evidenceTypes';
import { LazyStreamingMarkdown } from './LazyStreamingMarkdown';

/** Citations enhance the normal Markdown renderer rather than replacing it. */
export function CitationRichText({ text, citations, isStreaming }: {
  text: string;
  citations?: Citation[];
  isStreaming?: boolean;
}) {
  return <LazyStreamingMarkdown content={text} citations={citations} isStreaming={isStreaming} />;
}

'use client';

import { lazy, Suspense } from 'react';
import type { StreamingMarkdownProps } from './StreamingMarkdown';

/**
 * The markdown renderer is the most expensive thing on a page that shows answers:
 * `streamdown` brings shiki, mermaid and katex, and before this they arrived with the chat
 * route's first load - 866 kB of first-load JS, 630 kB of it in one chunk (#153).
 *
 * It is fetched when there is something to render. Until then the raw text is shown under
 * the same wrapper, so the first tokens of an answer are visible instead of a hole; a
 * `next/dynamic` fallback could not do that, because its `loading` component receives no
 * props and would have to render nothing.
 */
const StreamingMarkdown = lazy(() =>
  import('./StreamingMarkdown').then((mod) => ({
    default: mod.StreamingMarkdown,
  })),
);

export function LazyStreamingMarkdown({
  content,
  className,
  ...props
}: StreamingMarkdownProps) {
  return (
    <Suspense
      fallback={
        <div
          className={className}
          data-streaming-markdown-loading
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {content}
        </div>
      }
    >
      <StreamingMarkdown content={content} className={className} {...props} />
    </Suspense>
  );
}

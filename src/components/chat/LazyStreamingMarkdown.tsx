'use client';

import dynamic from 'next/dynamic';
import type { StreamingMarkdownProps } from './StreamingMarkdown';

/**
 * The markdown renderer is the most expensive thing on the chat route: `streamdown` brings
 * shiki, mermaid and katex with it, and they land in one 630 kB chunk - 866 kB of first-load
 * JS for the route, measured from the build's own route table (#153).
 *
 * It is only needed once there is an answer to render, so it is fetched then. The fallback is
 * the raw text under the same wrapper, which is what the reader is waiting for anyway: no
 * blank frame, and no syntax colouring to lose during the load.
 */
export const LazyStreamingMarkdown = dynamic<StreamingMarkdownProps>(
  () => import('./StreamingMarkdown').then((mod) => mod.StreamingMarkdown),
  { ssr: false, loading: () => null },
);

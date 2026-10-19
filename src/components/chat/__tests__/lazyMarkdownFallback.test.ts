/**
 * The fallback half of #153's lazy step, and the part the first version got wrong: it
 * promised "the raw text under the same wrapper, no blank frame" while passing
 * `loading: () => null`, which renders nothing until the chunk resolves. A streamed answer
 * would have begun with a hole where the previous code painted.
 *
 * Rendered to a string in node the way the exported HTML is: the renderer is a `lazy` module
 * that has not loaded yet, so what comes out is the fallback - which is exactly the state a
 * slow chunk load produces in the app.
 */
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LazyStreamingMarkdown } from '../LazyStreamingMarkdown';

// `tsconfig.json` keeps `jsx: "preserve"` for Next, so esbuild's vitest transform falls back
// to the classic runtime, which resolves `React` from scope.
beforeAll(() => vi.stubGlobal('React', React));

describe('a message renders its text while the renderer loads', () => {
  it('shows the raw text instead of nothing', () => {
    const html = renderToStaticMarkup(
      createElement(LazyStreamingMarkdown, {
        content: 'const answer = 42; **done**',
        className: 'prose',
      }),
    );

    expect(html).toContain('data-streaming-markdown-loading');
    expect(html).toContain('const answer = 42; **done**');
    // The fallback keeps the caller's wrapper so the layout does not jump when the real
    // renderer replaces it.
    expect(html).toContain('class="prose"');
  });
});

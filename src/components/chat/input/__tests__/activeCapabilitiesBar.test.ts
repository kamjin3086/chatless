/**
 * The capability bar under the composer is for things the user attached: a knowledge base,
 * MCP servers, a work directory, a document. Session parameters used to earn it a chip of
 * their own, so changing the thinking level made the bar appear and took a row of height -
 * for a setting whose entry is already the ⋯ menu in the header. A row that appears for a
 * parameter change and offers nothing is noise, and the space it takes is a message row.
 *
 * Rendered to a string: the bar is a client component with no hooks that need a DOM, and
 * the assertion is about what it emits when nothing is attached.
 */
import { createElement } from 'react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ActiveCapabilitiesBar } from '../ActiveCapabilitiesBar';

// `tsconfig.json` keeps `jsx: "preserve"` for Next, so esbuild's vitest transform falls back
// to the classic runtime, which resolves `React` from scope.
beforeAll(() => vi.stubGlobal('React', React));

describe('the capability bar takes no space unless something is attached', () => {
  it('renders nothing at all when no capability is active', () => {
    expect(renderToStaticMarkup(createElement(ActiveCapabilitiesBar, {}))).toBe(
      '',
    );
  });

  it('has no session-parameter chip left to occupy a row', () => {
    // The props are gone, so passing the old ones cannot bring the chip back.
    const html = renderToStaticMarkup(
      createElement(ActiveCapabilitiesBar, {
        hasSessionParameters: true,
        onClickSessionParameters: () => {},
      } as any),
    );
    expect(html).toBe('');
  });

  it('still shows what the user attached', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveCapabilitiesBar, {
        selectedKnowledgeBase: { id: 'kb-1', name: '产品文档' } as any,
      }),
    );
    expect(html).toContain('产品文档');
  });
});

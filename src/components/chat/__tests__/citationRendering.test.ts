import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { CitationRichText } from '../CitationRichText';
import type { Citation } from '@/lib/rag/evidenceTypes';

vi.stubGlobal('React', React);
vi.mock('../LazyStreamingMarkdown', async () => {
  const { StreamingMarkdown } = await import('../StreamingMarkdown');
  return { LazyStreamingMarkdown: StreamingMarkdown };
});
vi.mock('@/hooks/useMarkdownFontSize', () => ({
  useMarkdownFontSize: () => ({ size: 'medium' }),
}));
const citations: Citation[] = [
  {
    id: 'E1',
    evidenceId: 'E1',
    n: 1,
    documentId: 'doc',
    documentName: 'Guide',
    locator: { sectionPath: ['Ethiopia'] },
    quote: 'Floral coffee',
  },
];

it('renders raw agent segment markers as source buttons while preserving Markdown', () => {
  const html = renderToStaticMarkup(
    createElement(CitationRichText, {
      text: '**Floral** coffee [[E1]].',
      citations,
    }),
  );
  expect(html).toContain('data-streamdown="strong"');
  expect(html).toContain('查看引用 1');
  expect(html).not.toContain('[[E1]]');
});

it('renders registered single-bracket evidence aliases without guessing unknown labels or code', () => {
  const html = renderToStaticMarkup(
    createElement(CitationRichText, {
      text: '**Fact** [E1]. Unknown [E99]. Example: `[E1]`. [E1](https://example.com)',
      citations,
    }),
  );
  expect(html.match(/aria-label="查看引用 1"/g)).toHaveLength(1);
  expect(html).toContain('[E99]');
  expect(html).toContain('<code');
});

it('renders persisted numbered citations as source buttons', () => {
  const html = renderToStaticMarkup(
    createElement(CitationRichText, {
      text: '**Floral** coffee [1].',
      citations,
    }),
  );
  expect(html).toContain('data-streamdown="strong"');
  expect(html).toContain('查看引用 1');
});

it('keeps citation-like code samples as code, not source buttons', () => {
  const html = renderToStaticMarkup(
    createElement(CitationRichText, {
      text: 'Example: `[[E1]]` and `[1]`.',
      citations,
    }),
  );
  expect(html).toContain('<code');
  expect(html).not.toContain('查看引用 1');
});

it('drops unregistered evidence markers without inventing a citation', () => {
  const html = renderToStaticMarkup(
    createElement(CitationRichText, {
      text: 'Claim [[E99]] and number [99].',
      citations,
    }),
  );
  expect(html).not.toContain('[[E99]]');
  expect(html).toContain('[99]');
  expect(html).not.toContain('查看引用');
});

it('preserves links and fenced code alongside citations', () => {
  const text =
    '[source [1]](https://example.com)\n\n```text\n[[E1]]\n```\n\nFact [[E1]].';
  const html = renderToStaticMarkup(
    createElement(CitationRichText, { text, citations }),
  );
  expect(html).toContain('https://example.com');
  expect(html).toContain('data-streamdown="code-block"');
  expect(html.match(/aria-label="查看引用 1"/g)).toHaveLength(1);
});

import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Message } from '@/types/chat';
import type { Citation } from '@/lib/rag/evidenceTypes';
import { CitationRichText } from '../CitationRichText';
import { VersionedAssistantGroup } from '../VersionedAssistantGroup';

const received = vi.hoisted(() => vi.fn());
vi.stubGlobal('React', React);
vi.mock('../ChatMessage', () => ({
  ChatMessage: (props: {
    id: string;
    content: string;
    segments?: Message['segments'];
    citations?: Citation[];
  }) => {
    received(props);
    const text =
      props.segments
        ?.filter((item) => item.kind === 'text')
        .map((item) => item.text)
        .join('') || props.content;
    return createElement(CitationRichText, {
      text,
      citations: props.citations,
    });
  },
}));
vi.mock('../LazyStreamingMarkdown', async () => ({
  LazyStreamingMarkdown: (await import('../StreamingMarkdown'))
    .StreamingMarkdown,
}));
vi.mock('@/hooks/useMarkdownFontSize', () => ({
  useMarkdownFontSize: () => ({ size: 'medium' }),
}));

it('renders the selected regenerated version with its own source mapping and exact ranges', () => {
  const citation: Citation = {
    id: 'E9',
    evidenceId: 'E9',
    n: 1,
    documentId: 'new-doc',
    documentName: 'New source',
    locator: {},
    quote: 'New source text',
    range: {
      documentId: 'new-doc',
      batchId: 'new-batch',
      chunks: [
        { chunkId: 'new-chunk', chunkIndex: 3, startOffset: 8, endOffset: 23 },
      ],
    },
  };
  const make = (id: string, index: number, citations: Citation[]): Message => ({
    id,
    conversation_id: 'conv',
    role: 'assistant',
    content: '**New** [1]',
    created_at: index,
    updated_at: index,
    status: 'sent',
    version_group_id: 'group',
    version_index: index,
    segments: [{ kind: 'text', text: '**New** [[E9]]' }],
    citations,
  });
  const versions = [make('old', 0, []), make('new', 1, [citation])];
  const html = renderToStaticMarkup(
    createElement(VersionedAssistantGroup, {
      versions,
      onEditMessage: vi.fn(),
    }),
  );
  expect(received).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'new', citations: [citation] }),
  );
  expect(html).toContain('查看引用 1');
  expect(html).toContain('data-streamdown="strong"');
  expect(html).not.toContain('[[E9]]');
});

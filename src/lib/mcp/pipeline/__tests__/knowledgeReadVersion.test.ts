import { beforeEach, expect, it, vi } from 'vitest';
import { KnowledgeAdapter } from '../adapters/KnowledgeAdapter';
import { ToolInvocation } from '../ToolInvocation';
import { CitationSourceReader } from '@/lib/rag/CitationSourceReader';
import {
  clearEvidenceRegistry,
  registerEvidence,
} from '@/lib/rag/EvidenceRegistry';

const { select, openFile } = vi.hoisted(() => ({
  select: vi.fn(),
  openFile: vi.fn(),
}));
vi.mock('@/lib/utils/fileOpener', () => ({ FileOpener: { openFile } }));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({ getDbManager: () => ({ select }) }),
  },
}));
vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: {
    getState: () => ({ getKnowledgeBase: () => ({ id: 'kb' }) }),
  },
}));
vi.mock('@/lib/rag/ragServiceInstance', () => ({ getRAGService: vi.fn() }));

let sourceChunks: Array<{
  id: string;
  chunk_index: number;
  source_text: string;
  locator: string;
}>;

beforeEach(() => {
  sourceChunks = [
    {
      id: 'current-chunk',
      chunk_index: 0,
      source_text: 'Current source',
      locator: '{}',
    },
  ];
  clearEvidenceRegistry('read-version');
  select.mockReset();
  openFile.mockReset();
  openFile.mockResolvedValue(true);
  select.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.includes('conversation_document_mappings')) return [];
    if (sql.includes('doc_knowledge_mappings'))
      return [{ document_id: 'doc' }, { document_id: 'other' }];
    if (sql.includes('FROM documents'))
      return [
        {
          id: args[0],
          title: 'Current document',
          file_path: '/managed/current.txt',
          file_hash: 'current-hash',
          active_index_batch_id: 'current-batch',
        },
      ];
    if (sql.includes('FROM document_chunks')) {
      if (sql.includes('id IN'))
        return sourceChunks.filter((chunk) => args.slice(2).includes(chunk.id));
      return sourceChunks.filter(
        (chunk) => chunk.chunk_index >= Number(args[2]),
      );
    }
    return [];
  });
});

function seed(
  batchId = 'current-batch',
  chunks = [
    { chunkId: 'current-chunk', chunkIndex: 0, startOffset: 0, endOffset: 14 },
  ],
) {
  return registerEvidence('read-version', [
    {
      id: '',
      documentId: 'doc',
      documentName: 'Source',
      documentHash: 'current-hash',
      sourceBlockIds: ['current-chunk'],
      locator: {},
      quote: 'Current source',
      score: 1,
      retrievalChunkId: 'current-chunk',
      range: {
        documentId: 'doc',
        batchId,
        chunks,
      },
    },
  ])[0].id;
}

function sourceReader() {
  return new CitationSourceReader(
    {
      id: 'citation',
      evidenceId: 'E1',
      n: 1,
      documentId: 'doc',
      documentName: 'Source',
      documentPath: '/unsafe/historical.txt',
      documentHash: 'current-hash',
      locator: {},
      quote: 'source',
      range: {
        documentId: 'doc',
        batchId: 'current-batch',
        chunks: [
          {
            chunkId: 'current-chunk',
            chunkIndex: 0,
            startOffset: 8,
            endOffset: 14,
          },
        ],
      },
    },
    'conversation',
  );
}

it('the source view reopens exactly and opens only the current authorized file path', async () => {
  const reader = sourceReader();
  try {
    expect(await reader.read('exact')).toMatchObject({
      ok: true,
      text: 'source',
    });
    expect(await reader.openCurrentFile('en')).toEqual({ ok: true });
    expect(openFile).toHaveBeenCalledWith(
      '/managed/current.txt',
      'Source',
      'en',
    );
  } finally {
    reader.dispose();
  }
});

it('the source view rechecks mounting before reading or opening the original file', async () => {
  const reader = sourceReader();
  const original = select.getMockImplementation();
  select.mockImplementation((sql: string, args: unknown[]) =>
    sql.includes('doc_knowledge_mappings') ? [] : original?.(sql, args),
  );
  try {
    expect(await reader.read('exact')).toMatchObject({ ok: false });
    expect(await reader.openCurrentFile('en')).toEqual({
      ok: false,
      code: 'NO_KNOWLEDGE_BASE',
    });
    expect(openFile).not.toHaveBeenCalled();
  } finally {
    reader.dispose();
  }
});

it('closing a source view prevents an in-flight read from opening an external file', async () => {
  const reader = sourceReader();
  const opening = reader.openCurrentFile('en');
  reader.dispose();
  await expect(opening).rejects.toThrow('Source view was closed');
  expect(openFile).not.toHaveBeenCalled();
});

function read(args: Record<string, unknown>) {
  return new KnowledgeAdapter().execute(
    new ToolInvocation({
      server: 'knowledge',
      tool: 'read',
      args,
      assistantMessageId: 'read-version',
      conversationId: 'conversation',
      provider: 'test',
      model: 'test',
      historyForLlm: [],
      originalUserContent: '',
    }),
  );
}

it('returns the fresh read evidence as a directly copyable canonical citation marker', async () => {
  const requested = seed();
  expect(
    await read({ evidenceId: requested, before: 0, after: 0 }),
  ).toMatchObject({
    ok: true,
    evidenceId: 'E2',
    citationMarker: '[[E2]]',
  });
});

it.each([undefined, -1, 0.5, '0', null])(
  'rejects invalid cursor offsets rather than restarting: %s',
  async (offset) => {
    const cursor = JSON.stringify({
      documentId: 'doc',
      batchId: 'current-batch',
      chunkIndex: 0,
      offset,
    });
    expect(await read({ documentId: 'doc', cursor })).toMatchObject({
      ok: false,
      error: 'CURSOR_INVALID',
    });
  },
);

it('does not split Unicode scalars at a sequential read budget boundary', async () => {
  sourceChunks[0].source_text = `${'a'.repeat(1000)}🪐${'b'.repeat(20)}`;
  const first = await read({ documentId: 'doc', limit: 1001 });
  expect(first).toMatchObject({ text: 'a'.repeat(1000) });
  if (
    !first ||
    typeof first !== 'object' ||
    !('nextCursor' in first) ||
    typeof first.nextCursor !== 'string'
  )
    throw new Error('Expected a source cursor');
  expect(JSON.parse(first.nextCursor).offset).toBe(1000);
  const next = await read({ documentId: 'doc', cursor: first.nextCursor });
  expect(next).toMatchObject({ text: `🪐${'b'.repeat(20)}` });
  const bad = JSON.stringify({
    documentId: 'doc',
    batchId: 'current-batch',
    chunkIndex: 0,
    offset: 1001,
  });
  expect(await read({ documentId: 'doc', cursor: bad })).toMatchObject({
    ok: false,
    error: 'CURSOR_INVALID',
  });
});

it('keeps exact-range continuation on a full Unicode scalar', async () => {
  sourceChunks[0].source_text = `${'a'.repeat(1000)}🪐${'b'.repeat(20)}`;
  const evidenceId = seed('current-batch', [
    {
      chunkId: 'current-chunk',
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 1022,
    },
  ]);
  const first = await read({ evidenceId, before: 0, after: 0, limit: 1001 });
  expect(first).toMatchObject({ text: 'a'.repeat(1000) });
  if (
    !first ||
    typeof first !== 'object' ||
    !('nextCursor' in first) ||
    typeof first.nextCursor !== 'string'
  )
    throw new Error('Expected an exact source cursor');
  const next = await read({ cursor: first.nextCursor });
  expect(next).toMatchObject({ text: `🪐${'b'.repeat(20)}` });
});

it('reopens evidence from the active index batch', async () => {
  expect(await read({ evidenceId: seed(), before: 0, after: 0 })).toMatchObject(
    { ok: true, text: 'Current source' },
  );
});

it('rejects old evidence after reindexing instead of citing replacement text', async () => {
  expect(
    await read({ evidenceId: seed('old-batch'), before: 0, after: 0 }),
  ).toMatchObject({ ok: false, error: 'CURSOR_INVALID' });
});

it('does not apply evidence offsets to a different mounted document', async () => {
  expect(await read({ evidenceId: seed(), documentId: 'other' })).toMatchObject(
    { ok: false, error: 'CURSOR_INVALID' },
  );
});

it('reads only the delivered substring, excluding the rest of the chunk and later chunks', async () => {
  sourceChunks = [
    {
      id: 'current-chunk',
      chunk_index: 0,
      source_text: 'ABCCITE_UNCITED_TAIL',
      locator: '{}',
    },
    { id: 'next', chunk_index: 1, source_text: 'NEXT_SOURCE', locator: '{}' },
  ];
  const evidenceId = seed('current-batch', [
    { chunkId: 'current-chunk', chunkIndex: 0, startOffset: 3, endOffset: 7 },
  ]);
  expect(await read({ evidenceId, before: 0, after: 0 })).toMatchObject({
    ok: true,
    text: 'CITE',
    complete: true,
    nextCursor: undefined,
  });
});

it('honors each delivered range and skips chunks that were not delivered', async () => {
  sourceChunks = [
    {
      id: 'current-chunk',
      chunk_index: 0,
      source_text: 'prefixFIRSTtail',
      locator: '{}',
    },
    { id: 'gap', chunk_index: 1, source_text: 'NOT_DELIVERED', locator: '{}' },
    { id: 'last', chunk_index: 2, source_text: 'xxLASTtail', locator: '{}' },
  ];
  const evidenceId = seed('current-batch', [
    { chunkId: 'current-chunk', chunkIndex: 0, startOffset: 6, endOffset: 11 },
    { chunkId: 'last', chunkIndex: 2, startOffset: 2, endOffset: 6 },
  ]);
  expect(await read({ evidenceId, before: 0, after: 0 })).toMatchObject({
    ok: true,
    text: 'FIRST\n\nLAST',
    complete: true,
  });
});

it('keeps an exact read cursor inside the original delivered range', async () => {
  sourceChunks = [
    {
      id: 'current-chunk',
      chunk_index: 0,
      source_text: 'PREFIX' + 'x'.repeat(1500) + 'UNDELIVERED',
      locator: '{}',
    },
  ];
  const evidenceId = seed('current-batch', [
    {
      chunkId: 'current-chunk',
      chunkIndex: 0,
      startOffset: 6,
      endOffset: 1506,
    },
  ]);
  const first = await read({ evidenceId, before: 0, after: 0, limit: 1000 });
  expect(first).toMatchObject({
    ok: true,
    text: 'x'.repeat(1000),
    complete: false,
  });
  if (!first || typeof first !== 'object' || !('nextCursor' in first))
    throw new Error('Missing continuation');
  expect(
    await read({ documentId: 'doc', cursor: first.nextCursor, limit: 1000 }),
  ).toMatchObject({
    ok: true,
    text: 'x'.repeat(500),
    complete: true,
    nextCursor: undefined,
  });
});

it('rejects an exact cursor after its evidence registry has expired', async () => {
  sourceChunks = [
    {
      id: 'current-chunk',
      chunk_index: 0,
      source_text: 'x'.repeat(1500),
      locator: '{}',
    },
  ];
  const evidenceId = seed('current-batch', [
    {
      chunkId: 'current-chunk',
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 1500,
    },
  ]);
  const first = await read({ evidenceId, before: 0, after: 0, limit: 1000 });
  if (!first || typeof first !== 'object' || !('nextCursor' in first))
    throw new Error('Missing continuation');
  clearEvidenceRegistry('read-version');
  expect(
    await read({ documentId: 'doc', cursor: first.nextCursor }),
  ).toMatchObject({ ok: false, error: 'CURSOR_INVALID' });
});

it('preserves sequential reading and default neighbouring context', async () => {
  sourceChunks.push({
    id: 'next',
    chunk_index: 1,
    source_text: 'Next source',
    locator: '{}',
  });
  expect(await read({ documentId: 'doc' })).toMatchObject({
    ok: true,
    text: 'Current source\n\nNext source',
  });
  expect(await read({ evidenceId: seed() })).toMatchObject({
    ok: true,
    text: 'Current source\n\nNext source',
  });
});

it('does not bypass stale evidence validation with a current cursor', async () => {
  expect(
    await read({
      evidenceId: seed('old-batch'),
      cursor: JSON.stringify({
        documentId: 'doc',
        batchId: 'current-batch',
        chunkIndex: 0,
        offset: 0,
      }),
    }),
  ).toMatchObject({ ok: false, error: 'CURSOR_INVALID' });
});

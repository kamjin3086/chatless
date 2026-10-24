import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeAdapter } from '../KnowledgeAdapter';
import {
  clearEvidenceRegistry,
  registerEvidence,
  restoreEvidence,
} from '@/lib/rag/EvidenceRegistry';

const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({
        select: mocks.select,
        executeTransaction: mocks.transaction,
      }),
    }),
  },
}));
vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: {
    getState: () => ({ getKnowledgeBase: () => ({ id: 'kb' }) }),
  },
}));
vi.mock('@/lib/rag/ragServiceInstance', () => ({ getRAGService: vi.fn() }));
vi.mock('@/lib/rag/retrieveEvidence', () => ({ retrieveEvidence: vi.fn() }));

const RUN = 'stale-evidence-run';

beforeEach(() => {
  vi.resetAllMocks();
  clearEvidenceRegistry(RUN);
  mocks.transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: async () => {} }),
  );
  mocks.select.mockImplementation(async (sql: string, args: any[]) => {
    if (sql.includes('conversation_document_mappings')) return [];
    if (sql.includes('doc_knowledge_mappings')) return [{ document_id: 'doc' }];
    if (sql.includes('FROM documents')) {
      return [
        {
          id: 'doc',
          title: 'Revised',
          file_hash: 'new-hash',
          active_index_batch_id: 'new-batch',
        },
      ];
    }
    if (sql.includes('FROM document_chunks')) {
      return [
        {
          id: 'new-chunk',
          chunk_index: args[2],
          source_text: 'NEW UNRELATED CONTENT',
          locator: '{}',
        },
      ];
    }
    return [];
  });
});

function seed(batchId: string): string {
  return registerEvidence(RUN, [
    {
      id: '',
      documentId: 'doc',
      documentName: 'Original',
      documentHash: 'old-hash',
      sourceBlockIds: [],
      locator: {},
      quote: 'ORIGINAL CONTENT',
      score: 1,
      retrievalChunkId: 'old-chunk',
      range: {
        documentId: 'doc',
        batchId,
        chunks: [
          {
            chunkId: 'old-chunk',
            chunkIndex: 3,
            startOffset: 0,
            endOffset: 16,
          },
        ],
      },
    },
  ])[0].id;
}

function read(args: Record<string, unknown>) {
  return new KnowledgeAdapter().execute({
    server: 'knowledge',
    tool: 'read',
    args,
    assistantMessageId: RUN,
    conversationId: 'conversation',
  } as any) as Promise<any>;
}

describe('knowledge read evidence identity', () => {
  it('control: a citation from the current batch still reads', async () => {
    const result = await read({
      evidenceId: seed('new-batch'),
      before: 0,
      after: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('NEW UNRELATED CONTENT');
  });

  it('rejects a stale evidence range after the document was re-indexed', async () => {
    const result = await read({
      evidenceId: seed('old-batch'),
      before: 0,
      after: 0,
    });
    expect(result).toMatchObject({ ok: false, error: 'CURSOR_INVALID' });
  });

  it('also rejects a restored citation snapshot from the old batch', async () => {
    const id = seed('old-batch');
    clearEvidenceRegistry(RUN);
    restoreEvidence(RUN, [
      {
        id,
        documentId: 'doc',
        documentName: 'Original',
        documentHash: 'old-hash',
        sourceBlockIds: [],
        locator: {},
        quote: 'ORIGINAL CONTENT',
        score: 0,
        retrievalChunkId: 'old-chunk',
        range: {
          documentId: 'doc',
          batchId: 'old-batch',
          chunks: [
            {
              chunkId: 'old-chunk',
              chunkIndex: 3,
              startOffset: 0,
              endOffset: 16,
            },
          ],
        },
      },
    ]);

    const result = await read({ evidenceId: id, before: 0, after: 0 });
    expect(result).toMatchObject({ ok: false, error: 'CURSOR_INVALID' });
  });

  it('control: an explicit cursor from the current batch is accepted', async () => {
    const result = await read({
      documentId: 'doc',
      cursor: JSON.stringify({
        documentId: 'doc',
        batchId: 'new-batch',
        chunkIndex: 3,
        offset: 0,
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('an explicit cursor from an older batch is rejected', async () => {
    const result = await read({
      documentId: 'doc',
      cursor: JSON.stringify({
        documentId: 'doc',
        batchId: 'old-batch',
        chunkIndex: 3,
        offset: 0,
      }),
    });
    expect(result).toMatchObject({ ok: false, error: 'CURSOR_INVALID' });
  });
});

// Audit probes: intentionally outside the normal suite. Red assertions specify expected behavior.
import { beforeEach, expect, it, vi } from 'vitest';
import { KnowledgeAdapter } from '@/lib/mcp/pipeline/adapters/KnowledgeAdapter';
import {
  clearEvidenceRegistry,
  registerEvidence,
} from '@/lib/rag/EvidenceRegistry';
import { waitForCallApproval } from '@/lib/mcp/pipeline/approvalWait';
import { useAuthorizationStore } from '@/store/authorizationStore';

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

beforeEach(() => {
  vi.resetAllMocks();
  clearEvidenceRegistry('audit');
  useAuthorizationStore.setState({ pendingAuthorizations: new Map() });
  mocks.transaction.mockImplementation(async (fn) =>
    fn({ execute: async () => {} }),
  );
  mocks.select.mockImplementation(async (sql: string, args: any[]) => {
    if (sql.includes('conversation_document_mappings')) return [];
    if (sql.includes('doc_knowledge_mappings')) return [{ document_id: 'doc' }];
    if (sql.includes('FROM documents'))
      return [
        {
          id: 'doc',
          title: 'Revised',
          file_hash: 'new-hash',
          active_index_batch_id: 'new-batch',
        },
      ];
    if (sql.includes('FROM document_chunks'))
      return [
        {
          id: 'new-chunk',
          chunk_index: args[2],
          source_text: 'NEW UNRELATED CONTENT',
          locator: '{}',
        },
      ];
    return [];
  });
});
function seed(batchId: string) {
  return registerEvidence('audit', [
    {
      id: '',
      documentId: 'doc',
      documentName: 'Original',
      documentHash: batchId === 'new-batch' ? 'new-hash' : 'old-hash',
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
    assistantMessageId: 'audit',
    conversationId: 'conversation',
  } as any) as Promise<any>;
}
it('control: a stale explicit cursor is rejected', async () => {
  const result = await read({
    documentId: 'doc',
    cursor: JSON.stringify({
      documentId: 'doc',
      batchId: 'old-batch',
      chunkIndex: 3,
      offset: 0,
    }),
  });
  expect(result.error).toBe('CURSOR_INVALID');
});
it('control: a current evidence range is readable', async () => {
  const result = await read({
    evidenceId: seed('new-batch'),
    before: 0,
    after: 0,
  });
  expect(result.ok).toBe(true);
});
it('rejects a stale evidence range after document re-indexing', async () => {
  const result = await read({
    evidenceId: seed('old-batch'),
    before: 0,
    after: 0,
  });
  console.log('stale evidence read:', JSON.stringify(result));
  expect(result.error).toBe('CURSOR_INVALID');
});
const approval = {
  id: 'approval',
  runId: 'run',
  conversationId: 'conversation',
  server: 'fs',
  tool: 'write',
  args: {},
};
it('control: rejecting an already registered approval settles the waiter', async () => {
  const waiting = waitForCallApproval(approval);
  await vi.waitFor(() =>
    expect(
      useAuthorizationStore.getState().hasPendingAuthorization('approval'),
    ).toBe(true),
  );
  useAuthorizationStore.getState().rejectAuthorizationsByMessageId('run');
  expect((await waiting).approved).toBe(false);
});
it('settles approval when Stop happens during approval persistence', async () => {
  let release!: () => void;
  mocks.transaction.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const waiting = waitForCallApproval(approval);
  // Exact UI order: coordinator/runner cancelled, then currently registered approvals rejected.
  // Neither cancellation source is observed by waitForCallApproval; rejection is its only wake-up.
  useAuthorizationStore.getState().rejectAuthorizationsByMessageId('run');
  release();
  const outcome = await Promise.race([
    waiting.then(() => 'settled'),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('still-waiting'), 40),
    ),
  ]);
  console.log(
    'after Stop:',
    outcome,
    'pending approval:',
    useAuthorizationStore.getState().hasPendingAuthorization('approval'),
  );
  // Release the probe's own waiter before asserting.
  useAuthorizationStore.getState().rejectAuthorizationsByMessageId('run');
  await waiting;
  expect(outcome).toBe('settled');
});

// Acceptance requirements, deliberately outside the normal regression suite.
// Run: pnpm exec vitest run --config docs/acceptance/vitest.config.ts
import { beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { LexicalRetriever } from '@/lib/retrieval/LexicalRetriever';
import { KnowledgeAdapter } from '@/lib/mcp/pipeline/adapters/KnowledgeAdapter';
import type { ToolInvocation } from '@/lib/mcp/pipeline/ToolInvocation';
import { clearEvidenceRegistry, readEvidence } from '@/lib/rag/EvidenceRegistry';
import { ContextWindowManager } from '@/lib/mcp/pipeline/context/ContextWindowManager';
import { ConversationEventLog } from '@/lib/mcp/pipeline/context/ConversationEventLog';

const mocks = vi.hoisted(() => ({ select: vi.fn(), retrieve: vi.fn(), chat: vi.fn() }));
vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: { getInstance: () => ({ getDbManager: () => ({ select: mocks.select }) }) },
}));
vi.mock('@/store/conversationAttachmentStore', () => ({
  useConversationAttachmentStore: { getState: () => ({ getKnowledgeBase: () => ({ id: 'kb' }) }) },
}));
vi.mock('@/lib/rag/ragServiceInstance', () => ({
  getRAGService: async () => ({ getEmbeddingService: () => ({}), getRetrievalServiceInstance: () => ({}) }),
}));
vi.mock('@/lib/rag/retrieveEvidence', () => ({ retrieveEvidence: mocks.retrieve }));
vi.mock('@/lib/llm', () => ({ chat: mocks.chat }));
vi.mock('@/lib/retrieval/tokenizeForFts', () => ({ tokenizeForFts: async (value: string) => value }));

beforeEach(() => {
  vi.resetAllMocks();
  clearEvidenceRegistry('audit');
  mocks.retrieve.mockResolvedValue({ evidence: [], mode: 'lexical' });
  mocks.chat.mockResolvedValue({ content: 'Preserved constraints and completed work.' });
  mocks.select.mockImplementation(async (sql: string) => {
    if (sql.includes('conversation_document_mappings')) return [];
    if (sql.includes('doc_knowledge_mappings')) return [{ document_id: 'doc' }, { document_id: 'other' }];
    if (sql.includes('FROM documents')) return [{ id: 'doc', title: 'Test', file_hash: 'hash', active_index_batch_id: 'batch' }];
    if (sql.includes('FROM document_chunks')) return [{ id: 'chunk', chunk_index: 0, source_text: 'a'.repeat(1000) + 'b'.repeat(1000), locator: '{}' }];
    return [];
  });
});

function invoke(tool: string, args: Record<string, unknown>) {
  return new KnowledgeAdapter().execute({ server: 'knowledge', tool, args,
    assistantMessageId: 'audit', conversationId: 'conversation' } as ToolInvocation) as Promise<any>;
}

it('rejects a malformed read cursor instead of silently restarting at the beginning', async () => {
  const result = await invoke('read', { documentId: 'doc', cursor: 'invalid-json' });
  expect(result.error).toBe('CURSOR_INVALID');
});

it('can reopen a sequential-reading citation at its delivered text range', async () => {
  const result = await invoke('read', { documentId: 'doc', limit: 1000,
    cursor: JSON.stringify({ documentId: 'doc', batchId: 'batch', chunkIndex: 0, offset: 1000 }) });
  expect(readEvidence('audit', result.evidenceId)?.quote).toBe('b'.repeat(1000));
  const reopened = await invoke('read', { evidenceId: result.evidenceId, limit: 1000, before: 0, after: 0 });
  expect(reopened.text).toBe(result.text);
});

it('passes a model-selected document restriction to the retrieval facade', async () => {
  await invoke('search', { query: 'needle', documentIds: ['doc'] });
  const passed = mocks.retrieve.mock.calls[0][0];
  expect(passed.documentIds).toEqual(['doc']);
});

it('compacts large completed history through bounded segments', async () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: 'important fact '.repeat(600),
  }));
  history.push({ role: 'user', content: 'Continue with the preserved constraints.' });
  const result = await new ContextWindowManager().compact(history, {
    provider: 'test', model: 'test', contextWindowTokens: 8192,
    allowSummarize: true, keepLastN: 1,
  });
  expect(result.at(-1)?.content).toContain('Continue');
  expect(mocks.chat).toHaveBeenCalled();
});

it('distinguishes an unstarted persisted call from an unknown side effect', () => {
  const log = new ConversationEventLog();
  log.append({ type: 'tool_call_requested', callId: 'call', server: 'fs', tool: 'write', args: {} });
  const output = log.renderForModel('tool_role').find((item) => item.role === 'tool');
  expect(JSON.parse(String(output?.content)).resultStatus).not.toBe('unknown');
});

it('finds both mounted library and attached documents with the production SQL on real SQLite', async () => {
  const python = `import json, sqlite3, sys
request = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.executescript('''
CREATE TABLE documents(id TEXT PRIMARY KEY, active_index_batch_id TEXT);
CREATE TABLE document_chunks(id TEXT PRIMARY KEY, document_id TEXT, batch_id TEXT, source_text TEXT, metadata TEXT, locator TEXT);
CREATE TABLE doc_knowledge_mappings(document_id TEXT, knowledge_base_id TEXT);
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(chunk_id UNINDEXED, search_text);
INSERT INTO documents VALUES ('library','b1'),('attachment','b2');
INSERT INTO document_chunks VALUES ('c1','library','b1','needle','{}','{}'),('c2','attachment','b2','needle','{}','{}');
INSERT INTO doc_knowledge_mappings VALUES ('library','kb');
INSERT INTO document_chunks_fts VALUES ('c1','needle'),('c2','needle');
''')
print(json.dumps([dict(row) for row in db.execute(request['sql'], request['params'])]))
`;
  // The retriever may issue a candidate query and then a scoped fallback, so
  // every statement runs against the real SQLite engine.
  mocks.select.mockImplementation(async (sql: string, params: unknown[]) => JSON.parse(
    execFileSync('python', ['-c', python], { input: JSON.stringify({ sql, params }), encoding: 'utf8' }),
  ));
  const results = await new LexicalRetriever().search('needle', {
    knowledgeBaseIds: ['kb'], documentIds: ['attachment'],
  });
  expect(results.map((item) => item.id).sort()).toEqual(['c1', 'c2']);
});

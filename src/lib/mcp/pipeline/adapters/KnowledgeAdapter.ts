import { KNOWLEDGE_SERVER_NAME } from '@/lib/mcp/nativeTools/knowledge';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { getRAGService } from '@/lib/rag/ragServiceInstance';
import { retrieveEvidence } from '@/lib/rag/retrieveEvidence';
import { registerEvidence, readEvidence } from '@/lib/rag/EvidenceRegistry';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { Evidence, SourceLocator } from '@/lib/rag/evidenceTypes';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

type Scope = { knowledgeBaseIds: string[]; attachmentDocumentIds: string[]; documentIds: string[] };
type Cursor = { documentId: string; batchId: string; chunkIndex: number; offset: number };

function int(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function charLimit(value: unknown): number {
  return Math.min(32000, Math.max(1000, int(value, 8000)));
}

function object(value: unknown): Record<string, any> {
  try { return typeof value === 'string' ? JSON.parse(value || '{}') : (value || {}) as Record<string, any>; }
  catch { return {}; }
}

async function resolveScope(conversationId: string, args: Record<string, any>): Promise<Scope> {
  const mounted = useConversationAttachmentStore.getState().getKnowledgeBase(conversationId)?.id;
  const requestedKb = Array.isArray(args.knowledgeBaseIds) ? args.knowledgeBaseIds.map(String) : [];
  const knowledgeBaseIds = mounted && (!requestedKb.length || requestedKb.includes(mounted)) ? [mounted] : [];
  const db = DatabaseService.getInstance().getDbManager();
  const attachmentRows = await db.select<{ document_id: string }>(
    'SELECT document_id FROM conversation_document_mappings WHERE conversation_id = ?', [conversationId],
  );
  let attachmentDocumentIds = attachmentRows.map((row) => row.document_id);
  const requestedDocs = Array.isArray(args.documentIds) ? new Set(args.documentIds.map(String)) : null;
  if (requestedDocs?.size) attachmentDocumentIds = attachmentDocumentIds.filter((id) => requestedDocs.has(id));
  const kbDocumentRows = knowledgeBaseIds.length
    ? await db.select<{ document_id: string }>(
        `SELECT document_id FROM doc_knowledge_mappings WHERE knowledge_base_id IN (${knowledgeBaseIds.map(() => '?').join(',')})`,
        knowledgeBaseIds,
      ) : [];
  let documentIds = [...new Set([...attachmentDocumentIds, ...kbDocumentRows.map((row) => row.document_id)])];
  if (requestedDocs?.size) documentIds = documentIds.filter((id) => requestedDocs.has(id));
  return { knowledgeBaseIds, attachmentDocumentIds, documentIds };
}

function parseCursor(value: unknown, documentId: string): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value)) as Cursor;
    if (parsed.documentId !== documentId || !parsed.batchId) return null;
    return { ...parsed, chunkIndex: int(parsed.chunkIndex), offset: int(parsed.offset) };
  } catch { return null; }
}

function cite(runId: string, params: {
  documentId: string; documentName: string; documentHash?: string; chunkIds: string[];
  locator: SourceLocator; quote: string; score?: number; retrievalChunkId?: string;
}): Evidence {
  return registerEvidence(runId, [{
    id: '', documentId: params.documentId, documentName: params.documentName,
    documentHash: params.documentHash, sourceBlockIds: params.chunkIds,
    locator: params.locator, quote: params.quote, score: params.score || 0,
    retrievalChunkId: params.retrievalChunkId,
  }])[0];
}

export class KnowledgeAdapter implements ToolAdapter {
  readonly server = KNOWLEDGE_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === KNOWLEDGE_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').toLowerCase();
    const args = (invocation.args || {}) as Record<string, any>;
    const runId = invocation.assistantMessageId;
    const scope = await resolveScope(invocation.conversationId, args);
    const db = DatabaseService.getInstance().getDbManager();

    if (tool === 'list') {
      if (!scope.documentIds.length) return { ok: true, documents: [], complete: true };
      const rows = await db.select<any>(`SELECT d.id, d.title, d.file_type, d.file_size, d.lexical_status,
        d.semantic_status, d.file_hash, COUNT(c.id) AS chunk_count, COALESCE(SUM(LENGTH(c.source_text)), 0) AS indexed_chars
        FROM documents d LEFT JOIN document_chunks c ON c.batch_id = d.active_index_batch_id
        WHERE d.id IN (${scope.documentIds.map(() => '?').join(',')}) GROUP BY d.id ORDER BY d.title`, scope.documentIds);
      const start = int(args.cursor);
      const limit = Math.min(100, Math.max(1, int(args.limit, 50)));
      const documents = rows.slice(start, start + limit).map((row) => ({
        documentId: row.id, name: row.title, fileType: row.file_type, fileSize: Number(row.file_size || 0),
        indexed: row.lexical_status === 'ready' && Number(row.chunk_count) > 0,
        keywordIndexed: row.lexical_status === 'ready', semanticIndexed: row.semantic_status === 'ready',
        processingStatus: row.lexical_status, indexedChars: Number(row.indexed_chars || 0),
        documentHash: row.file_hash,
        source: scope.attachmentDocumentIds.includes(row.id) ? 'session_attachment' : 'knowledge_base',
      }));
      return { ok: true, documents, nextCursor: start + limit < rows.length ? String(start + limit) : undefined,
        complete: start + limit >= rows.length };
    }

    if (!scope.documentIds.length) {
      return { ok: false, error: 'NO_KNOWLEDGE_BASE', message: '当前会话没有可访问的知识库或附件。' };
    }

    if (tool === 'search') {
      const query = String(args.query || '').trim();
      if (!query) return { ok: false, error: 'QUERY_REQUIRED', message: 'query is required' };
      const rag = await getRAGService();
      const result = await retrieveEvidence({ query, knowledgeBaseIds: scope.knowledgeBaseIds,
        documentIds: scope.attachmentDocumentIds, embeddingService: rag.getEmbeddingService(),
        retrievalService: rag.getRetrievalServiceInstance(), topK: Math.min(100, Math.max(1, int(args.limit, 8))),
        requestId: runId });
      // Only this bounded snippet is delivered to the model and therefore eligible for citation.
      const delivered = registerEvidence(runId, result.evidence.map((item) => ({ ...item, quote: item.quote.slice(0, 400) })));
      return { ok: true, mode: result.mode, results: delivered.map((ev) => ({ evidenceId: ev.id,
        document: ev.documentName, page: ev.locator.page, section: ev.locator.sectionPath?.join(' > '),
        score: ev.score, snippet: ev.quote })) };
    }

    if (tool !== 'read') return { ok: false, error: `Unknown tool: ${tool}` };
    const evidenceId = String(args.evidenceId || '').trim();
    const prior = evidenceId ? readEvidence(runId, evidenceId) : undefined;
    const documentId = String(args.documentId || prior?.documentId || '').trim();
    if (!documentId || !scope.documentIds.includes(documentId)) {
      return { ok: false, error: 'DOCUMENT_NOT_FOUND', message: '文档不存在或当前会话未挂载该文档。' };
    }
    const docs = await db.select<any>('SELECT id, title, file_hash, active_index_batch_id FROM documents WHERE id = ? LIMIT 1', [documentId]);
    const document = docs[0];
    if (!document?.active_index_batch_id) return { ok: false, error: 'INDEX_NOT_READY', message: '文档尚未建立关键词索引。' };

    if (prior?.retrievalChunkId) {
      const hit = await db.select<any>('SELECT chunk_index FROM document_chunks WHERE id = ? AND batch_id = ?',
        [prior.retrievalChunkId, document.active_index_batch_id]);
      if (!hit.length) return { ok: false, error: 'CURSOR_INVALID', message: '文档已重建，请重新搜索。' };
      const before = Math.min(32, int(args.before, 1));
      const after = Math.min(32, int(args.after, 1));
      const rows = await db.select<any>(`SELECT * FROM document_chunks WHERE document_id = ? AND batch_id = ?
        AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index`, [documentId, document.active_index_batch_id,
        Number(hit[0].chunk_index) - before, Number(hit[0].chunk_index) + after]);
      const full = rows.map((row) => String(row.source_text)).join('\n\n');
      const text = full.slice(0, charLimit(args.limit));
      const locator = object(rows[0]?.locator);
      const delivered = cite(runId, { documentId, documentName: document.title, documentHash: document.file_hash,
        chunkIds: rows.map((row) => row.id), locator, quote: text, retrievalChunkId: prior.retrievalChunkId });
      return { ok: true, evidenceId: delivered.id, document: document.title, text, truncated: text.length < full.length };
    }

    const cursor = parseCursor(args.cursor, documentId);
    if (cursor && cursor.batchId !== document.active_index_batch_id) {
      return { ok: false, error: 'CURSOR_INVALID', message: '文档已重建，该阅读游标已失效。' };
    }
    const batchId = document.active_index_batch_id as string;
    const startIndex = cursor?.chunkIndex || 0;
    let offset = cursor?.offset || 0;
    const page = args.page == null ? undefined : Number(args.page);
    const rows = await db.select<any>(`SELECT * FROM document_chunks WHERE document_id = ? AND batch_id = ?
      AND chunk_index >= ? ORDER BY chunk_index`, [documentId, batchId, startIndex]);
    const filtered = page == null ? rows : rows.filter((row) => {
      const locator = object(row.locator); return Number(locator.page) === page || Number(locator.pageEnd) === page;
    });
    const limit = charLimit(args.limit);
    const parts: string[] = [];
    const deliveredRows: any[] = [];
    let next: Cursor | undefined;
    let remaining = limit;
    for (const row of filtered) {
      const source = String(row.source_text || '');
      const slice = source.slice(offset, offset + remaining);
      if (slice) { parts.push(slice); deliveredRows.push(row); remaining -= slice.length; }
      if (offset + slice.length < source.length) {
        next = { documentId, batchId, chunkIndex: Number(row.chunk_index), offset: offset + slice.length }; break;
      }
      offset = 0;
      if (remaining <= 0) { next = { documentId, batchId, chunkIndex: Number(row.chunk_index) + 1, offset: 0 }; break; }
    }
    const text = parts.join('\n\n');
    const last = deliveredRows.at(-1);
    if (!next && last && rows.some((row) => Number(row.chunk_index) > Number(last.chunk_index))) {
      next = { documentId, batchId, chunkIndex: Number(last.chunk_index) + 1, offset: 0 };
    }
    const firstLocator = object(deliveredRows[0]?.locator);
    const lastLocator = object(last?.locator);
    const delivered = cite(runId, { documentId, documentName: document.title, documentHash: document.file_hash,
      chunkIds: deliveredRows.map((row) => row.id), locator: { page: firstLocator.page, sectionPath: firstLocator.sectionPath,
        lineStart: firstLocator.lineStart, lineEnd: lastLocator.lineEnd, paragraphIndex: startIndex }, quote: text });
    return { ok: true, documentId, evidenceId: delivered.id, text, page,
      nextCursor: next ? JSON.stringify(next) : undefined, complete: !next };
  }
}

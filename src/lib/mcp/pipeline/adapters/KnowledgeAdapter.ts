import { KNOWLEDGE_SERVER_NAME } from '@/lib/mcp/nativeTools/knowledge';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { getRAGService } from '@/lib/rag/ragServiceInstance';
import { retrieveEvidence } from '@/lib/rag/retrieveEvidence';
import { registerEvidence, readEvidence } from '@/lib/rag/EvidenceRegistry';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { DeliveredRange, Evidence, SourceLocator } from '@/lib/rag/evidenceTypes';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

/** Search snippets are bounded to this many characters before they reach the model. */
const SEARCH_SNIPPET_CHARS = 400;
const CHUNK_PAGE_SIZE = 20;

type Scope = { knowledgeBaseIds: string[]; attachmentDocumentIds: string[]; documentIds: string[] };
type Cursor = { documentId: string; batchId: string; chunkIndex: number; offset: number };
type DeliveredChunk = {
  chunkId: string; chunkIndex: number; startOffset: number; endOffset: number;
  locator: Record<string, any>; sourceText: string;
};

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
  const attachmentDocumentIds = attachmentRows.map((row) => row.document_id);
  const kbDocumentRows = knowledgeBaseIds.length
    ? await db.select<{ document_id: string }>(
        `SELECT document_id FROM doc_knowledge_mappings WHERE knowledge_base_id IN (${knowledgeBaseIds.map(() => '?').join(',')})`,
        knowledgeBaseIds,
      ) : [];
  // The mounted library and the session attachments are additive scope sources.
  // A model-supplied list can only narrow this set, never widen it.
  let documentIds = [...new Set([...attachmentDocumentIds, ...kbDocumentRows.map((row) => row.document_id)])];
  const requestedDocs = Array.isArray(args.documentIds) ? new Set(args.documentIds.map(String)) : null;
  if (requestedDocs?.size) documentIds = documentIds.filter((id) => requestedDocs.has(id));
  documentIds = documentIds.filter(Boolean);
  return { knowledgeBaseIds, attachmentDocumentIds, documentIds };
}

function hasCursorArg(value: unknown): boolean {
  return value != null && String(value).trim() !== '';
}

/**
 * Strict cursor parsing. A malformed cursor must be rejected, otherwise the
 * read silently restarts at the beginning of the document and the model
 * believes it continued where it stopped.
 */
function parseCursor(value: unknown): Cursor | null {
  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    if (!raw || typeof raw !== 'object') return null;
    const parsed = raw as Cursor;
    if (!parsed.documentId || !parsed.batchId) return null;
    if (!Number.isFinite(Number(parsed.chunkIndex)) || Number(parsed.chunkIndex) < 0) return null;
    return { documentId: String(parsed.documentId), batchId: String(parsed.batchId),
      chunkIndex: int(parsed.chunkIndex), offset: int(parsed.offset) };
  } catch {
    return null;
  }
}

/** The anchor a citation reopens at: the first character actually delivered. */
function anchorFromEvidence(prior: Evidence): { chunkIndex: number; offset: number } | null {
  const first = prior.range?.chunks?.[0];
  if (first) return { chunkIndex: first.chunkIndex, offset: first.startOffset };
  if (prior.retrievalChunkId) return { chunkIndex: -1, offset: 0 };
  return null;
}

function locatorFor(delivered: DeliveredChunk[], fallbackIndex: number): SourceLocator {
  const first = delivered[0];
  const last = delivered[delivered.length - 1];
  return {
    page: first?.locator?.page,
    sectionPath: first?.locator?.sectionPath,
    lineStart: first?.locator?.lineStart,
    lineEnd: last?.locator?.lineEnd ?? first?.locator?.lineEnd,
    paragraphIndex: first?.locator?.paragraphIndex ?? fallbackIndex,
  };
}

function rangeFor(documentId: string, batchId: string, delivered: DeliveredChunk[]): DeliveredRange {
  return {
    documentId,
    batchId,
    chunks: delivered.map((chunk) => ({
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    })),
  };
}

function citeDelivery(runId: string, params: {
  documentId: string; documentName: string; documentHash?: string; batchId: string;
  delivered: DeliveredChunk[]; locator: SourceLocator; quote: string; retrievalChunkId?: string;
}): Evidence {
  return registerEvidence(runId, [{
    id: '', documentId: params.documentId, documentName: params.documentName,
    documentHash: params.documentHash,
    sourceBlockIds: params.delivered.map((chunk) => chunk.chunkId),
    locator: params.locator, quote: params.quote, score: 0,
    retrievalChunkId: params.retrievalChunkId || params.delivered[0]?.chunkId,
    range: rangeFor(params.documentId, params.batchId, params.delivered),
  }])[0];
}

/**
 * Bounded sequential read over document-owned chunks. Only the chunks needed
 * to satisfy `charLimit` are fetched, and every delivered character is tracked
 * so the citation maps to what the model actually received.
 */
async function readBounded(params: {
  db: { select<T = any>(sql: string, params?: unknown[]): Promise<T[]> };
  documentId: string;
  batchId: string;
  startChunkIndex: number;
  startOffset: number;
  charLimit: number;
  endChunkIndex?: number;
  page?: number;
}): Promise<{ text: string; delivered: DeliveredChunk[]; nextCursor?: Cursor; complete: boolean }> {
  const delivered: DeliveredChunk[] = [];
  const parts: string[] = [];
  let remaining = params.charLimit;
  let scanIndex = params.startChunkIndex;
  let scanOffset = params.startOffset;
  let nextCursor: Cursor | undefined;
  let complete = false;
  let stoppedByLimit = false;

  for (;;) {
    const rows = await params.db.select<any>(
      `SELECT id, chunk_index, source_text, locator FROM document_chunks
        WHERE document_id = ? AND batch_id = ? AND chunk_index >= ?
        ORDER BY chunk_index LIMIT ?`,
      [params.documentId, params.batchId, scanIndex, CHUNK_PAGE_SIZE],
    );
    if (!rows?.length) { complete = true; break; }
    let consumedPage = true;
    for (const row of rows) {
      const chunkIndex = Number(row.chunk_index);
      if (params.endChunkIndex != null && chunkIndex > params.endChunkIndex) { complete = true; consumedPage = false; break; }
      if (params.page != null) {
        const locator = object(row.locator);
        if (Number(locator.page) !== params.page && Number(locator.pageEnd) !== params.page) continue;
      }
      const source = String(row.source_text || '');
      const slice = source.slice(scanOffset, scanOffset + Math.max(0, remaining));
      if (slice) {
        parts.push(slice);
        delivered.push({ chunkId: String(row.id), chunkIndex, startOffset: scanOffset,
          endOffset: scanOffset + slice.length, locator: object(row.locator), sourceText: source });
        remaining -= slice.length;
      }
      const consumedTo = scanOffset + slice.length;
      if (consumedTo < source.length) {
        nextCursor = { documentId: params.documentId, batchId: params.batchId, chunkIndex, offset: consumedTo };
        consumedPage = false;
        stoppedByLimit = true;
      } else {
        scanOffset = 0;
        if (remaining <= 0) {
          nextCursor = { documentId: params.documentId, batchId: params.batchId, chunkIndex: chunkIndex + 1, offset: 0 };
          consumedPage = false;
          stoppedByLimit = true;
        }
      }
      if (!consumedPage) break;
    }
    if (!consumedPage) break;
    if (rows.length < CHUNK_PAGE_SIZE) { complete = true; break; }
    scanIndex = Number(rows[rows.length - 1].chunk_index) + 1;
  }

  // A cursor that points past the final chunk would make the model believe more
  // text exists.  Verify the continuation before advertising it.
  if (nextCursor && stoppedByLimit && !complete) {
    const probe = await params.db.select<any>(
      `SELECT chunk_index FROM document_chunks WHERE document_id = ? AND batch_id = ? AND chunk_index >= ? LIMIT 1`,
      [params.documentId, params.batchId, nextCursor.chunkIndex],
    );
    if (!probe?.length) { nextCursor = undefined; complete = true; }
  }
  return { text: parts.join('\n\n'), delivered, nextCursor, complete };
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
      // Every retrieval path receives the same document scope: mounted library
      // documents plus session attachments, narrowed by the model's selection.
      const result = await retrieveEvidence({ query, knowledgeBaseIds: [],
        documentIds: scope.documentIds, embeddingService: rag.getEmbeddingService(),
        retrievalService: rag.getRetrievalServiceInstance(), topK: Math.min(100, Math.max(1, int(args.limit, 8))),
        requestId: runId });
      // Only the bounded snippet is delivered to the model, so only that range
      // becomes citable.
      const delivered = registerEvidence(runId, await this.buildSearchDeliveries(result.evidence));
      return { ok: true, mode: result.mode, results: delivered.map((ev) => ({ evidenceId: ev.id,
        document: ev.documentName, documentId: ev.documentId, page: ev.locator.page,
        section: ev.locator.sectionPath?.join(' > '), score: ev.score, snippet: ev.quote })) };
    }

    if (tool !== 'read') return { ok: false, error: `Unknown tool: ${tool}` };
    const evidenceId = String(args.evidenceId || '').trim();
    const prior = evidenceId ? readEvidence(runId, evidenceId) : undefined;
    if (evidenceId && !prior) {
      return { ok: false, error: 'EVIDENCE_NOT_FOUND', message: '引用不存在或不属于本次运行，请重新搜索。' };
    }
    const documentId = String(args.documentId || prior?.documentId || '').trim();
    if (!documentId || !scope.documentIds.includes(documentId)) {
      return { ok: false, error: 'DOCUMENT_NOT_FOUND', message: '文档不存在或当前会话未挂载该文档。' };
    }
    const docs = await db.select<any>('SELECT id, title, file_hash, active_index_batch_id FROM documents WHERE id = ? LIMIT 1', [documentId]);
    const document = docs[0];
    if (!document?.active_index_batch_id) return { ok: false, error: 'INDEX_NOT_READY', message: '文档尚未建立关键词索引。' };
    const batchId = String(document.active_index_batch_id);
    const pageArg = args.page == null ? undefined : Number(args.page);

    let startChunkIndex = 0;
    let startOffset = 0;
    let endChunkIndex: number | undefined;
    let anchorChunkId: string | undefined;

    if (hasCursorArg(args.cursor)) {
      const parsed = parseCursor(args.cursor);
      if (!parsed) return { ok: false, error: 'CURSOR_INVALID', message: '阅读游标格式无效，请重新读取。' };
      if (parsed.documentId !== documentId) {
        return { ok: false, error: 'CURSOR_INVALID', message: '阅读游标与文档不匹配，请重新读取。' };
      }
      if (parsed.batchId !== batchId) {
        return { ok: false, error: 'CURSOR_INVALID', message: '文档已重建，该阅读游标已失效，请重新搜索或从头阅读。' };
      }
      startChunkIndex = parsed.chunkIndex;
      startOffset = parsed.offset;
    } else if (prior) {
      const anchor = anchorFromEvidence(prior);
      let anchorIndex = anchor?.chunkIndex ?? -1;
      const anchorOffset = anchor?.offset ?? 0;
      if (anchorIndex < 0 && prior.retrievalChunkId) {
        const hit = await db.select<any>('SELECT id, chunk_index FROM document_chunks WHERE id = ? AND batch_id = ?',
          [prior.retrievalChunkId, batchId]);
        if (!hit.length) return { ok: false, error: 'CURSOR_INVALID', message: '文档已重建，请重新搜索。' };
        anchorIndex = Number(hit[0].chunk_index);
      }
      if (anchorIndex < 0) {
        return { ok: false, error: 'CURSOR_INVALID', message: '该引用没有可定位的原文范围，请重新搜索。' };
      }
      const before = args.before == null ? 1 : Math.min(32, int(args.before, 0));
      const after = args.after == null ? 1 : Math.min(32, int(args.after, 0));
      if (before > 0 || after > 0) {
        startChunkIndex = Math.max(0, anchorIndex - before);
        startOffset = 0;
        endChunkIndex = anchorIndex + after;
      } else {
        startChunkIndex = anchorIndex;
        startOffset = anchorOffset;
      }
      anchorChunkId = prior.retrievalChunkId;
    }

    const read = await readBounded({ db, documentId, batchId, startChunkIndex, startOffset,
      charLimit: charLimit(args.limit), endChunkIndex, page: pageArg });
    if (!read.delivered.length) {
      return { ok: true, documentId, document: document.title, text: '', complete: true,
        message: pageArg != null ? `没有匹配第 ${pageArg} 页的内容。` : '没有可读取的内容。' };
    }
    const delivered = citeDelivery(runId, {
      documentId, documentName: document.title, documentHash: document.file_hash, batchId,
      delivered: read.delivered, locator: locatorFor(read.delivered, startChunkIndex),
      quote: read.text, retrievalChunkId: anchorChunkId,
    });
    return { ok: true, documentId, document: document.title, evidenceId: delivered.id, text: read.text,
      page: pageArg, nextCursor: read.nextCursor ? JSON.stringify(read.nextCursor) : undefined,
      complete: read.complete };
  }

  /**
   * Binds each search hit to the exact snippet that reaches the model, so a
   * citation always reopens at the delivered range rather than the whole chunk.
   */
  private async buildSearchDeliveries(evidence: Evidence[]): Promise<Evidence[]> {
    if (!evidence.length) return [];
    const chunkIds = evidence.map((item) => item.retrievalChunkId).filter(Boolean) as string[];
    const db = DatabaseService.getInstance().getDbManager();
    const rows = chunkIds.length
      ? await db.select<{ id: string; chunk_index: number; batch_id: string }>(
          `SELECT id, chunk_index, batch_id FROM document_chunks WHERE id IN (${chunkIds.map(() => '?').join(',')})`,
          chunkIds)
      : [];
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    return evidence.map((item) => {
      const quote = item.quote.slice(0, SEARCH_SNIPPET_CHARS);
      const meta = item.retrievalChunkId ? byId.get(item.retrievalChunkId) : undefined;
      if (!meta) return { ...item, quote };
      return {
        ...item,
        quote,
        range: {
          documentId: item.documentId,
          batchId: String(meta.batch_id),
          chunks: [{ chunkId: String(meta.id), chunkIndex: Number(meta.chunk_index),
            startOffset: 0, endOffset: quote.length }],
        },
      };
    });
  }
}

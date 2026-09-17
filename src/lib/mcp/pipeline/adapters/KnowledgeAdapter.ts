import { KNOWLEDGE_SERVER_NAME } from '@/lib/mcp/nativeTools/knowledge';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { getRAGService } from '@/lib/rag/ragServiceInstance';
import { KnowledgeRetrievalError, retrieveEvidence } from '@/lib/rag/retrieveEvidence';
import { registerEvidence, readEvidence } from '@/lib/rag/EvidenceRegistry';
import { EvidenceStore } from '@/lib/rag/evidenceStore';
import { NEIGHBOR_BLOCK_WINDOW } from '@/lib/rag/constants';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import type { Evidence } from '@/lib/rag/evidenceTypes';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

const knowledgeCallBudget = new Map<string, { count: number; updatedAt: number }>();
const MAX_KNOWLEDGE_CALLS = 12;

async function resolveMountedScope(conversationId: string, raw?: unknown): Promise<string[]> {
  const mounted = useConversationAttachmentStore.getState().getKnowledgeBase(conversationId);
  // A historical selection is not an access grant.  In particular, clearing
  // a mount must take effect immediately and must never be undone by a past
  // user message during a later tool call.
  const mountedId = mounted?.id;
  if (!mountedId) return [];
  const requested = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  return requested.length ? (requested.includes(mountedId) ? [mountedId] : []) : [mountedId];
}

function sessionSearch(documents: ReturnType<typeof useConversationAttachmentStore.getState>['getSessionDocuments'] extends (...args: any[]) => infer R ? R : never, query: string, limit: number): Evidence[] {
  const terms = query.toLowerCase().split(/[\s\u3000]+/).filter(Boolean);
  return documents
    .map((doc) => {
      const text = doc.content.toLowerCase();
      const hits = terms.reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0);
      const firstHit = terms
        .map((term) => text.indexOf(term))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
      const excerptStart = Math.max(0, firstHit - 600);
      return { doc, hits, excerptStart };
    })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map(({ doc, hits, excerptStart }) => ({
      id: '',
      documentId: doc.id,
      documentName: doc.name,
      documentPath: undefined,
      sourceBlockIds: [],
      documentHash: doc.documentHash,
      locator: {
        lineStart: doc.content.slice(0, excerptStart).split('\n').length,
      },
      quote: doc.content.slice(excerptStart, excerptStart + 1600),
      score: hits,
    }));
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function boundedLimit(value: unknown, fallback = 8000): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(32000, Math.max(1000, Math.floor(parsed))) : fallback;
}

function boundedNeighbor(value: unknown, fallback = NEIGHBOR_BLOCK_WINDOW): number {
  return Math.min(32, nonNegativeInt(value, fallback));
}

function registerDeliveredText(params: {
  runId: string;
  documentId: string;
  documentName: string;
  documentHash?: string;
  knowledgeBaseId?: string;
  sourceBlockIds?: string[];
  locator?: Evidence['locator'];
  quote: string;
}): string {
  return registerEvidence(params.runId, [{
    id: '',
    documentId: params.documentId,
    documentName: params.documentName,
    documentHash: params.documentHash,
    knowledgeBaseId: params.knowledgeBaseId,
    sourceBlockIds: params.sourceBlockIds || [],
    locator: params.locator || {},
    quote: params.quote,
    score: 0,
  }])[0].id;
}

export class KnowledgeAdapter implements ToolAdapter {
  readonly server = KNOWLEDGE_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === KNOWLEDGE_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').toLowerCase();
    const args = invocation.args || {};
    const runId = invocation.assistantMessageId;
    const previous = knowledgeCallBudget.get(runId);
    const budget = previous && Date.now() - previous.updatedAt < 60 * 60 * 1000
      ? previous
      : { count: 0, updatedAt: Date.now() };
    for (const [key, value] of knowledgeCallBudget) {
      if (Date.now() - value.updatedAt >= 60 * 60 * 1000) knowledgeCallBudget.delete(key);
    }
    budget.count += 1;
    budget.updatedAt = Date.now();
    knowledgeCallBudget.set(runId, budget);
    if (budget.count > MAX_KNOWLEDGE_CALLS) {
      return { ok: false, error: 'KNOWLEDGE_TOOL_BUDGET_EXCEEDED', message: '本次运行最多读取 12 次知识库，请根据已读取内容回答或在下一轮继续。' };
    }
    const kbIds = await resolveMountedScope(invocation.conversationId, (args as any)?.knowledgeBaseIds);
    const sessionDocuments = useConversationAttachmentStore.getState().getSessionDocuments(invocation.conversationId);

    if (tool === 'list') {
      const rows: any[] = [];
      if (kbIds.length) {
        const db = DatabaseService.getInstance().getDbManager();
        const placeholders = kbIds.map(() => '?').join(',');
        const dbRows = await db.select<any>(
          `SELECT d.id, d.title, d.file_type, d.file_size, d.is_indexed,
                  d.embedding_fingerprint,
                  COALESCE(m.status, 'pending') AS mapping_status,
                  COUNT(rc.id) AS indexed_chunk_count,
                  CASE WHEN d.embedding_fingerprint IS NOT NULL AND EXISTS (
                    SELECT 1 FROM vector_embeddings ve
                     WHERE ve.is_deleted = 0
                       AND json_extract(ve.metadata, '$.documentId') = d.id
                       AND json_extract(ve.metadata, '$.knowledgeBaseId') = m.knowledge_base_id
                       AND json_extract(ve.metadata, '$.embeddingFingerprint') = d.embedding_fingerprint
                  ) THEN 1 ELSE 0 END AS semantic_indexed,
                  COALESCE(SUM(LENGTH(rc.source_text)), 0) AS indexed_chars
             FROM documents d
             JOIN doc_knowledge_mappings m ON m.document_id = d.id
             LEFT JOIN retrieval_chunks rc ON rc.document_id = d.id AND rc.knowledge_base_id = m.knowledge_base_id
            WHERE m.knowledge_base_id IN (${placeholders})
            GROUP BY d.id, d.title, d.file_type, d.file_size, d.is_indexed, m.status
            ORDER BY d.title`,
          kbIds,
        );
        rows.push(...(dbRows || []).map((row) => ({
          documentId: row.id,
          name: row.title,
          fileType: row.file_type,
          fileSize: Number(row.file_size || 0),
          indexed: Number(row.indexed_chunk_count || 0) > 0 && row.mapping_status === 'indexed',
          keywordIndexed: Number(row.indexed_chunk_count || 0) > 0 && row.mapping_status === 'indexed',
          semanticIndexed: Number(row.semantic_indexed || 0) > 0 && row.mapping_status === 'indexed',
          processingStatus: row.mapping_status,
          indexedChars: Number(row.indexed_chars || 0),
          source: 'knowledge_base',
        })));
      }
      rows.push(...sessionDocuments.map((doc) => ({
        documentId: doc.id,
        name: doc.name,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        indexed: true,
        keywordIndexed: true,
        semanticIndexed: false,
        processingStatus: 'indexed',
        indexedChars: doc.content.length,
        documentHash: doc.documentHash,
        source: 'session_attachment',
      })));
      const start = nonNegativeInt((args as any).cursor);
      const limit = Math.min(100, Math.max(1, nonNegativeInt((args as any).limit, 50)));
      return { ok: true, documents: rows.slice(start, start + limit), nextCursor: start + limit < rows.length ? String(start + limit) : undefined, complete: start + limit >= rows.length };
    }

    if (!kbIds.length && !sessionDocuments.length) {
      return { ok: false, error: 'NO_KNOWLEDGE_BASE', message: '当前会话没有可访问的知识库或临时附件。' };
    }

    if (tool === 'search') {
      const query = String((args as any).query || '').trim();
      if (!query) return { ok: false, error: 'query is required' };

      const limit = Math.min(100, Math.max(1, nonNegativeInt((args as any).limit, 8)));
      let evidence: Evidence[] = [];
      let retrievalMode: 'lexical' | 'hybrid' = 'lexical';
      if (kbIds.length) {
        try {
          const rag = await getRAGService();
          const result = await retrieveEvidence({
            query,
            knowledgeBaseIds: kbIds,
            embeddingService: rag.getEmbeddingService(),
            retrievalService: rag.getRetrievalServiceInstance(),
            topK: limit,
          });
          evidence = result.evidence;
          retrievalMode = result.mode;
        } catch (error) {
          // A pending KB may coexist with searchable session attachments. A
          // real FTS/database failure must remain visible to the caller.
          if (!sessionDocuments.length || !(error instanceof KnowledgeRetrievalError) || error.code !== 'KB_NOT_INDEXED') {
            throw error;
          }
        }
      }
      evidence = [...evidence, ...sessionSearch(sessionDocuments, query, limit)].slice(0, limit);

      // The citation registry represents text the model actually received.
      // Search returns snippets, so do not register a longer hidden window.
      const registered = registerEvidence(runId, evidence.map((item) => ({
        ...item,
        quote: item.quote.slice(0, 400),
      })));
      const hasKnowledgeEvidence = evidence.some((ev) => !ev.documentId.startsWith('attachment_'));
      return {
        ok: true,
        mode: hasKnowledgeEvidence ? retrievalMode : 'lexical',
        results: registered.map((ev) => ({
          evidenceId: ev.id,
          document: ev.documentName,
          page: ev.locator.page,
          section: ev.locator.sectionPath?.join(' > '),
          score: ev.score,
          snippet: ev.quote,
        })),
      };
    }

    if (tool === 'read') {
      const requestedEvidenceId = String((args as any).evidenceId || '').trim();
      const before = boundedNeighbor((args as any).before);
      const after = boundedNeighbor((args as any).after);

      if (requestedEvidenceId) {
        const ev = readEvidence(runId, requestedEvidenceId);
        if (!ev) {
          return { ok: false, error: 'EVIDENCE_NOT_FOUND', message: `未找到 ${requestedEvidenceId}，请先 knowledge_search` };
        }
        const sessionDoc = sessionDocuments.find((doc) => doc.id === ev.documentId);
        if (sessionDoc) {
          const start = nonNegativeInt((args as any).cursor);
          const limit = boundedLimit((args as any).limit);
          const text = sessionDoc.content.slice(start, start + limit);
          const delivered = registerEvidence(runId, [{ ...ev, quote: text }])[0];
          return { ok: true, evidenceId: delivered.id, document: ev.documentName, text, nextCursor: start + limit < sessionDoc.content.length ? String(start + limit) : undefined, complete: start + limit >= sessionDoc.content.length };
        }
        if (!kbIds.length) {
          return { ok: false, error: 'EVIDENCE_NOT_FOUND', message: '该引用已不在当前会话的可访问资料范围内，请重新搜索。' };
        }
        const blocks = await EvidenceStore.getSourceBlocks([ev.documentId], kbIds);
        const scopedBlocks = ev.knowledgeBaseId
          ? blocks.filter((block) => block.knowledgeBaseId === ev.knowledgeBaseId)
          : blocks;
        const ids = new Set(ev.sourceBlockIds);
        const matched = scopedBlocks.filter((b) => ids.has(b.id));
        if (!matched.length) {
          return { ok: false, error: 'EVIDENCE_NOT_FOUND', message: '该引用已不在当前会话的可访问资料范围内，请重新搜索。' };
        }
        const minIdx = Math.min(...matched.map((b) => b.blockIndex));
        const maxIdx = Math.max(...matched.map((b) => b.blockIndex));
        const window = scopedBlocks.filter(
          (b) => b.blockIndex >= minIdx - before && b.blockIndex <= maxIdx + after
        );
        const fullText = (window.length ? window : scopedBlocks).map((b) => b.text).join('\n');
        const maxChars = boundedLimit((args as any).limit);
        const text = fullText.slice(0, maxChars);
        const delivered = registerEvidence(runId, [{
          ...ev,
          sourceBlockIds: window.map((block) => block.id),
          quote: text,
        }])[0];
        return {
          ok: true,
          evidenceId: delivered.id,
          document: ev.documentName,
          text,
          truncated: fullText.length > maxChars,
        };
      }

      const documentId = String((args as any).documentId || '').trim();
      if (!documentId) {
        return { ok: false, error: 'evidenceId or documentId required' };
      }
      const sessionDoc = sessionDocuments.find((doc) => doc.id === documentId);
      if (sessionDoc) {
        const start = nonNegativeInt((args as any).cursor);
        const limit = boundedLimit((args as any).limit);
        const text = sessionDoc.content.slice(start, start + limit);
        const evidenceId = registerDeliveredText({
          runId, documentId, documentName: sessionDoc.name, documentHash: sessionDoc.documentHash,
          locator: { lineStart: sessionDoc.content.slice(0, start).split('\n').length }, quote: text,
        });
        return { ok: true, documentId, evidenceId, text, nextCursor: start + limit < sessionDoc.content.length ? String(start + limit) : undefined, complete: start + limit >= sessionDoc.content.length };
      }
      if (!kbIds.length) {
        return { ok: false, error: 'DOCUMENT_NOT_FOUND', message: '文档不存在或当前会话未挂载该文档。' };
      }
      const db = DatabaseService.getInstance().getDbManager();
      const access = await db.select<{ id: string }>(
        `SELECT d.id FROM documents d
           JOIN doc_knowledge_mappings m ON m.document_id = d.id
          WHERE d.id = ? AND m.knowledge_base_id IN (${kbIds.map(() => '?').join(',')})
          LIMIT 1`,
        [documentId, ...kbIds],
      );
      if (!access.length) {
        return { ok: false, error: 'DOCUMENT_NOT_FOUND', message: '文档不存在或当前会话未挂载该文档。' };
      }
      const chunkRows = await db.select<any>(
        `SELECT id, source_text, source_start_block, source_end_block, metadata FROM retrieval_chunks
          WHERE document_id = ? AND knowledge_base_id IN (${kbIds.map(() => '?').join(',')})
          ORDER BY source_start_block`,
        [documentId, ...kbIds],
      );
      if (chunkRows.length) {
        // Each row is already scoped to the mounted knowledge base.  Do not
        // collapse repeated paragraphs: repeated source text is still a real
        // position in a document and must remain readable in order.
        const uniqueChunkRows = chunkRows;
        const start = nonNegativeInt((args as any).cursor);
        const limit = boundedLimit((args as any).limit);
        let used = 0;
        const selected: any[] = [];
        for (let i = start; i < uniqueChunkRows.length; i += 1) {
          const text = String(uniqueChunkRows[i].source_text || '');
          if (selected.length && used + text.length > limit) break;
          selected.push(uniqueChunkRows[i]);
          used += text.length;
        }
        const next = start + selected.length;
        const text = selected.map((row) => row.source_text).join('\n\n');
        const document = await db.select<{ title: string; file_hash: string }>(
          'SELECT title, file_hash FROM documents WHERE id = ? LIMIT 1', [documentId],
        );
        const evidenceId = registerDeliveredText({
          runId,
          documentId,
          documentName: document[0]?.title || documentId,
          documentHash: document[0]?.file_hash,
          knowledgeBaseId: kbIds[0],
          sourceBlockIds: selected.map((row) => row.id),
          locator: { paragraphIndex: start },
          quote: text,
        });
        return {
          ok: true,
          documentId,
          evidenceId,
          text,
          nextCursor: next < uniqueChunkRows.length ? String(next) : undefined,
          complete: next >= uniqueChunkRows.length,
        };
      }
      const blocks = await EvidenceStore.getSourceBlocks([documentId], kbIds);
      const uniqueBlocks = Array.from(new Map(
        blocks.map((block) => [`${block.blockIndex}:${block.text}`, block]),
      ).values());
      const page = (args as any).page != null ? Number((args as any).page) : undefined;
      const filtered = page != null ? uniqueBlocks.filter((b) => b.page === page) : uniqueBlocks;
      const text = filtered.map((b) => b.text).join('\n');
      const document = await db.select<{ title: string; file_hash: string }>(
        'SELECT title, file_hash FROM documents WHERE id = ? LIMIT 1', [documentId],
      );
      const evidenceId = registerDeliveredText({
        runId,
        documentId,
        documentName: document[0]?.title || documentId,
        documentHash: document[0]?.file_hash,
        knowledgeBaseId: kbIds[0],
        sourceBlockIds: filtered.map((block) => block.id),
        locator: { page, lineStart: filtered[0]?.lineStart, lineEnd: filtered.at(-1)?.lineEnd },
        quote: text,
      });
      return {
        ok: true,
        documentId,
        page,
        evidenceId,
        text,
      };
    }

    return { ok: false, error: `Unknown tool: ${tool}` };
  }
}

import { KNOWLEDGE_SERVER_NAME } from '@/lib/mcp/nativeTools/knowledge';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { getRAGService } from '@/lib/rag/ragServiceInstance';
import { KnowledgeRetrievalError, retrieveEvidence } from '@/lib/rag/retrieveEvidence';
import { registerEvidence, readEvidence } from '@/lib/rag/EvidenceRegistry';
import { EvidenceStore } from '@/lib/rag/evidenceStore';
import { NEIGHBOR_BLOCK_WINDOW } from '@/lib/rag/constants';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { getPersistedKnowledgeBaseReference } from '@/lib/mcp/injection/persistedKnowledgeBase';
import type { Evidence } from '@/lib/rag/evidenceTypes';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

const knowledgeCallBudget = new Map<string, { count: number; updatedAt: number }>();
const MAX_KNOWLEDGE_CALLS = 12;

async function resolveMountedScope(conversationId: string, raw?: unknown): Promise<string[]> {
  const mounted = useConversationAttachmentStore.getState().getKnowledgeBase(conversationId);
  let mountedId = mounted?.id;
  // The attachment store is intentionally transient. Rehydrate the last
  // persisted knowledge-base reference when the app was restarted or the
  // conversation was switched before the tool call.
  if (!mountedId) {
    mountedId = (await getPersistedKnowledgeBaseReference(conversationId))?.id;
  }
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

      const registered = registerEvidence(runId, evidence);
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
          snippet: ev.quote.slice(0, 400),
        })),
      };
    }

    if (tool === 'read') {
      const evidenceId = String((args as any).evidenceId || '').trim();
      const before = boundedNeighbor((args as any).before);
      const after = boundedNeighbor((args as any).after);

      if (evidenceId) {
        const ev = readEvidence(runId, evidenceId);
        if (!ev) {
          return { ok: false, error: 'EVIDENCE_NOT_FOUND', message: `未找到 ${evidenceId}，请先 knowledge_search` };
        }
        const sessionDoc = sessionDocuments.find((doc) => doc.id === ev.documentId);
        if (sessionDoc) {
          const start = nonNegativeInt((args as any).cursor);
          const limit = boundedLimit((args as any).limit);
          const text = sessionDoc.content.slice(start, start + limit);
          return { ok: true, evidenceId, document: ev.documentName, text, nextCursor: start + limit < sessionDoc.content.length ? String(start + limit) : undefined, complete: start + limit >= sessionDoc.content.length };
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
        return {
          ok: true,
          evidenceId,
          document: ev.documentName,
          text: fullText.slice(0, maxChars),
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
        return { ok: true, documentId, text, nextCursor: start + limit < sessionDoc.content.length ? String(start + limit) : undefined, complete: start + limit >= sessionDoc.content.length };
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
        `SELECT id, source_text, metadata FROM retrieval_chunks
          WHERE document_id = ? AND knowledge_base_id IN (${kbIds.map(() => '?').join(',')})
          ORDER BY source_start_block`,
        [documentId, ...kbIds],
      );
      if (chunkRows.length) {
        const uniqueChunkRows = Array.from(new Map(
          chunkRows.map((row) => [
            `${row.source_start_block}:${row.source_end_block}:${String(row.source_text || '')}`,
            row,
          ]),
        ).values());
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
        return {
          ok: true,
          documentId,
          text: selected.map((row) => row.source_text).join('\n\n'),
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
      return {
        ok: true,
        documentId,
        page,
        text: filtered.map((b) => b.text).join('\n'),
      };
    }

    return { ok: false, error: `Unknown tool: ${tool}` };
  }
}

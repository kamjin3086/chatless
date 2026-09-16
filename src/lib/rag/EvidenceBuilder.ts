import type { Evidence, RetrievalChunk, SourceBlock, SourceLocator } from './evidenceTypes';
import { FINAL_EVIDENCE_K, MAX_EVIDENCE_CONTEXT_TOKENS, NEIGHBOR_BLOCK_WINDOW } from './constants';
import { estimateTokens } from './tokenEstimate';

function sectionKey(block?: SourceBlock): string {
  return block?.sectionPath?.join(' > ') || '';
}

function blocksKey(documentId: string, knowledgeBaseId?: string): string {
  return `${knowledgeBaseId || ''}\u0000${documentId}`;
}

function evidenceWindowBlocks(
  blocks: SourceBlock[],
  chunk: RetrievalChunk,
  neighbor: number
): SourceBlock[] {
  const start = Math.max(0, chunk.sourceStartBlock - neighbor);
  const end = chunk.sourceEndBlock + neighbor;
  const core = blocks.filter(
    (b) => b.blockIndex >= chunk.sourceStartBlock && b.blockIndex <= chunk.sourceEndBlock
  );
  const coreSection = sectionKey(core[0]);
  return blocks.filter((b) => {
    if (b.blockIndex < start || b.blockIndex > end) return false;
    const inCore = b.blockIndex >= chunk.sourceStartBlock && b.blockIndex <= chunk.sourceEndBlock;
    if (inCore) return true;
    if (coreSection && sectionKey(b) !== coreSection) return false;
    return true;
  });
}

export function buildEvidenceFromChunks(params: {
  chunks: RetrievalChunk[];
  blocksByDoc: Map<string, SourceBlock[]>;
  documentNames?: Map<string, string>;
  knowledgeBaseNames?: Map<string, string>;
  limit?: number;
}): Evidence[] {
  const limit = params.limit ?? FINAL_EVIDENCE_K;
  const evidence: Evidence[] = [];
  let tokens = 0;

  for (const chunk of params.chunks.slice(0, limit * 2)) {
    const blocks =
      params.blocksByDoc.get(blocksKey(chunk.documentId, chunk.knowledgeBaseId)) ||
      params.blocksByDoc.get(chunk.documentId) ||
      [];
    const window = evidenceWindowBlocks(blocks, chunk, NEIGHBOR_BLOCK_WINDOW);
    const quote = (window.length ? window : [{ text: chunk.sourceText } as SourceBlock])
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!quote) continue;

    const used = estimateTokens(quote);
    if (evidence.length > 0 && tokens + used > MAX_EVIDENCE_CONTEXT_TOKENS) break;

    const locator: SourceLocator = {
      page: chunk.metadata.pageStart,
      sectionPath: chunk.metadata.sectionPath,
      lineStart: window[0]?.lineStart,
      lineEnd: window[window.length - 1]?.lineEnd,
    };

    evidence.push({
      id: `E${evidence.length + 1}`,
      documentId: chunk.documentId,
      documentName:
        params.documentNames?.get(chunk.documentId) ||
        String(chunk.metadata.documentName || chunk.documentId),
      documentPath: String(chunk.metadata.documentPath || ''),
      documentHash: String(chunk.metadata.documentHash || ''),
      knowledgeBaseId: chunk.knowledgeBaseId,
      knowledgeBaseName: chunk.knowledgeBaseId
        ? params.knowledgeBaseNames?.get(chunk.knowledgeBaseId)
        : undefined,
      sourceBlockIds: window.map((b) => b.id),
      locator,
      quote,
      score: Number(chunk.metadata.score || 0),
      retrievalChunkId: chunk.id,
    });
    tokens += used;
    if (evidence.length >= limit) break;
  }

  return evidence;
}

export function formatEvidenceContext(evidence: Evidence[]): string {
  return evidence
    .map((ev) => {
      const loc = [
        ev.locator.page != null ? `Page: ${ev.locator.page}` : '',
        ev.locator.sectionPath?.length ? `Section: ${ev.locator.sectionPath.join(' > ')}` : '',
        ev.locator.lineStart != null ? `Lines: ${ev.locator.lineStart}-${ev.locator.lineEnd ?? ev.locator.lineStart}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return `<EVIDENCE id="${ev.id}">
Document: ${ev.documentName}
${loc}

${ev.quote}
</EVIDENCE>`;
    })
    .join('\n\n');
}

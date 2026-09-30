import type { Evidence, RetrievalChunk, SourceLocator } from './evidenceTypes';
import { FINAL_EVIDENCE_K, MAX_EVIDENCE_CONTEXT_TOKENS } from './constants';
import { estimateTokens } from './tokenEstimate';

export function buildEvidenceFromChunks(params: {
  chunks: RetrievalChunk[];
  documentNames?: Map<string, string>;
  knowledgeBaseNames?: Map<string, string>;
  limit?: number;
}): Evidence[] {
  const limit = params.limit ?? FINAL_EVIDENCE_K;
  const evidence: Evidence[] = [];
  let tokens = 0;

  for (const chunk of params.chunks.slice(0, limit * 2)) {
    const quote = chunk.sourceText.trim();
    if (!quote) continue;

    const used = estimateTokens(quote);
    if (evidence.length > 0 && tokens + used > MAX_EVIDENCE_CONTEXT_TOKENS) break;

    const locator: SourceLocator = {
      page: chunk.metadata.pageStart,
      sectionPath: chunk.metadata.sectionPath,
      lineStart: Number(chunk.metadata.lineStart) || undefined,
      lineEnd: Number(chunk.metadata.lineEnd) || undefined,
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
      sourceBlockIds: [chunk.id],
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

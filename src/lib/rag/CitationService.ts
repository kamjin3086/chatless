import type { Citation, Evidence } from './evidenceTypes';
import { EVIDENCE_TAG_RE } from './evidenceTypes';
import { mapOutsideMarkdownCode } from './markdownEvidence';

export function applyCitations(answer: string, evidence: Evidence[]): {
  displayAnswer: string;
  citations: Citation[];
} {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const used: Citation[] = [];
  const seen = new Set<string>();

  const replaceOutsideCode = (segment: string) => segment.replace(EVIDENCE_TAG_RE, (marker, canonical: string | undefined, alias: string | undefined, offset: number) => {
    const id = canonical || alias;
    if (!id || (alias && ['(', '['].includes(segment.charAt(offset + marker.length)))) return marker;
    let slashes = 0;
    for (let index = offset - 1; index >= 0 && segment[index] === '\\'; index--) slashes++;
    if (slashes % 2) return marker;
    const ev = byId.get(id);
    if (!ev) {
      if (alias) return marker;
      console.warn(`[CitationService] unknown evidence id: ${id}`);
      return '';
    }
    if (!seen.has(id)) {
      seen.add(id);
      used.push({
        id: ev.id,
        n: used.length + 1,
        evidenceId: ev.id,
        documentId: ev.documentId,
        documentName: ev.documentName,
        documentPath: ev.documentPath,
        documentHash: ev.documentHash,
        locator: ev.locator,
        quote: ev.quote,
        sourceBlockIds: ev.sourceBlockIds,
        retrievalChunkId: ev.retrievalChunkId,
        range: ev.range,
      });
    }
    const n = used.find((c) => c.evidenceId === id)?.n ?? used.length;
    return `[${n}]`;
  });

  // Citation markers inside code samples are code, not claims. Preserve them.
  const displayAnswer = mapOutsideMarkdownCode(answer, replaceOutsideCode);

  return { displayAnswer, citations: used };
}

export function evidenceToRetrievedLike(evidence: Evidence[]) {
  return evidence.map((ev, index) => ({
    id: ev.retrievalChunkId || ev.id,
    content: ev.quote,
    score: ev.score,
    knowledgeBaseId: ev.knowledgeBaseId || '',
    knowledgeBaseName: ev.knowledgeBaseName || '',
    documentId: ev.documentId,
    documentName: ev.documentName,
    documentPath: ev.documentPath,
    chunkIndex: index,
    metadata: { locator: ev.locator, evidenceId: ev.id },
  }));
}

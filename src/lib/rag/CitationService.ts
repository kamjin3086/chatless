import type { Citation, Evidence } from './evidenceTypes';
import { EVIDENCE_TAG_RE } from './evidenceTypes';

export function applyCitations(answer: string, evidence: Evidence[]): {
  displayAnswer: string;
  citations: Citation[];
} {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const used: Citation[] = [];
  const seen = new Set<string>();

  const replaceOutsideCode = (segment: string) => segment.replace(EVIDENCE_TAG_RE, (_m, id: string) => {
    const ev = byId.get(id);
    if (!ev) {
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
      });
    }
    const n = used.find((c) => c.evidenceId === id)?.n ?? used.length;
    return `[${n}]`;
  });

  // Citation markers inside code samples are code, not claims. Preserve them.
  const displayAnswer = answer
    .split(/(```[\s\S]*?```)/g)
    .map((segment, index) => (index % 2 === 1 ? segment : replaceOutsideCode(segment)))
    .join('');

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

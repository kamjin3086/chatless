import type { ParsedDocument, RetrievalChunk, SourceBlock } from '@/lib/rag/evidenceTypes';
import {
  CHUNK_SCHEMA_VERSION,
  DEFAULT_CHUNK_MAX_TOKENS,
  DEFAULT_CHUNK_TARGET_TOKENS,
} from '@/lib/rag/constants';
import { estimateTokens } from '@/lib/rag/tokenEstimate';

export function buildSearchText(params: {
  title: string;
  sectionPath?: string[];
  sourceText: string;
}): string {
  const parts = [`文档：${params.title}`];
  if (params.sectionPath && params.sectionPath.length > 0) {
    parts.push(`章节：${params.sectionPath.join(' > ')}`);
  }
  parts.push('', params.sourceText);
  return parts.join('\n');
}

export function mergeSourceBlocksToChunks(
  parsed: ParsedDocument,
  documentId: string,
  options?: { targetTokens?: number; maxTokens?: number }
): RetrievalChunk[] {
  const target = options?.targetTokens ?? DEFAULT_CHUNK_TARGET_TOKENS;
  const maxTokens = options?.maxTokens ?? DEFAULT_CHUNK_MAX_TOKENS;
  const title = parsed.title || 'document';
  const blocks = parsed.blocks || [];
  const chunks: RetrievalChunk[] = [];

  const searchable = blocks
    .filter((b) => b.type !== 'heading' || estimateTokens(b.text) > 40)
    .flatMap((block) => splitOversizedBlock(block, maxTokens));
  if (searchable.length === 0) {
    return chunks;
  }

  let current: SourceBlock[] = [];
  let currentSection = sectionKey(searchable[0]);

  const flush = (extra?: SourceBlock) => {
    const group = extra ? [...current, extra] : current;
    if (group.length === 0) return;
    const sourceText = group.map((b) => b.text).join('\n');
    const sectionPath = group.find((b) => b.sectionPath?.length)?.sectionPath;
    const pages = group.map((b) => b.page).filter((p): p is number => typeof p === 'number');
    const id = `chk_${documentId}_${chunks.length}`;
    chunks.push({
      id,
      documentId,
      sourceStartBlock: group[0].blockIndex,
      sourceEndBlock: group[group.length - 1].blockIndex,
      sourceText,
      searchText: buildSearchText({ title, sectionPath, sourceText }),
      metadata: {
        sectionPath,
        pageStart: pages.length ? Math.min(...pages) : undefined,
        pageEnd: pages.length ? Math.max(...pages) : undefined,
        documentName: title,
        documentPath: parsed.metadata.filePath,
        chunkIndex: chunks.length,
        chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
      },
    });
  };

  for (let blockIndex = 0; blockIndex < searchable.length; blockIndex += 1) {
    const block = searchable[blockIndex];
    const key = sectionKey(block);
    const nextTokens = estimateTokens([...current, block].map((b) => b.text).join('\n'));
    const wouldSplitTableOrCode =
      (block.type === 'table' || block.type === 'code') && current.length > 0;
    const crossSection = current.length > 0 && key !== currentSection;

    if (current.length > 0 && (crossSection || wouldSplitTableOrCode || nextTokens > maxTokens)) {
      flush();
      current = [];
    }

    current.push(block);
    currentSection = key;

    const curTokens = estimateTokens(current.map((b) => b.text).join('\n'));
    if (curTokens >= target && block.type !== 'table' && block.type !== 'code') {
      const overlap = blockIndex < searchable.length - 1 ? current[current.length - 1] : undefined;
      flush();
      current = overlap ? [overlap] : [];
      currentSection = current[0] ? sectionKey(current[0]) : key;
    }
  }

  if (current.length > 0) {
    flush();
  }

  return chunks;
}

function sectionKey(block: SourceBlock): string {
  return `${block.sectionPath?.join('>') || ''}#${block.page ?? ''}`;
}

/**
 * A single paragraph can be larger than the model context even when it is
 * otherwise a natural structural boundary. Split only that paragraph and
 * retain its locator so the resulting chunks stay traceable to the source.
 */
function splitOversizedBlock(block: SourceBlock, maxTokens: number): SourceBlock[] {
  if (estimateTokens(block.text) <= maxTokens || maxTokens <= 0) return [block];

  const pieces: SourceBlock[] = [];
  let offset = 0;
  let part = 0;
  while (offset < block.text.length) {
    const remaining = block.text.slice(offset);
    let end = Math.min(block.text.length, offset + Math.max(1, Math.floor(maxTokens * 4)));
    while (end > offset + 1 && estimateTokens(block.text.slice(offset, end)) > maxTokens) end -= 1;
    if (end < block.text.length) {
      const boundary = block.text.slice(offset, end).search(/[\s\n，。；！？、,:：.!?](?!.*[\s\n，。；！？、,:：.!?])/s);
      if (boundary > 0) end = offset + boundary + 1;
    }
    if (end <= offset) end = Math.min(block.text.length, offset + 1);
    const text = block.text.slice(offset, end).trim();
    if (text) {
      const prefix = block.text.slice(0, offset);
      const lineOffset = (prefix.match(/\n/g) || []).length;
      const lineCount = (text.match(/\n/g) || []).length;
      pieces.push({
        ...block,
        id: `${block.id}#${part}`,
        text,
        lineStart: block.lineStart == null ? undefined : block.lineStart + lineOffset,
        lineEnd: block.lineStart == null ? undefined : block.lineStart + lineOffset + lineCount,
        charStart: block.charStart == null ? undefined : block.charStart + offset,
        charEnd: block.charStart == null ? undefined : block.charStart + end,
      });
      part += 1;
    }
    offset = end;
    while (offset < block.text.length && /\s/.test(block.text[offset])) offset += 1;
  }
  return pieces.length ? pieces : [block];
}

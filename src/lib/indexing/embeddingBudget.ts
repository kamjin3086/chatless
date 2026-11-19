import type { RetrievalChunk } from '@/lib/rag/evidenceTypes';
import { buildSearchText } from '@/lib/chunking/strategies/StructuredBlockMerger';
import { EmbeddingInputError } from '@/lib/embedding/types';

/** An authoritative tokenizer/model admission check for the complete search text. */
export type EmbeddingTextBudget = {
  fingerprint: string;
  accepts(texts: string[]): Promise<boolean[]>;
};

export async function configuredEmbeddingBudget(): Promise<EmbeddingTextBudget | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window))
    return null;
  const { loadKnowledgeBaseConfig } = await import('@/lib/knowledgeBaseConfig');
  const config = (await loadKnowledgeBaseConfig()).embedding;
  if (config.strategy !== 'local-onnx') return null;
  const { resolveOnnxModelPaths } = await import(
    '@/lib/embedding/strategies/LocalOnnxEmbeddingStrategy'
  );
  const { modelConfigService } = await import(
    '@/lib/embedding/ModelConfigService'
  );
  const model = config.modelName || 'all-minilm-l6-v2';
  const paths = await resolveOnnxModelPaths(config, model);
  if (!paths) return null;
  const limit = Math.min(
    config.maxLength || Infinity,
    modelConfigService.getModelContextLength(model) || 512,
  );
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    fingerprint: `tokenizer:${paths.tokenizer}:${limit}`,
    accepts: async (texts) =>
      (
        await invoke<number[]>('count_embedding_tokens', {
          texts,
          tokenizerPath: paths.tokenizer,
        })
      ).map((count) => count <= limit),
  };
}

/** Split source slices, never vectors or facts. Title/section prefixes count
 * against the same input bound; every returned piece is checked in full.
 */
export async function fitChunksToEmbeddingBudget(
  chunks: RetrievalChunk[],
  budget: EmbeddingTextBudget,
): Promise<RetrievalChunk[]> {
  const output: RetrievalChunk[] = [];
  for (const chunk of chunks) {
    const search = (sourceText: string) =>
      buildSearchText({
        title: chunk.metadata.documentName || 'document',
        sectionPath: chunk.metadata.sectionPath,
        sourceText,
      });
    const [fits] = await budget.accepts([chunk.searchText]);
    if (fits) {
      output.push({
        ...chunk,
        metadata: { ...chunk.metadata, embeddingBudget: budget.fingerprint },
      });
      continue;
    }
    const points = Array.from(chunk.sourceText);
    let pointOffset = 0;
    let offset = 0;
    while (pointOffset < points.length) {
      let low = 1;
      let high = points.length - pointOffset;
      let size = 0;
      while (low <= high) {
        const candidate = Math.floor((low + high) / 2);
        const [accepted] = await budget.accepts([
          search(points.slice(pointOffset, pointOffset + candidate).join('')),
        ]);
        if (accepted) {
          size = candidate;
          low = candidate + 1;
        } else high = candidate - 1;
      }
      if (!size)
        throw new EmbeddingInputError(
          'Document title/section leaves no room for source text in the selected model',
        );
      // Prefer a natural boundary without dropping whitespace or splitting Unicode scalars.
      let sourceText = points.slice(pointOffset, pointOffset + size).join('');
      if (pointOffset + size < points.length) {
        const boundary = Math.max(
          sourceText.lastIndexOf('\n'),
          sourceText.lastIndexOf('。'),
          sourceText.lastIndexOf(' '),
        );
        if (boundary >= Math.floor(sourceText.length / 2))
          sourceText = sourceText.slice(0, boundary + 1);
      }
      size = sourceText.length;
      const searchText = search(sourceText);
      if (!(await budget.accepts([searchText]))[0])
        throw new EmbeddingInputError(
          'Source slice still exceeds the selected model input limit',
        );
      output.push({
        ...chunk,
        id: `${chunk.id}_${offset}`,
        sourceText,
        searchText,
        metadata: {
          ...chunk.metadata,
          embeddingBudget: budget.fingerprint,
          sourceCharStart: offset,
          sourceCharEnd: offset + size,
          ...(typeof chunk.metadata.lineStart === 'number'
            ? {
                lineStart:
                  chunk.metadata.lineStart +
                  (chunk.sourceText.slice(0, offset).match(/\n/g) || []).length,
                lineEnd:
                  chunk.metadata.lineStart +
                  (chunk.sourceText.slice(0, offset + size).match(/\n/g) || [])
                    .length,
              }
            : {}),
        },
      });
      offset += size;
      pointOffset += Array.from(sourceText).length;
    }
  }
  return output.map((chunk, index) => ({
    ...chunk,
    metadata: { ...chunk.metadata, chunkIndex: index },
  }));
}

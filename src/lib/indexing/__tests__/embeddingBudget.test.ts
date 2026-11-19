import { expect, it } from 'vitest';
import { fitChunksToEmbeddingBudget } from '../embeddingBudget';
import { buildSearchText } from '@/lib/chunking/strategies/StructuredBlockMerger';
import type { RetrievalChunk } from '@/lib/rag/evidenceTypes';

function chunk(sourceText: string): RetrievalChunk {
  return {
    id: 'c',
    documentId: 'doc',
    sourceStartBlock: 0,
    sourceEndBlock: 0,
    sourceText,
    searchText: buildSearchText({
      title: 'Guide',
      sectionPath: ['Section'],
      sourceText,
    }),
    metadata: { documentName: 'Guide', sectionPath: ['Section'], lineStart: 5 },
  };
}
const budget = {
  fingerprint: 'test-tokenizer:48',
  accepts: async (texts: string[]) =>
    texts.map((text) => Array.from(text).length <= 48),
};

it('counts title and section overhead and preserves every source character', async () => {
  const input = chunk('维护记录。 负责人是林工。\n'.repeat(20));
  const output = await fitChunksToEmbeddingBudget([input], budget);
  expect(output.length).toBeGreaterThan(1);
  expect(output.map((part) => part.sourceText).join('')).toBe(input.sourceText);
  expect(
    await budget.accepts(output.map((part) => part.searchText)),
  ).not.toContain(false);
  expect(
    output.every(
      (part) => part.metadata.embeddingBudget === budget.fingerprint,
    ),
  ).toBe(true);
});

it('does not split a Unicode scalar across model inputs or offsets', async () => {
  const input = chunk('🙂🚀中文 '.repeat(30));
  const output = await fitChunksToEmbeddingBudget([input], budget);
  expect(output.map((part) => part.sourceText).join('')).toBe(input.sourceText);
  for (const part of output) {
    expect(part.sourceText.isWellFormed()).toBe(true);
    expect(
      input.sourceText.slice(
        Number(part.metadata.sourceCharStart),
        Number(part.metadata.sourceCharEnd),
      ),
    ).toBe(part.sourceText);
  }
});

it('rejects impossible metadata overhead instead of dropping document facts', async () => {
  await expect(
    fitChunksToEmbeddingBudget([chunk('Fact')], {
      fingerprint: 'tiny',
      accepts: async (texts) => texts.map((text) => text.length < 3),
    }),
  ).rejects.toThrow('title/section');
});

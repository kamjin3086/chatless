import { describe, expect, it } from 'vitest';
import { mergeSourceBlocksToChunks } from '../StructuredBlockMerger';

describe('mergeSourceBlocksToChunks', () => {
  it('does not publish a trailing overlap chunk when the final block reaches the target', () => {
    const chunks = mergeSourceBlocksToChunks(
      {
        title: 'demo',
        fileType: 'txt',
        blocks: [{
          id: 'block-1',
          documentId: 'doc-1',
          blockIndex: 0,
          type: 'paragraph',
          text: 'final block',
        }],
        plainText: 'final block',
        metadata: {
          fileHash: 'hash',
          parserVersion: 'test',
        },
      },
      'doc-1',
      { targetTokens: 1, maxTokens: 4 },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].sourceText).toBe('final block');
  });

  it('splits a single oversized paragraph before publishing chunks', () => {
    const text = '一'.repeat(40);
    const chunks = mergeSourceBlocksToChunks(
      {
        title: 'long',
        fileType: 'txt',
        blocks: [{ id: 'block-1', documentId: 'doc-1', blockIndex: 0, type: 'paragraph', text }],
        plainText: text,
        metadata: { fileHash: 'hash', parserVersion: 'test' },
      },
      'doc-1',
      { targetTokens: 100, maxTokens: 8 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.sourceText.length))).toBeLessThanOrEqual(8);
  });
});

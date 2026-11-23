import { describe, expect, it } from 'vitest';
import { formatKnowledgeIndexProgress } from '../formatKnowledgeIndexProgress';

describe('knowledge index progress presentation', () => {
  it('renders the same progress event in either locale', () => {
    const progress = { stage: 'alreadyAdded' } as const;
    expect(formatKnowledgeIndexProgress('en', progress)).toBe(
      'Document is already in this knowledge base',
    );
    expect(formatKnowledgeIndexProgress('zh', progress)).toBe(
      '文档已存在于知识库中',
    );
  });

  it('formats completion counts with the right number and plural', () => {
    expect(
      formatKnowledgeIndexProgress('en', { stage: 'complete', chunks: 1 }),
    ).toBe('Document indexed (1 chunk)');
    const progress = { stage: 'complete', chunks: 1234 } as const;
    expect(formatKnowledgeIndexProgress('en', progress)).toBe(
      'Document indexed (1,234 chunks)',
    );
    expect(formatKnowledgeIndexProgress('zh', progress)).toBe(
      '文档索引完成（1,234 个分片）',
    );
  });

  it('fills both positions in the rebuild message', () => {
    const progress = {
      stage: 'preparingRebuild',
      current: 42,
      total: 1234,
    } as const;
    expect(formatKnowledgeIndexProgress('en', progress)).toBe(
      'Preparing to reindex document 42 of 1,234…',
    );
    expect(formatKnowledgeIndexProgress('zh', progress)).toBe(
      '准备重建文档 42/1,234…',
    );
  });
});

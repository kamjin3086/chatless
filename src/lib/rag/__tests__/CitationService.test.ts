import { describe, expect, it } from 'vitest';
import { applyCitations } from '../CitationService';
import type { Evidence } from '../evidenceTypes';

const sampleEvidence: Evidence[] = [
  {
    id: 'E1',
    documentId: 'doc1',
    documentName: '手册.pdf',
    sourceBlockIds: ['b1'],
    locator: { page: 3 },
    quote: 'Chatless 是本地优先的 AI 工作台。',
    score: 0.9,
  },
];

describe('applyCitations', () => {
  it('converts [[E1]] to [1] and builds citation with DB quote', () => {
    const { displayAnswer, citations } = applyCitations(
      '根据文档[[E1]]，产品是本地优先的。',
      sampleEvidence
    );
    expect(displayAnswer).toContain('[1]');
    expect(displayAnswer).not.toContain('[[E1]]');
    expect(citations).toHaveLength(1);
    expect(citations[0].quote).toBe(sampleEvidence[0].quote);
    expect(citations[0].n).toBe(1);
  });

  it('drops unknown evidence ids', () => {
    const { displayAnswer, citations } = applyCitations('引用[[E99]]无效', sampleEvidence);
    expect(displayAnswer).not.toContain('[1]');
    expect(citations).toHaveLength(0);
  });
});

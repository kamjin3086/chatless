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

  it.each(['`[[E1]]`', '``example ` [[E1]]``', '```text\n[[E1]]\n```', '~~~text\n[[E1]]\n~~~', '````text\n```\n[[E1]]\n````'])('preserves code and excludes its markers from citation numbering: %s', (code) => {
    const result = applyCitations(`${code}\n\nFact [[E1]].`, sampleEvidence);
    expect(result.displayAnswer).toBe(`${code}\n\nFact [1].`);
    expect(result.citations).toHaveLength(1);
  });

  it('does not invent a citation from inline code or an unfinished fence', () => {
    for (const answer of ['Example: `[[E1]]`.', '```text\n[[E1]]']) {
      expect(applyCitations(answer, sampleEvidence)).toEqual({ displayAnswer: answer, citations: [] });
    }
  });

  it('preserves escaped literal markers', () => {
    expect(applyCitations('Literal \\[[E1]]', sampleEvidence)).toEqual({ displayAnswer: 'Literal \\[[E1]]', citations: [] });
  });

  it('accepts the unambiguous single-bracket evidence alias only for registered evidence', () => {
    const result = applyCitations('Fact [E1].', sampleEvidence);
    expect(result.displayAnswer).toBe('Fact [1].');
    expect(result.citations[0]?.evidenceId).toBe('E1');
    expect(applyCitations('Literal [E99] and [E1](https://example.com).', sampleEvidence)).toEqual({ displayAnswer: 'Literal [E99] and [E1](https://example.com).', citations: [] });
    expect(applyCitations('Example: `[E1]`.', sampleEvidence)).toEqual({ displayAnswer: 'Example: `[E1]`.', citations: [] });
  });

  it('drops unknown evidence ids', () => {
    const { displayAnswer, citations } = applyCitations('引用[[E99]]无效', sampleEvidence);
    expect(displayAnswer).not.toContain('[1]');
    expect(citations).toHaveLength(0);
  });
});

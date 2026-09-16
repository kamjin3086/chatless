import { describe, expect, it } from 'vitest';
import { mergeSourceBlocksToChunks, buildSearchText } from '@/lib/chunking/strategies/StructuredBlockMerger';
import { buildEvidenceFromChunks, formatEvidenceContext } from '@/lib/rag/EvidenceBuilder';
import { applyCitations } from '@/lib/rag/CitationService';
import { reciprocalRankFusion } from '@/lib/retrieval/RRFFusion';
import { registerEvidence, readEvidence, clearEvidenceRegistry } from '@/lib/rag/EvidenceRegistry';
import type { ParsedDocument, SourceBlock } from '@/lib/rag/evidenceTypes';

const FIXTURE_DOC: ParsedDocument = {
  title: 'Chatless 产品手册',
  fileType: 'md',
  plainText: '',
  blocks: [
    {
      id: 'b0',
      documentId: 'doc-fixture',
      blockIndex: 0,
      type: 'heading',
      text: '隐私与本地优先',
      sectionPath: ['隐私与本地优先'],
      lineStart: 1,
      lineEnd: 1,
    },
    {
      id: 'b1',
      documentId: 'doc-fixture',
      blockIndex: 1,
      type: 'paragraph',
      text: 'Chatless 是面向重视本地隐私的轻量桌面 AI 工作台，数据默认保存在本机 SQLite。',
      sectionPath: ['隐私与本地优先'],
      lineStart: 3,
      lineEnd: 3,
    },
    {
      id: 'b2',
      documentId: 'doc-fixture',
      blockIndex: 2,
      type: 'paragraph',
      text: '知识库检索采用 Evidence RAG：每个结论必须能追溯到 source_blocks 中的真实原文。',
      sectionPath: ['隐私与本地优先'],
      lineStart: 5,
      lineEnd: 5,
    },
    {
      id: 'b3',
      documentId: 'doc-fixture',
      blockIndex: 3,
      type: 'paragraph',
      text: '无关内容：本段讨论天气与旅游，不应被检索到。',
      sectionPath: ['其他'],
      lineStart: 10,
      lineEnd: 10,
    },
  ],
  metadata: {
    fileHash: 'abc123',
    parserVersion: 'native-1',
    filePath: '/docs/manual.md',
  },
};

function recallAtK(relevantIds: Set<string>, rankedIds: string[], k: number): number {
  const top = rankedIds.slice(0, k);
  const hits = top.filter((id) => relevantIds.has(id)).length;
  return relevantIds.size === 0 ? 0 : hits / relevantIds.size;
}

describe('Evidence RAG v2 pipeline (integration)', () => {
  it('searchText includes title/section and differs from sourceText', () => {
    const chunks = mergeSourceBlocksToChunks(FIXTURE_DOC, 'doc-fixture');
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.searchText).not.toBe(chunk.sourceText);
      expect(chunk.searchText).toContain('Chatless 产品手册');
      expect(buildSearchText({ title: 'T', sourceText: 'body' })).toContain('文档：T');
    }
  });

  it('builds evidence with quotes from source blocks only', () => {
    const chunks = mergeSourceBlocksToChunks(FIXTURE_DOC, 'doc-fixture').map((c, i) => ({
      ...c,
      knowledgeBaseId: 'kb-1',
      metadata: { ...c.metadata, score: 1 - i * 0.1, documentHash: 'abc123' },
    }));
    const relevantOnly = chunks.filter((c) => c.sourceText.includes('本地隐私'));
    const blocksByDoc = new Map<string, SourceBlock[]>([['doc-fixture', FIXTURE_DOC.blocks]]);
    const evidence = buildEvidenceFromChunks({ chunks: relevantOnly, blocksByDoc, limit: 4 });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].quote).toContain('本地隐私');
    expect(evidence[0].quote).not.toContain('天气与旅游');
    const ctx = formatEvidenceContext(evidence);
    expect(ctx).toContain('<EVIDENCE id="E1">');
    expect(ctx).not.toContain('天气与旅游');
  });

  it('citation validity: only registered evidence IDs render', () => {
    const chunks = mergeSourceBlocksToChunks(FIXTURE_DOC, 'doc-fixture').map((c) => ({
      ...c,
      knowledgeBaseId: 'kb-1',
      metadata: { ...c.metadata, score: 0.9 },
    }));
    const blocksByDoc = new Map<string, SourceBlock[]>([[ 'doc-fixture', FIXTURE_DOC.blocks ]]);
    const evidence = buildEvidenceFromChunks({ chunks, blocksByDoc, limit: 2 });
    const raw = `产品定位见[[E1]]，伪造引用[[E9]]应被丢弃。`;
    const { displayAnswer, citations } = applyCitations(raw, evidence);
    expect(displayAnswer).toContain('[1]');
    expect(displayAnswer).not.toContain('[[E');
    expect(displayAnswer).not.toContain('[2]');
    expect(citations).toHaveLength(1);
    expect(citations[0].quote).toBe(evidence[0].quote);
  });

  it('RRF recalls BM25-only relevant chunk in top 20', () => {
    const dense = [
      { id: 'noise-1', score: 0.95 },
      { id: 'noise-2', score: 0.9 },
      { id: 'noise-3', score: 0.85 },
    ];
    const bm25 = [
      { id: 'chk_doc-fixture_0', score: 1 },
      { id: 'noise-4', score: 0.8 },
    ];
    const fused = reciprocalRankFusion([dense, bm25], 60);
    const ids = fused.map((x) => x.id);
    const relevant = new Set(['chk_doc-fixture_0']);
    expect(recallAtK(relevant, ids, 20)).toBe(1);
  });

  it('agent evidence registry registers and reads per run', () => {
    const runId = 'run-test-1';
    clearEvidenceRegistry(runId);
    const chunks = mergeSourceBlocksToChunks(FIXTURE_DOC, 'doc-fixture');
    const blocksByDoc = new Map<string, SourceBlock[]>([[ 'doc-fixture', FIXTURE_DOC.blocks ]]);
    const evidence = buildEvidenceFromChunks({ chunks, blocksByDoc, limit: 1 });
    const registered = registerEvidence(runId, evidence);
    expect(registered[0].id).toBe('E1');
    expect(readEvidence(runId, 'E1')?.quote).toContain('本地隐私');
    clearEvidenceRegistry(runId);
    expect(readEvidence(runId, 'E1')).toBeUndefined();
  });

  it('no-evidence abstention: empty chunk list yields no citations', () => {
    const { displayAnswer, citations } = applyCitations('知识库中未找到依据。', []);
    expect(citations).toHaveLength(0);
    expect(displayAnswer).toBe('知识库中未找到依据。');
  });
});

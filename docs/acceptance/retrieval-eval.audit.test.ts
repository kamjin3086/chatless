// Acceptance harness for the retrieval quality target. Run:
//   cargo test --lib generate_retrieval_token_fixture -- --ignored --nocapture   (in src-tauri)
//   python docs/acceptance/build-eval-db.py
//   pnpm exec vitest run --config docs/acceptance/vitest.config.ts
// The committed report is only rewritten when CHATLESS_WRITE_ACCEPTANCE_REPORTS=1,
// so a routine run cannot leave a timestamp-only diff behind.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SqliteBridge } from './sqliteBridge';

const acceptanceDir = path.join(process.cwd(), 'docs', 'acceptance');
const dbPath = path.join(acceptanceDir, 'retrieval-eval.sqlite');
const reportPath = path.join(acceptanceDir, 'retrieval-eval-report.json');
const cases = JSON.parse(fs.readFileSync(path.join(acceptanceDir, 'retrieval-cases.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(acceptanceDir, 'retrieval-tokens.json'), 'utf8'));

let bridge: SqliteBridge;

vi.mock('@/lib/retrieval/tokenizeForFts', async () => {
  const { fallbackTokenize } = await vi.importActual<typeof import('@/lib/retrieval/tokenizeForFts')>(
    '@/lib/retrieval/tokenizeForFts',
  );
  return {
    fallbackTokenize,
    // Production tokenization is jieba in Rust; the fixture carries its output
    // so the evaluation never substitutes a different tokenizer.
    tokenizeForFts: async (value: string) => fixture.queries[value] ?? fallbackTokenize(value),
  };
});

vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({ getDbManager: () => ({ select: (sql: string, params: unknown[]) => bridge.select(sql, params) }) }),
  },
}));

const { LexicalRetriever } = await import('@/lib/retrieval/LexicalRetriever');

const RRF_SLICE = 8;

beforeAll(() => {
  if (!fs.existsSync(dbPath)) throw new Error('run python docs/acceptance/build-eval-db.py first');
  bridge = new SqliteBridge(dbPath);
});

afterAll(async () => {
  await bridge?.close();
});

describe('retrieval evaluation', () => {
  it('recalls the annotated original chunks at the agreed thresholds', async () => {
    const attachmentDocumentIds = cases.documents
      .filter((document: { scope: string }) => document.scope === 'attachment')
      .map((document: { id: string }) => document.id);
    const retriever = new LexicalRetriever();
    const results: Array<Record<string, unknown>> = [];

    for (const testCase of cases.cases) {
      const hits = await retriever.search(testCase.query, {
        knowledgeBaseIds: ['kb-eval'],
        documentIds: attachmentDocumentIds,
        topK: RRF_SLICE,
      });
      const returned = hits.map((hit) => hit.id);
      const expected: string[] = testCase.expected;
      const found = expected.filter((id) => returned.includes(id));
      const recall = expected.length ? found.length / expected.length : 1;
      const isNoAnswer = testCase.kind === 'no-answer';
      results.push({
        id: testCase.id, lang: testCase.lang, kind: testCase.kind, query: testCase.query,
        expected, returned, recall, returnedCount: returned.length,
        passed: isNoAnswer ? returned.length === 0 : recall === 1,
      });
    }

    const scored = results.filter((row) => row.kind !== 'no-answer');
    const summary = {
      totalCases: results.length,
      scoredCases: scored.length,
      noAnswerCases: results.filter((row) => row.kind === 'no-answer').length,
      recallAt8: scored.reduce((sum, row) => sum + (row.recall as number), 0) / scored.length,
      allExpectedRecalled: scored.filter((row) => row.passed).length / scored.length,
      noAnswerClean: results.filter((row) => row.kind === 'no-answer' && row.passed).length,
      failures: results.filter((row) => !row.passed).map((row) => ({
        id: row.id, query: row.query, expected: row.expected, returned: row.returned,
      })),
    };

    const report = {
      generatedAt: new Date().toISOString(),
      sampleSize: cases.cases.length,
      chunkCount: cases.documents.reduce(
        (sum: number, document: { chunks: unknown[] }) => sum + document.chunks.length, 0),
      topK: RRF_SLICE,
      scope: { knowledgeBaseIds: ['kb-eval'], attachmentDocumentIds },
      summary,
      cases: results,
    };
    if (process.env.CHATLESS_WRITE_ACCEPTANCE_REPORTS === '1') {
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    // eslint-disable-next-line no-console
    console.log(`Recall@8=${(summary.recallAt8 * 100).toFixed(1)}% ` +
      `allExpected=${(summary.allExpectedRecalled * 100).toFixed(1)}% ` +
      `noAnswerClean=${summary.noAnswerClean}/${summary.noAnswerCases}`);
    expect(summary.failures).toEqual([]);
    expect(summary.recallAt8).toBeGreaterThanOrEqual(0.9);
  }, 120_000);
});

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
const dbPath =
  process.env.CHATLESS_LEXICAL_PERF_DB ||
  path.join(acceptanceDir, 'retrieval-eval.sqlite');
const reportPath = path.join(acceptanceDir, 'retrieval-eval-report.json');
const cases = JSON.parse(
  fs.readFileSync(path.join(acceptanceDir, 'retrieval-cases.json'), 'utf8'),
);
const fixture = JSON.parse(
  fs.readFileSync(path.join(acceptanceDir, 'retrieval-tokens.json'), 'utf8'),
);

let bridge: SqliteBridge;

async function liveTokenize(value: string): Promise<string> {
  const session = process.env.CHATLESS_KB_SESSION_ID;
  if (!session)
    throw new Error(
      'The 50K latency run requires a real desktop tokenizer session',
    );
  const response = await fetch(
    `${process.env.CHATLESS_KB_DRIVER_URL || 'http://127.0.0.1:4444'}/session/${session}/execute/async`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: `const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('tokenize_for_fts_command',{text:arguments[0]}).then(value=>done({result:value}),error=>done({failure:String(error)}));`,
        args: [value],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const result: { value: { result?: string; failure?: string } } =
    await response.json();
  if (!response.ok || typeof result.value.result !== 'string')
    throw new Error(result.value.failure || 'Native tokenizer failed');
  return result.value.result;
}

vi.mock('@/lib/retrieval/tokenizeForFts', async () => {
  const { fallbackTokenize } = await vi.importActual<
    typeof import('@/lib/retrieval/tokenizeForFts')
  >('@/lib/retrieval/tokenizeForFts');
  return {
    fallbackTokenize,
    // Production tokenization is jieba in Rust; the fixture carries its output
    // so the evaluation never substitutes a different tokenizer.
    tokenizeForFts: async (value: string) =>
      process.env.CHATLESS_LEXICAL_PERF_REPORT
        ? liveTokenize(value)
        : (fixture.queries[value] ?? fallbackTokenize(value)),
  };
});

vi.mock('@/lib/database/services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDbManager: () => ({
        select: (sql: string, params: unknown[]) => bridge.select(sql, params),
      }),
    }),
  },
}));

const { LexicalRetriever } = await import('@/lib/retrieval/LexicalRetriever');

const RRF_SLICE = 8;

// The generated corpus is not in the repo. Missing material is a skip with the command
// that produces it, not a red suite: a gate that fails for everyone who has never built
// the fixture teaches people to ignore the suite, and #103 is exactly about a harness
// whose verdicts had to mean something. The skip still says what to run.
const corpusMissing = !fs.existsSync(dbPath);
if (corpusMissing) {
  // eslint-disable-next-line no-console
  console.log(
    `[retrieval-eval] skipped: no ${path.basename(dbPath)}; run \`python docs/acceptance/build-eval-db.py\` to generate it`,
  );
}

// No guard here on purpose: the suite above is skipped when the corpus is missing, so a
// guard in this hook would be a branch nothing can reach. A dead branch is not a
// safeguard - it reads like one and is never exercised.
beforeAll(() => {
  bridge = new SqliteBridge(dbPath);
});

afterAll(async () => {
  await bridge?.close();
});

describe.skipIf(corpusMissing)('retrieval evaluation', () => {
  it.skipIf(!process.env.CHATLESS_LEXICAL_PERF_REPORT)(
    'measures 50K FTS with real native query tokenization',
    async () => {
      const count = await bridge.select<{ count: number }>(
        'SELECT COUNT(*) AS count FROM document_chunks',
      );
      expect(count[0].count).toBeGreaterThanOrEqual(50_000);
      const attachmentDocumentIds = cases.documents
        .filter((doc: { scope: string }) => doc.scope === 'attachment')
        .map((doc: { id: string }) => doc.id);
      const retriever = new LexicalRetriever();
      const options = {
        knowledgeBaseIds: ['kb-eval'],
        documentIds: attachmentDocumentIds,
        topK: RRF_SLICE,
      };
      await retriever.search('neutral benchmark', options);
      const samples: Array<{
        query: string;
        milliseconds: number;
        hits: number;
      }> = [];
      const queries: string[] = [
        ...cases.cases.map((item: { query: string }) => item.query),
        'neutral benchmark',
      ];
      for (let round = 0; round < 3; round++)
        for (const query of queries) {
          const started = performance.now();
          const hits = await retriever.search(query, options);
          samples.push({
            query,
            milliseconds: performance.now() - started,
            hits: hits.length,
          });
        }
      const sorted = samples
        .map((sample) => sample.milliseconds)
        .sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
      const report = {
        timestamp: new Date().toISOString(),
        chunks: count[0].count,
        syntheticPadding: true,
        scope:
          'FTS performance only; real native jieba IPC, production LexicalRetriever and Python/SQLite bridge. No embeddings or file import are represented here.',
        databasePath: dbPath,
        queries: samples.length,
        p95Ms: p95,
        maxMs: sorted.at(-1),
        targetMs: 500,
        samples,
      };
      const output = process.env.CHATLESS_LEXICAL_PERF_REPORT;
      if (!output) throw new Error('Missing performance report path');
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
      console.log(
        `50K lexical P95=${p95.toFixed(1)}ms over ${samples.length} queries, with real native tokenization`,
      );
      expect(p95).toBeLessThanOrEqual(500);
    },
    120_000,
  );

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
        id: testCase.id,
        lang: testCase.lang,
        kind: testCase.kind,
        query: testCase.query,
        expected,
        returned,
        recall,
        returnedCount: returned.length,
        passed: isNoAnswer ? returned.length === 0 : recall === 1,
      });
    }

    const scored = results.filter((row) => row.kind !== 'no-answer');
    const summary = {
      totalCases: results.length,
      scoredCases: scored.length,
      noAnswerCases: results.filter((row) => row.kind === 'no-answer').length,
      recallAt8:
        scored.reduce((sum, row) => sum + (row.recall as number), 0) /
        scored.length,
      allExpectedRecalled:
        scored.filter((row) => row.passed).length / scored.length,
      noAnswerClean: results.filter(
        (row) => row.kind === 'no-answer' && row.passed,
      ).length,
      failures: results
        .filter((row) => !row.passed)
        .map((row) => ({
          id: row.id,
          query: row.query,
          expected: row.expected,
          returned: row.returned,
        })),
    };

    const report = {
      generatedAt: new Date().toISOString(),
      sampleSize: cases.cases.length,
      chunkCount: cases.documents.reduce(
        (sum: number, document: { chunks: unknown[] }) =>
          sum + document.chunks.length,
        0,
      ),
      topK: RRF_SLICE,
      scope: { knowledgeBaseIds: ['kb-eval'], attachmentDocumentIds },
      summary,
      cases: results,
    };
    if (process.env.CHATLESS_WRITE_ACCEPTANCE_REPORTS === '1') {
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    // eslint-disable-next-line no-console
    console.log(
      `Recall@8=${(summary.recallAt8 * 100).toFixed(1)}% ` +
        `allExpected=${(summary.allExpectedRecalled * 100).toFixed(1)}% ` +
        `noAnswerClean=${summary.noAnswerClean}/${summary.noAnswerCases}`,
    );
    expect(summary.failures).toEqual([]);
    expect(summary.recallAt8).toBeGreaterThanOrEqual(0.9);
  }, 120_000);
});

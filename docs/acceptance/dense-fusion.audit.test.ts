// Acceptance harness for the combined dense + fusion latency target.
//
// The dense leg is measured by the Rust benchmark, because that is where the
// scan runs:
//   $env:CHATLESS_DENSE_BENCH_OUT="$PWD/docs/acceptance/dense-bench-report.json"
//   cargo test --release --lib dense_scan_latency_on_50k_vectors -- --ignored --nocapture
// Then:
//   pnpm exec vitest run --config docs/acceptance/vitest.config.ts
//
// The vector corpus is deterministic, so this leg measures scan cost and
// ordering, not semantic quality.  Pass CHATLESS_WRITE_ACCEPTANCE_REPORTS=1 to
// rewrite the committed combined report.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '@/lib/retrieval/RRFFusion';
import { DENSE_CANDIDATE_K, BM25_CANDIDATE_K, RRF_RANK_CONSTANT } from '@/lib/rag/constants';

const acceptanceDir = path.join(process.cwd(), 'docs', 'acceptance');
const denseReportPath = process.env.CHATLESS_DENSE_BENCH_REPORT
  || path.join(acceptanceDir, 'dense-bench-report.json');
const combinedReportPath = path.join(acceptanceDir, 'dense-fusion-report.json');
const TARGET_P95_MS = 2_000;
const FUSION_SAMPLES = 200;

type Candidate = { id: string; content: string; score: number };

/** Both retrievers return the same chunk id space, so the lists really overlap. */
function rankedList(offset: number): Candidate[] {
  return Array.from({ length: DENSE_CANDIDATE_K }, (_, index) => ({
    id: `chunk-${offset + index}`,
    content: `chunk ${offset + index}`,
    score: 1 - index / DENSE_CANDIDATE_K,
  }));
}

function percentile(samples: number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * quantile));
  return sorted[index];
}

describe('dense plus fusion acceptance', () => {
  it('merges two candidate lists and stays inside the combined latency target', async () => {
    // 30 lexical + 30 dense candidates is the configured default shape.
    const dense = rankedList(0);
    const lexical = rankedList(15);

    const fused = reciprocalRankFusion([dense, lexical], RRF_RANK_CONSTANT);
    expect(fused).toHaveLength(dense.length + lexical.length - 15);
    // A chunk ranked by both lists must outrank a chunk seen by one list only.
    expect(fused[0].id).toBe('chunk-15');

    const samples: number[] = [];
    for (let index = 0; index < FUSION_SAMPLES; index += 1) {
      const started = performance.now();
      reciprocalRankFusion([dense, lexical], RRF_RANK_CONSTANT);
      samples.push(performance.now() - started);
    }
    const fusionP95Ms = percentile(samples, 0.95);

    expect(fs.existsSync(denseReportPath)).toBe(true);
    const denseReport = JSON.parse(fs.readFileSync(denseReportPath, 'utf8')) as {
      vectorCount: number; dimension: number; topK: number; scanP95Ms: number;
      scanP50Ms: number; scanMaxMs: number; top1Correct: number; queryCount: number;
      peakWorkingSetMib: number | null; databaseMib: number;
    };
    const denseP95Ms = denseReport.scanP95Ms;
    const combinedP95Ms = denseP95Ms + fusionP95Ms;

    const report = {
      generatedAt: new Date().toISOString(),
      target: { combinedP95Ms: TARGET_P95_MS, excludesQueryEmbedding: true },
      candidateWindow: { dense: DENSE_CANDIDATE_K, lexical: BM25_CANDIDATE_K, rrfRankConstant: RRF_RANK_CONSTANT },
      dense: denseReport,
      fusion: {
        samples: FUSION_SAMPLES,
        fusionP50Ms: percentile(samples, 0.5),
        fusionP95Ms,
        fusionMaxMs: Math.max(...samples),
      },
      combinedP95Ms,
      note: 'The dense corpus uses deterministic vectors, so it measures scan cost and ordering, not semantic quality. Query embedding inference is excluded.',
    };
    if (process.env.CHATLESS_WRITE_ACCEPTANCE_REPORTS === '1') {
      fs.writeFileSync(combinedReportPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    // eslint-disable-next-line no-console
    console.log(`dense P95=${denseP95Ms.toFixed(1)}ms fusion P95=${fusionP95Ms.toFixed(3)}ms `
      + `combined P95=${combinedP95Ms.toFixed(1)}ms over ${denseReport.vectorCount} vectors`
      + ` (dimension ${denseReport.dimension})`);

    expect(combinedP95Ms).toBeLessThanOrEqual(TARGET_P95_MS);
  }, 60_000);
});

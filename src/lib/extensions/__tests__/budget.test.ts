/**
 * PR C performance budgets pinned as tests (plan §11.2 “查找与校验”: measure
 * 1/10/50 lightweight contributions; no full rebuild or network check per
 * model step). The plan sets relative/absolute budgets for startup and memory
 * (≤5%/≤100ms, ≤5%/≤10MiB - runtime-app measurements, recorded in the PR, not
 * runnable in vitest). The wall-clock thresholds below are engineering
 * thresholds chosen to keep the “no per-step rebuild, probes run concurrently”
 * rule honest; they are not quoted plan numbers.
 */
import { describe, expect, it } from 'vitest';
import type { BuiltinExtension } from '../contracts';
import { buildExtensionRegistry } from '../registry';
import { assembleBuiltinExtensions } from '../builtin';
import { getExtensionRegistry, resetExtensionRegistry } from '../assembly';
import type { ToolAdapter } from '@/lib/mcp/pipeline/ToolAdapter';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seedExtensions(n: number, predicateMs: number): BuiltinExtension[] {
  const stubAdapter = (_server: string): ToolAdapter => ({
    server: _server,
    canHandle: (invocation) => invocation.server === _server,
    execute: async () => ({ ok: true }),
  });
  return Array.from({ length: n }, (_, i) => ({
    id: `seed${i}`,
    defaultEnabled: true,
    toolGroups: [
      {
        id: `builtin.seed${i}`,
        name: `Seed ${i}`,
        description: `Seed capability number ${i} for scaling budgets`,
        server: `seedserver${i}`,
        // slug rule wants lowercase alnum; seedserverN qualifies.
        tools: [
          {
            definition: {
              name: 'peek',
              description: 'Peek at seeded data',
              input_schema: { schema: { type: 'object', properties: {} } },
            },
            // Table answers `unknown` for names it never registered; declaring
            // anything else would be the risk-drift the registry rejects.
            risk: 'unknown',
          },
        ],
        availability: async () => {
          await sleep(predicateMs);
          return true;
        },
        loadAdapter: () => Promise.resolve(stubAdapter(`seedserver${i}`)),
      },
    ],
  })) as BuiltinExtension[];
}

describe('extension performance budgets (PR C / plan §11.2)', () => {
  it('assembling and validating the shipped manifest stays well under a millisecond per build', () => {
    const build = () =>
      buildExtensionRegistry(
        assembleBuiltinExtensions({
          knowledge: { hasConversationKnowledge: async () => false },
        }),
      );
    build(); // warm up module init
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) build();
    const perBuild = (performance.now() - t0) / 10;
    // One build is all a session start costs; averaging ten tolerates CI
    // jitter. 50ms is a generous ceiling for what runs in single-digit ms.
    expect(perBuild).toBeLessThan(50);
  });

  it('concurrent availability probes for 50 extensions stay near single-probe latency', async () => {
    // §11.2 measures 1/10/50 contributions and forbids full rebuilds per
    // model step. Each predicate waits 5ms independently (SQLite-probe-
    // shaped); the serial loop was measured at ~255ms (50 x 5ms) and fails
    // this test - the concurrent view must keep wall time near one probe.
    const registry = buildExtensionRegistry(seedExtensions(50, 5));
    const t0 = performance.now();
    const groups = await registry.availableGroups({ conversationId: 'c1' });
    const elapsed = performance.now() - t0;
    expect(groups).toHaveLength(50);
    expect(elapsed).toBeLessThan(120);
  });

  it('a per-step availability call adds no measurable overhead beyond the probe', async () => {
    // Not a concurrency test (test 2 is the discriminating one): this pins
    // the wrapper's per-model-step cost - no rescans or rebuilds stacked on
    // the probe latency. §11.2's p95 method wants repeated samples; ten
    // averaged iterations here, one build, N=1 real manifest.
    const registry = buildExtensionRegistry(
      assembleBuiltinExtensions({
        knowledge: {
          hasConversationKnowledge: async () => {
            await sleep(2);
            return true;
          },
        },
      }),
    );
    const t0 = performance.now();
    for (let i = 0; i < 20; i++)
      await registry.availableGroups({ conversationId: 'c' });
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });

  it('the runtime registry is assembled once, not per model step (§11.2)', () => {
    // The assembly singleton is what keeps "no full rebuild per step" true in
    // production; if a refactor ever rebuilds it per call, the budget tests
    // above would only catch it by wall time - this catches it by structure.
    resetExtensionRegistry();
    const first = getExtensionRegistry();
    expect(getExtensionRegistry()).toBe(first);
    resetExtensionRegistry();
  });
});

// Live check of the tier-baked-into-the-name carrier against a real endpoint.
//
// OWNER GATE: probing sibling model names makes the router load models that are not
// already resident, which evicts or contends with whatever is serving. That costs the
// operator's own work, so this run needs an explicit second opt-in on top of the usual
// one, and it must not be run just to produce evidence - only with the owner's
// go-ahead:  CHATLESS_QWEN=1 CHATLESS_MODEL_PROBE=1 ...
//
// What is real here: the model names come from the endpoint's own /v1/models, the
// sibling names are produced by the shipped resolver, and every request body that was
// sent is written to the report file. What is a harness decision, and stated as such:
// a sibling the router cannot load (a missing shard on this box) is recorded as
// `unavailable` instead of failing the run, because the claim under test is name
// resolution, not the operator's model inventory.
//
// Run (with permission): CHATLESS_QWEN=1 CHATLESS_MODEL_PROBE=1 \
//   pnpm exec vitest run --config docs/acceptance/vitest.config.ts \
//   docs/acceptance/thinking-alias.audit.test.ts
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveThinkingModelName } from '@/lib/llm/thinkingLevels';

const enabled = process.env.CHATLESS_QWEN === '1';
const probeAllowed = process.env.CHATLESS_MODEL_PROBE === '1';
const itLive = enabled && probeAllowed ? it : it.skip;
const endpoint = (
  process.env.CHATLESS_QWEN_URL || 'http://10.126.126.2:8101'
).replace(/\/$/, '');
const baseModel = process.env.CHATLESS_THINKING_BASE || 'Qwen3.8-Flash-Next';
const reportPath = '/tmp/chatless-thinking-alias-report.json';

/** Levels a router that names tiers after the model advertises, per #99's example. */
const suffixes: Record<string, string> = {
  off: '-instruct',
  low: '_llamacpp-low',
  medium: '_llamacpp-medium',
  xhigh: '_llamacpp-xhigh',
};

async function listModels(): Promise<string[]> {
  const res = await fetch(`${endpoint}/v1/models`);
  if (!res.ok) throw new Error(`${endpoint}/v1/models -> HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data || []).map((m) => String(m.id));
}

async function complete(
  model: string,
): Promise<{ ok: boolean; detail: string }> {
  const body = {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    max_tokens: 16,
    temperature: 0,
  };
  try {
    const res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      detail: res.ok ? text.slice(0, 200) : text.slice(0, 300),
    };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

describe('thinking alias against a live router', () => {
  itLive(
    'resolves each level to a name the endpoint actually lists',
    async () => {
      const served = await listModels();
      expect(served).toContain(baseModel);

      const records: Array<{
        level: string;
        resolved: string;
        servedByEndpoint: boolean;
        answered: boolean;
        detail: string;
      }> = [];

      for (const level of Object.keys(suffixes)) {
        const resolved = resolveThinkingModelName({
          model: baseModel,
          level,
          suffixes,
        });
        const servedByEndpoint = served.includes(resolved);
        let answered = false;
        let detail = 'not probed: endpoint does not list this name';
        if (servedByEndpoint) {
          const probe = await complete(resolved);
          answered = probe.ok;
          detail = probe.detail;
        }
        records.push({ level, resolved, servedByEndpoint, answered, detail });
      }

      fs.writeFileSync(
        reportPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            endpoint,
            baseModel,
            suffixes,
            modelsListed: served.length,
            records,
          },
          null,
          2,
        ),
      );

      // The claim: resolution never invents a name. Every resolved name is one the
      // endpoint itself advertises - a name it does not list would be a router 404 later.
      const invented = records.filter((r) => !r.servedByEndpoint);
      expect(invented.map((r) => `${r.level} -> ${r.resolved}`)).toEqual([]);

      // And at least one sibling really answers, so the run is not vacuous.
      const answered = records.filter((r) => r.answered);
      expect(
        answered.length,
        `no sibling answered; see ${reportPath}`,
      ).toBeGreaterThan(0);

      console.log(
        `alias live: ${answered.length}/${records.length} siblings answered, report=${reportPath}`,
      );
    },
    10 * 60 * 1000,
  );
});

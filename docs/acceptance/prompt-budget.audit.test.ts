/**
 * Prompt budget, measured (#104).
 *
 * This audit is deterministic and needs no endpoint: it builds the same envelope the app
 * sends and sizes it. It exists because the budget assertion used a Chinese-text divisor
 * (`JSON.stringify(x).length / 2.5`) on English JSON, which inflated 9417 characters of
 * English tool schemas into 3767 "tokens" and pushed the total past a cap nobody had
 * re-derived since the tool count grew.
 *
 * Divisor choice, stated: `docs/prompt-language.md` makes every model-facing prompt
 * English - the agent contract, every tool description, every schema. So sizing uses the
 * language-aware estimator (CJK ≈ 1 token/char, everything else ≈ 4 chars/token), which
 * is the rule this repo already documents elsewhere, not a fresh constant. It is an
 * estimate, not a tokenizer: the only real count is the endpoint's, and this gate exists
 * to notice when the prompt grows.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAgentContractBlock } from '@/lib/mcp/prompt/agentContract';
import { composeSystemPrompt } from '@/lib/mcp/prompt/composition';
import {
  TOOLS_REGISTRY_TOOLS,
  getToolsForGroup,
} from '@/lib/mcp/nativeTools/toolRegistry';
import { PromptEnvelopeBuilder } from '@/lib/mcp/pipeline/context/PromptEnvelopeBuilder';
import {
  NON_CJK_CHARS_PER_TOKEN,
  PROMPT_AND_TOOLS_TOKEN_CAP,
  legacyCharDivisorEstimate,
  promptTokenEstimate,
  schemaTokenEstimate,
} from '@/lib/tokens/promptSize';

function schemas(group: 'knowledge' | 'none') {
  const defs = [
    ...getToolsForGroup('core'),
    ...TOOLS_REGISTRY_TOOLS.map((tool) => ({ server: 'tools', tool })),
  ].map(({ server, tool }) => ({
    name: `${server}__${tool.name}`,
    description: tool.description,
    parameters: (tool.input_schema as { schema?: unknown }).schema,
  }));
  if (group === 'none') return defs;
  return [
    ...defs,
    ...getToolsForGroup('knowledge').map(({ server, tool }) => ({
      name: `${server}__${tool.name}`,
      description: tool.description,
      parameters: (tool.input_schema as { schema?: unknown }).schema,
    })),
  ];
}

function envelopeFor(tools: ReturnType<typeof schemas>) {
  // The production contract, not a copy of it. No locale argument: it is English for
  // every provider.
  const built = new PromptEnvelopeBuilder().build({
    systemMessage: composeSystemPrompt([buildAgentContractBlock()])
      .systemMessage,
    tools: tools as never,
  });
  const prompt = built.prefixMessages
    .map((message) => String(message.content))
    .join('\n\n');
  return {
    prompt,
    tools: built.tools,
    promptTokens: promptTokenEstimate(prompt),
    toolTokens: schemaTokenEstimate(built.tools),
  };
}

describe('prompt budget is measured with the documented language', () => {
  const base = envelopeFor(schemas('none'));
  const withKnowledge = envelopeFor(schemas('knowledge'));

  it('the contract really is English, as the docs promise', () => {
    // If someone starts sending Chinese prompts, this fails and points at the place that
    // has to be revisited: the estimator assumes English for anything that is not CJK.
    const policy = readFileSync('docs/prompt-language.md', 'utf8');
    expect(policy).toMatch(/English/i);
    const cjk = /[一-鿿]/.test(base.prompt);
    expect(
      cjk,
      'the agent contract now contains CJK text; docs/prompt-language.md and the sizing divisor in src/lib/tokens/promptSize.ts disagree',
    ).toBe(false);
  });

  it('sizes English schemas at the English divisor, not the Chinese one', () => {
    const chars = JSON.stringify(base.tools).length;
    const ratio = chars / base.toolTokens;
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThanOrEqual(NON_CJK_CHARS_PER_TOKEN);
    // The old rule is still computable, and it is still wrong by a wide margin: this is
    // the assertion that fails if anybody routes the budget back through /2.5.
    expect(base.toolTokens).toBeLessThan(legacyCharDivisorEstimate(base.tools));
  });

  it('fits both variants under the cap, with the cap still meaning something', () => {
    const totals = {
      contract: base.promptTokens,
      base: base.promptTokens + base.toolTokens,
      withKnowledge: withKnowledge.promptTokens + withKnowledge.toolTokens,
      tools: base.tools.length,
      toolsWithKnowledge: withKnowledge.tools.length,
      schemaChars: JSON.stringify(base.tools).length,
      schemaCharsWithKnowledge: JSON.stringify(withKnowledge.tools).length,
    };
    // eslint-disable-next-line no-console
    console.log('[prompt-budget]', JSON.stringify(totals));

    expect(totals.withKnowledge).toBeLessThanOrEqual(
      PROMPT_AND_TOOLS_TOKEN_CAP,
    );
    expect(totals.base).toBeLessThanOrEqual(PROMPT_AND_TOOLS_TOKEN_CAP);
    // A cap that is never approached is not a budget either; half the cap means the
    // number has drifted from what is actually sent and should be re-derived.
    expect(totals.withKnowledge).toBeGreaterThan(
      PROMPT_AND_TOOLS_TOKEN_CAP / 2,
    );
  });

  it('has not drifted from the measurement the cap was derived from', () => {
    // Deliberately tight: a tool added or a paragraph in the contract must be a
    // deliberate act, and this is where it shows up.
    expect(base.promptTokens).toBeLessThanOrEqual(600);
    expect(base.toolTokens).toBeLessThanOrEqual(2500);
    expect(withKnowledge.toolTokens).toBeLessThanOrEqual(3100);
  });
});

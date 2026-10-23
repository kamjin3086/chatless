/**
 * Which track a run takes (#162, spec #161).
 *
 * The bug behind this: on endpoint names the table does not know (`custom` / `unknown` - most
 * aggregator endpoints), the run was treated as "no tools at all", so the model was told about
 * `knowledge__*` and given no way to call it. `experimental` was dead for the same reason: only
 * `=== 'native'` counted.
 *
 * The rows below are the endpoints from the field report.
 */
import { describe, expect, it } from 'vitest';
import { resolveAgentToolCapability } from '../resolveAgentToolCapability';
import { trackFor } from '@/lib/llm/types/tool-capability';

describe('the tool track for the endpoints in #161', () => {
  it('unknown endpoints get the prompt track, not chat-only', () => {
    const rows = [
      ['homelab', 'Qwen3.6-35B-A3B'],
      ['New API', 'Qwen3.8-27B'],
      ['302AI', 'DeepSeek-V4-Flash'],
    ] as const;
    for (const [provider, model] of rows) {
      const cap = resolveAgentToolCapability(provider, model);
      expect(cap.track, provider).toBe('prompt');
      expect(cap.useNativeTools, provider).toBe(false);
      expect(cap.renderMode, provider).toBe('text_wrapper');
    }
  });

  it('an experimental model is usable rather than dead', () => {
    // GPT-Load OpenAI infers as `openai`, and this model row is `experimental`.
    const cap = resolveAgentToolCapability('GPT-Load OpenAI', 'Gemma-4-31B-IT');
    expect(cap.track).toBe('native');
    expect(cap.useNativeTools).toBe(true);
    expect(cap.renderMode).toBe('tool_role');
  });

  it('a known native provider stays native', () => {
    expect(resolveAgentToolCapability('OpenAI', 'gpt-4o').track).toBe('native');
  });
});

describe('the strategy the user picked wins over the table', () => {
  it('maps each strategy onto a track', () => {
    expect(trackFor('native', 'prompt')).toBe('native');
    expect(trackFor('prompt', 'native')).toBe('prompt');
    expect(trackFor('disabled', 'native')).toBe('disabled');
    // `auto` is the table's answer, with an experimental model counting as usable.
    expect(trackFor('auto', 'experimental')).toBe('native');
    expect(trackFor('auto', 'native')).toBe('native');
    expect(trackFor('auto', 'prompt')).toBe('prompt');
    expect(trackFor('auto', 'none')).toBe('disabled');
  });
});

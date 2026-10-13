/**
 * Request-body seam for Anthropic thinking levels (criterion 5 of #98): every level,
 * `off`, and the combination the API refuses. `buildAnthropicRequestOptions` is what
 * `AnthropicProvider.streamChat` spreads into the body, after the policy engine has run.
 */
import { describe, expect, it } from 'vitest';
import { buildAnthropicRequestOptions } from '../AnthropicProvider';
import { ParameterPolicyEngine } from '../../ParameterPolicy';

function bodyFor(model: string, options: Record<string, any>) {
  return buildAnthropicRequestOptions(
    ParameterPolicyEngine.apply('Anthropic', model, options),
  );
}

describe('Anthropic request body carries the choice', () => {
  it('every level arrives as an effort, and max_tokens is still there', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const body = bodyFor('claude-sonnet-5', { thinkingLevel: level });
      expect(body.output_config).toEqual({ effort: level });
      // max_tokens is a required field for this API, whatever the thinking choice is.
      expect(Number(body.max_tokens)).toBeGreaterThan(0);
      expect(JSON.stringify(body)).not.toContain('budget_tokens');
    }
  });

  it('off arrives as an explicit thinking configuration', () => {
    expect(bodyFor('claude-opus-5', { thinkingLevel: 'off' }).thinking).toEqual(
      {
        type: 'disabled',
      },
    );
    expect(
      bodyFor('claude-sonnet-5-5', { thinkingLevel: 'off' }).thinking,
    ).toEqual({
      type: 'between_tools',
    });
  });

  it('the impossible combination is passed through, not quietly repaired', () => {
    // `thinking: disabled` together with `xhigh` is a documented 400 on Opus 5. The
    // policy layer does not adjust it, because silently lowering a number the user
    // wrote is the failure this ticket names. Repairing happens in the dialog, before
    // anything is stored, and the body is what the API would have seen.
    const body = bodyFor('claude-opus-5', {
      thinkingLevel: 'off',
      output_config: { effort: 'xhigh' },
      max_tokens: 4096,
    });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config).toEqual({ effort: 'xhigh' });
    expect(body.max_tokens).toBe(4096);
  });

  it('drops the boolean this API has never accepted', () => {
    // The older "does it think" switch is a boolean elsewhere; for Anthropic it would
    // have been sent as `thinking: true`, which is not a thinking configuration.
    expect(bodyFor('claude-opus-5', { thinking: true })).not.toHaveProperty(
      'thinking',
    );
    expect(bodyFor('claude-opus-5', { thinking: false })).not.toHaveProperty(
      'thinking',
    );
  });

  it('keeps a manual budget a user wrote on a model that still uses it', () => {
    const body = bodyFor('claude-opus-4-5', {
      max_tokens: 16000,
      thinking: { type: 'enabled', budget_tokens: 4000 },
    });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4000 });
  });
});

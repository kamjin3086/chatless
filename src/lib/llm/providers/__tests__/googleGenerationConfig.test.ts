/**
 * The claim in #97 is about the request body, so it is asserted at the seam that builds
 * the body rather than only at the option table. `buildGeminiGenerationConfig` is the
 * function `GoogleAIProvider.streamChat` uses; the policy engine runs before it, exactly
 * as it does on the real path.
 */
import { describe, expect, it } from 'vitest';
import { buildGeminiGenerationConfig } from '../GoogleAIProvider';
import { ParameterPolicyEngine } from '../../ParameterPolicy';

function bodyFor(model: string, options: Record<string, any>) {
  const refined = ParameterPolicyEngine.apply('Google AI', model, options);
  return buildGeminiGenerationConfig(refined);
}

describe('Gemini request body carries the choice', () => {
  it('a 3-series model gets thinkingConfig.thinkingLevel and nothing else thinking-shaped', () => {
    const config = bodyFor('gemini-3.1-pro', {
      thinkingLevel: 'high',
      temperature: 0.2,
    });
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'high' });
    expect(config.temperature).toBe(0.2);
  });

  it('a 2.5 model gets thinkingConfig.thinkingBudget, including the explicit zero', () => {
    expect(
      bodyFor('gemini-2.5-flash', { thinkingLevel: 'off' }).thinkingConfig,
    ).toEqual({
      thinkingBudget: 0,
    });
    expect(
      bodyFor('gemini-2.5-pro', { thinkingLevel: 'low' }).thinkingConfig,
    ).toEqual({ thinkingBudget: 1024 });
  });

  it('leaves thinking alone entirely when no level was chosen', () => {
    expect(
      bodyFor('gemini-2.5-flash', { temperature: 0.5 }).thinkingConfig,
    ).toBeUndefined();
  });
});

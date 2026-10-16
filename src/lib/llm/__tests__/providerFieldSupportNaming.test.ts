import { describe, expect, it } from 'vitest';
import { getProviderConfig } from '../provider-field-support';

/**
 * These rows are what the parameter dialogs use to decide which controls exist, so a row
 * that is never matched does not fail loudly - it just quietly shows the wrong controls.
 * The names on screen are the labels, not the row keys, and that mismatch is the bug.
 */
describe('looking up a provider by the name the app uses', () => {
  it.each([
    ['Google AI', 'minP'],
    ['Google AI', 'topK'],
    ['Anthropic', 'topK'],
    ['Ollama', 'minP'],
    ['DeepSeek', 'presencePenalty'],
  ] as const)('%s reports that it takes %s', (provider, field) => {
    expect(getProviderConfig(provider).support[field]).toBe(true);
  });

  it('does not answer for Gemini with the OpenAI-shaped fallback', () => {
    // The fallback maps maxTokens to max_tokens; Gemini's generationConfig wants
    // maxOutputTokens, which is what the row says.
    expect(getProviderConfig('Google AI').fieldMapping?.maxTokens).toBe(
      'maxOutputTokens',
    );
  });

  it('is not changed for a provider whose name already matched', () => {
    expect(getProviderConfig('anthropic').fieldMapping?.stop).toBe(
      'stop_sequences',
    );
  });
});

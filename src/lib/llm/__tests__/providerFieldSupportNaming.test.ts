import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_CONFIG,
  PROVIDER_CONFIGS,
  getProviderConfig,
  normalizeProviderName,
  resolveProviderConfig,
} from '../provider-field-support';

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

  it('does not offer chat-only controls to the Responses endpoint', () => {
    const responses = resolveProviderConfig('OpenAI (Responses)');
    expect(responses.row).toBe('openai-responses');
    expect(responses.config.support.temperature).toBe(true);
    expect(responses.config.support.maxTokens).toBe(true);
    for (const field of [
      'frequencyPenalty',
      'presencePenalty',
      'stopSequences',
      'topK',
      'minP',
      'format',
    ] as const) {
      expect(responses.config.support[field]).toBeUndefined();
    }
  });
});

/**
 * A label that normalizes to a row is the "future provider whose display name differs
 * from its id" case. The normalizer is the explicit step, so a new label either lands on
 * a row or reports that it did not - it cannot fall through without saying so.
 */
describe('normalizing the label the app shows', () => {
  it.each([
    ['Google AI', 'google-ai'],
    ['google_ai', 'google-ai'],
    ['  OpenAI / Compatible  ', 'openai-compatible'],
    ['DeepSeek', 'deepseek'],
    ['!!!', ''],
  ] as const)('%j -> %j', (label, key) => {
    expect(normalizeProviderName(label)).toBe(key);
  });

  it('resolves a label and its row key to the same row', () => {
    const byLabel = resolveProviderConfig('Google AI');
    const byRow = resolveProviderConfig('google-ai');

    expect(byLabel.source).toBe('exact');
    expect(byLabel.row).toBe('google-ai');
    expect(byLabel.config).toBe(byRow.config);
  });

  it('says so when no row claims the name', () => {
    const resolved = resolveProviderConfig('my-self-hosted-endpoint');

    expect(resolved.source).toBe('default');
    expect(resolved.row).toBeNull();
    expect(resolved.config).toBe(DEFAULT_PROVIDER_CONFIG);
  });

  it('falls back to the documented OpenAI-compatible shape', () => {
    const { config } = resolveProviderConfig('my-self-hosted-endpoint');

    expect(config.fieldMapping.maxTokens).toBe('max_tokens');
    expect(config.support.topK).toBeUndefined();
  });
});

/**
 * One row per field is the whole point: the control the dialog shows and the name the
 * request path will send come from the same entry, so they cannot disagree.
 */
describe('a provider field is declared once', () => {
  it('derives the control and the wire name from the same row', () => {
    const google = resolveProviderConfig('Google AI').config;

    expect(google.fields.topK).toBe('topK');
    expect(google.support.topK).toBe(true);
    expect(google.fields.minP).toBe('minP');
    expect(google.support.minP).toBe(true);
  });

  it('derives the aliases the request path may pass for a row', () => {
    expect(PROVIDER_CONFIGS.openai.fieldMapping.maxOutputTokens).toBe(
      'max_tokens',
    );
    expect(PROVIDER_CONFIGS.ollama.fieldMapping.maxOutputTokens).toBe(
      'num_predict',
    );
    expect(PROVIDER_CONFIGS.anthropic.fieldMapping.stopSequences).toBe(
      'stop_sequences',
    );
  });

  it('offers no control for a field the provider has no row for', () => {
    expect(PROVIDER_CONFIGS.openai.fields.topK).toBeUndefined();
    expect(PROVIDER_CONFIGS.openai.support.topK).toBeUndefined();
  });
});

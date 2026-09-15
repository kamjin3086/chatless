import { describe, expect, it } from 'vitest';
import { resolveChatSetupState } from '@/lib/chat/resolveChatSetupState';

describe('resolveChatSetupState', () => {
  it('returns initializing when llm not ready', () => {
    expect(resolveChatSetupState(false, [], null)).toBe('initializing');
  });

  it('returns no_provider when metadata empty', () => {
    expect(resolveChatSetupState(true, [], null)).toBe('no_provider');
  });

  it('returns no_model when no models available', () => {
    const meta = [{ name: 'Lemonade', models: [] }] as any;
    expect(resolveChatSetupState(true, meta, null)).toBe('no_model');
  });

  it('returns ready when model selected', () => {
    const meta = [{ name: 'Lemonade', models: [{ name: 'qwen' }] }] as any;
    expect(resolveChatSetupState(true, meta, 'qwen')).toBe('ready');
  });
});

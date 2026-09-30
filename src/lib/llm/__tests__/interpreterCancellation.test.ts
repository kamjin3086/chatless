import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMInterpreter } from '../interpreter';
import { ProviderRegistry } from '../ProviderRegistry';

afterEach(() => ProviderRegistry.clear());

describe('LLMInterpreter request cancellation', () => {
  it('keeps an SSE-style provider associated until its terminal callback', async () => {
    let callbacks: any;
    const provider = {
      name: 'fixture',
      chatStream: vi.fn(async (_model, _messages, received) => { callbacks = received; }),
      cancelStream: vi.fn(),
    };
    ProviderRegistry.register(provider as any);
    const interpreter = new LLMInterpreter();

    await interpreter.streamChat('fixture', 'model', [], {}, { __requestId: 'request-a' });
    interpreter.cancelStream('request-a');
    expect(provider.cancelStream).toHaveBeenCalledOnce();

    callbacks.onComplete();
    interpreter.cancelStream('request-a');
    expect(provider.cancelStream).toHaveBeenCalledOnce();
  });
});

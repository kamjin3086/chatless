import { describe, expect, it } from 'vitest';
import { toGeminiContent, toOpenAIMessage } from '../messageMapping';

describe('provider message mapping', () => {
  it('keeps Gemini assistant role and tool-call text', () => {
    expect(toGeminiContent({ role: 'assistant', content: 'answer' })).toEqual({ role: 'model', parts: [{ text: 'answer' }] });
    expect(toGeminiContent({ role: 'assistant', content: 'Checking.', tool_calls: [{
      id: 'a', type: 'function', function: { name: 'fs__read', arguments: '{"path":"a"}' }, providerData: { thoughtSignature: 'signed' },
    }] })).toEqual({ role: 'model', parts: [
      { text: 'Checking.' }, { functionCall: { name: 'fs__read', args: { path: 'a' } }, thoughtSignature: 'signed' },
    ] });
  });

  it.each(['plain text', 'null', '[1,2]', 'false'])('wraps non-object Gemini tool output: %s', (content) => {
    const result = toGeminiContent({ role: 'tool', name: 'fs__read', content });
    expect((result.parts[0].functionResponse as any).response).toHaveProperty('result');
  });

  it('preserves images in both protocols', () => {
    const message = { role: 'user', content: 'describe', images: ['data:image/png;base64,YQ=='] };
    expect(toGeminiContent(message).parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'YQ==' } });
    expect((toOpenAIMessage(message).content as any[])[1].image_url.url).toBe(message.images[0]);
  });

  it('replays reasoning at message level without overwriting tool protocol fields', () => {
    const result = toOpenAIMessage({ role: 'assistant', content: '', providerData: { reasoning_content: 'reasoning' }, tool_calls: [{
      id: 'actual', type: 'function', function: { name: 'fs__read', arguments: '{}' },
      providerData: { id: 'wrong', reasoning_content: 'reasoning' },
    }] });
    expect(result.reasoning_content).toBe('reasoning');
    expect(result.tool_calls).toEqual([{ id: 'actual', type: 'function', function: { name: 'fs__read', arguments: '{}' } }]);
  });
});

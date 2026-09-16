import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextWindowManager, estimateTokens } from '../ContextWindowManager';
import { chat } from '@/lib/llm';
import type { Message } from '@/lib/llm/types';

vi.mock('@/lib/llm', () => ({ chat: vi.fn() }));
const manager = new ContextWindowManager();
const opts = { provider: 'test', model: 'Qwen3.8-Flash-Next', allowSummarize: true };
beforeEach(() => vi.resetAllMocks());

describe('context preservation', () => {
  it.each([8192, 32768, 262144])('leaves small histories intact at %i tokens', async (contextWindowTokens) => {
    const history: Message[] = [{ role: 'user', content: 'hello' }];
    expect(await manager.compact(history, { ...opts, contextWindowTokens })).toBe(history);
    expect(chat).not.toHaveBeenCalled();
  });

  it('counts tools, opaque protocol data and images', async () => {
    expect(estimateTokens([{ role: 'user', content: '', images: ['x'.repeat(10000)] }])).toBeGreaterThan(4000);
    expect(estimateTokens([{ role: 'assistant', content: '', providerData: { reasoning_content: 'x'.repeat(10000) } }])).toBeGreaterThan(4000);
    await expect(manager.compact([], { ...opts, tools: ['x'.repeat(30000)] })).rejects.toThrow('预算不足');
  });

  it('rejects an oversized single turn without a fake summary', async () => {
    const history: Message[] = [{ role: 'user', content: 'x'.repeat(25000) }];
    const snapshot = structuredClone(history);
    await expect(manager.compact(history, opts)).rejects.toThrow('原始历史已保留');
    expect(history).toEqual(snapshot);
    expect(chat).not.toHaveBeenCalled();
  });

  const history: Message[] = [
    { role: 'user', content: 'Preserve these constraints. '.repeat(400) },
    { role: 'assistant', content: 'Prior work.' },
    { role: 'user', content: 'Continue.' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'fs__read', arguments: '{}' } }] },
    { role: 'tool', content: 'file contents', tool_call_id: 'a' },
  ];
  it('keeps the latest tool round together', async () => {
    vi.mocked(chat).mockResolvedValue({ content: 'Constraints and prior work.' } as any);
    const result = await manager.compact(history, { ...opts, maxInputTokens: 3000, keepLastN: 1 });
    expect(result.slice(1)).toEqual(history.slice(2));
    expect(chat).toHaveBeenCalledOnce();
  });

  it('propagates summary failure instead of discarding constraints', async () => {
    vi.mocked(chat).mockRejectedValue(new Error('model offline'));
    const snapshot = structuredClone(history);
    await expect(manager.compact(history, { ...opts, maxInputTokens: 3000, keepLastN: 1 })).rejects.toThrow('model offline');
    expect(history).toEqual(snapshot);
  });

  it('rejects an empty summary and over-budget summary output', async () => {
    vi.mocked(chat).mockResolvedValueOnce({ content: '' } as any).mockResolvedValueOnce({ content: 'x'.repeat(15000) } as any);
    await expect(manager.compact(history, { ...opts, maxInputTokens: 3000, keepLastN: 1 })).rejects.toThrow('空摘要');
    await expect(manager.compact(history, { ...opts, maxInputTokens: 3000, keepLastN: 1 })).rejects.toThrow('压缩后仍超出');
  });
});

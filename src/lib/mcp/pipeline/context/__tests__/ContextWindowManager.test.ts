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
    // 已知窗口下，提示词+工具定义占满窗口必须报错（证明工具确实被计入预算）。
    await expect(manager.compact([], { ...opts, contextWindowTokens: 8192, tools: ['x'.repeat(30000)] }))
      .rejects.toThrow('预算不足');
    // 窗口未知时同样只做保守规划，不阻断发送。
    await expect(manager.compact([], { ...opts, tools: ['x'.repeat(30000)] })).resolves.toEqual([]);
  });

  it('rejects an oversized single turn without a fake summary when the window is known', async () => {
    const history: Message[] = [{ role: 'user', content: 'x'.repeat(25000) }];
    const snapshot = structuredClone(history);
    await expect(manager.compact(history, { ...opts, contextWindowTokens: 8192 })).rejects.toThrow('原始历史已保留');
    expect(history).toEqual(snapshot);
    expect(chat).not.toHaveBeenCalled();
  });

  it('never compacts or fails when the window is unknown', async () => {
    // 真实场景：服务端没上报窗口（或还没被记录）。没有依据时既不压缩历史，
    // 也不用猜测值让整轮发送失败——之前按 8K 猜，正常一轮会被误判超预算。
    const history: Message[] = [{ role: 'user', content: 'x'.repeat(25000) }];
    const snapshot = structuredClone(history);
    const result = await manager.compact(history, opts);
    expect(result).toBe(history);
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
    // 压缩必须以真实窗口为依据：窗口未知时不压缩（见下一条测试）。
    const result = await manager.compact(history, { ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1 });
    expect(result.slice(1)).toEqual(history.slice(2));
    expect(chat).toHaveBeenCalledOnce();
  });

  it('propagates summary failure instead of discarding constraints', async () => {
    vi.mocked(chat).mockRejectedValue(new Error('model offline'));
    const snapshot = structuredClone(history);
    await expect(manager.compact(history, { ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1 })).rejects.toThrow('model offline');
    expect(history).toEqual(snapshot);
  });

  it('rejects an empty summary and over-budget summary output', async () => {
    vi.mocked(chat).mockResolvedValueOnce({ content: '' } as any).mockResolvedValueOnce({ content: 'x'.repeat(15000) } as any);
    await expect(manager.compact(history, { ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1 })).rejects.toThrow('空摘要');
    await expect(manager.compact(history, { ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1 })).rejects.toThrow('压缩后仍超出');
  });

  const longHistory = (count: number): Message[] =>
    Array.from({ length: count }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as Message['role'],
      content: `MSG-${i} ${'x'.repeat(800)}`,
    }));

  it('reuses the checkpoint without another summary request when nothing changed', async () => {
    vi.mocked(chat).mockResolvedValue({ content: 'S1' } as any);
    const history = longHistory(12);
    let checkpoint: any;
    await manager.compact(history, {
      ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1,
      onCheckpoint: async (cp) => { checkpoint = cp; },
    });
    expect(checkpoint?.summary).toBe('S1');
    const callsAfterFirst = vi.mocked(chat).mock.calls.length;

    const info: any = {};
    const again = await manager.compact(history, {
      ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1,
      checkpoint,
      onCompacted: (i) => { info.value = i; },
    });

    expect(vi.mocked(chat).mock.calls.length).toBe(callsAfterFirst);
    expect(info.value?.reused).toBe(true);
    expect(String((again[0] as any).content)).toContain('[Conversation summary]');
  });

  it('continues from an older checkpoint instead of re-summarizing the whole history', async () => {
    vi.mocked(chat).mockResolvedValue({ content: 'S1' } as any);
    let checkpoint: any;
    await manager.compact(longHistory(12), {
      ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1,
      onCheckpoint: async (cp) => { checkpoint = cp; },
    });

    // 会话继续：只追加了两条新消息，被压缩的那段前缀没变。
    vi.mocked(chat).mockResolvedValue({ content: 'S2' } as any);
    const info: any = {};
    await manager.compact(longHistory(14), {
      ...opts, contextWindowTokens: 8192, maxInputTokens: 3000, keepLastN: 1,
      checkpoint,
      onCompacted: (i) => { info.value = i; },
    });

    const prompt = JSON.stringify(vi.mocked(chat).mock.calls.at(-1)?.[2] || []);
    // 旧摘要被带上继续写，且最早的消息不再重复送进摘要请求。
    expect(prompt).toContain('[Existing summary]');
    expect(prompt).toContain('S1');
    expect(prompt).not.toContain('MSG-0');
    expect(info.value?.reused).toBe(false);
    expect(info.value?.coveredMessages).toBeGreaterThan(checkpoint.coveredMessages);
  });
});

import { describe, expect, it } from 'vitest';
import { mergeManualModels } from '@/lib/provider/manualModelAdd';
import { modelRepository } from '@/lib/provider/ModelRepository';

describe('mergeManualModels', () => {
  it('appends the added model without writing into the array the repository handed out', async () => {
    const provider = `__test_manual_merge_${Date.now()}`;
    // 设置页挂载时先读一次，缓存里于是有了一份列表；弹窗再读拿到的是同一个数组。
    await modelRepository.get(provider);
    const cached = (await modelRepository.get(provider))!;

    const list = mergeManualModels(provider, cached, [
      { id: 'qwen-test', label: 'qwen-test' },
    ]);

    expect(cached).toHaveLength(0);
    expect(list.map((m) => m.name)).toEqual(['qwen-test']);
  });

  it('notifies subscribers so a manual add shows up in the model list immediately', async () => {
    const provider = `__test_manual_notify_${Date.now()}`;
    await modelRepository.get(provider);
    const cached = (await modelRepository.get(provider))!;

    let notifies = 0;
    const off = modelRepository.subscribeAll(() => {
      notifies += 1;
    });

    await modelRepository.save(
      provider,
      mergeManualModels(provider, cached, [
        { id: 'qwen-test', label: 'qwen-test' },
      ]),
    );
    off();

    expect(notifies).toBe(1);
    expect((await modelRepository.get(provider))!.map((m) => m.name)).toEqual([
      'qwen-test',
    ]);
    expect((await modelRepository.get(provider))![0].label).toBe('qwen-test');
  });

  it('updates the label of an existing id instead of adding a duplicate', () => {
    const existing = [
      {
        provider: 'LM Studio',
        name: 'qwen-test',
        label: '旧名称',
        aliases: ['qwen-test'],
      },
      {
        provider: 'LM Studio',
        name: 'llama-3',
        label: 'Llama 3',
        aliases: ['llama-3'],
      },
    ];

    const list = mergeManualModels('LM Studio', existing, [
      { id: 'QWEN-test', label: '新名称' },
      { id: 'gemma-2', label: '' },
    ]);

    expect(list.map((m) => m.name)).toEqual([
      'qwen-test',
      'llama-3',
      'gemma-2',
    ]);
    expect(list[0].label).toBe('新名称');
    expect(list[2].label).toBeUndefined();
  });

  it('leaves the input list untouched', () => {
    const existing = [
      {
        provider: 'LM Studio',
        name: 'qwen-test',
        label: 'Qwen',
        aliases: ['qwen-test'],
      },
    ];

    mergeManualModels('LM Studio', existing, [
      { id: 'qwen-test', label: '重命名' },
    ]);

    expect(existing[0].label).toBe('Qwen');
  });
});

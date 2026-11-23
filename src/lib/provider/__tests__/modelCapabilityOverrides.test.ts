import { beforeEach, describe, expect, it, vi } from 'vitest';

// 名字推断只是默认值，覆盖值必须赢；这里跑在 node 环境，window 缺席时广播自动跳过。
const store = vi.hoisted(() => ({
  values: new Map<string, Record<string, boolean>>(),
}));

vi.mock('@/lib/storage', () => ({
  specializedStorage: {
    models: {
      getModelCapabilityOverrides: async (
        providerName: string,
        modelId: string,
      ) => store.values.get(`${providerName}|${modelId}`) ?? {},
      setModelCapabilityOverride: async (
        providerName: string,
        modelId: string,
        capability: string,
        value: boolean | null,
      ) => {
        const key = `${providerName}|${modelId}`;
        const record = store.values.get(key) ?? {};
        if (value === null) delete record[capability];
        else record[capability] = value;
        store.values.set(key, record);
      },
    },
  },
}));

import {
  resolveModelCapabilities,
  setModelCapabilityOverride,
} from '@/lib/provider/modelCapabilityOverrides';

describe('model capability overrides', () => {
  beforeEach(() => {
    store.values.clear();
  });

  it('follows the name heuristic until an override exists', async () => {
    expect(
      (await resolveModelCapabilities('本机8101', 'Qwen3.8-Flash-Next'))
        .supportsVision,
    ).toBe(false);
    expect(
      (await resolveModelCapabilities('OpenAI', 'gpt-4o')).supportsVision,
    ).toBe(true);
  });

  it('lets a manual switch win in both directions', async () => {
    await setModelCapabilityOverride(
      '本机8101',
      'Qwen3.8-Flash-Next',
      'vision',
      true,
    );
    expect(
      (await resolveModelCapabilities('本机8101', 'Qwen3.8-Flash-Next'))
        .supportsVision,
    ).toBe(true);

    await setModelCapabilityOverride('OpenAI', 'gpt-4o', 'vision', false);
    expect(
      (await resolveModelCapabilities('OpenAI', 'gpt-4o')).supportsVision,
    ).toBe(false);
  });

  it('clearing a switch hands the decision back to the heuristic', async () => {
    await setModelCapabilityOverride('OpenAI', 'gpt-4o', 'vision', false);
    expect(
      (await resolveModelCapabilities('OpenAI', 'gpt-4o')).supportsVision,
    ).toBe(false);
    await setModelCapabilityOverride('OpenAI', 'gpt-4o', 'vision', null);
    expect(
      (await resolveModelCapabilities('OpenAI', 'gpt-4o')).supportsVision,
    ).toBe(true);
  });

  it('leaves the other capability flags alone', async () => {
    const before = await resolveModelCapabilities('OpenAI', 'gpt-4o');
    await setModelCapabilityOverride('OpenAI', 'gpt-4o', 'vision', false);
    const after = await resolveModelCapabilities('OpenAI', 'gpt-4o');
    expect(after.supportsThinking).toBe(before.supportsThinking);
    expect(after.supportsFunctionCalling).toBe(before.supportsFunctionCalling);
  });
});

/**
 * 模型能力覆盖（per-provider、per-model）。
 *
 * 能力默认由模型名推断（`staticModels.getModelCapabilities`）。名字推断会漏掉本地
 * 服务上名字普通的模型（`Qwen3.8-Flash-Next` 能收图片，名字里却没有任何线索），
 * 也会把同名不同版本的模型一并误判。能不能收图片最终只有用户的环境说了算，所以这里
 * 存一份手动覆盖，读取时优先于推断；清掉覆盖就回到自动判断。
 */
import { specializedStorage } from '@/lib/storage';
import {
  getModelCapabilities,
  type ModelCapabilityFlags,
} from '@/lib/provider/staticModels';

/** 目前只有视觉提供过手动覆盖；新增能力时在这里加一项即可。 */
export type OverrideableCapability = 'vision';

/** 覆盖写入后广播，让正在等待能力判断的界面重新解析一次。 */
export const MODEL_CAPABILITIES_CHANGED = 'chatless:model-capabilities-changed';

export type ModelCapabilityOverrides = Partial<
  Record<OverrideableCapability, boolean>
>;

export async function getModelCapabilityOverrides(
  providerName: string,
  modelId: string,
): Promise<ModelCapabilityOverrides> {
  return (
    (await specializedStorage.models.getModelCapabilityOverrides(
      providerName,
      modelId,
    )) || {}
  );
}

/**
 * `value === null` 表示交回自动判断。写入后广播变化：附件面板可能正拿着旧的
 * 「不支持视觉」结论，不重算会让用户改了设置却仍然发不出去。
 */
export async function setModelCapabilityOverride(
  providerName: string,
  modelId: string,
  capability: OverrideableCapability,
  value: boolean | null,
): Promise<void> {
  await specializedStorage.models.setModelCapabilityOverride(
    providerName,
    modelId,
    capability,
    value,
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(MODEL_CAPABILITIES_CHANGED, {
        detail: { providerName, modelId, capability },
      }),
    );
  }
}

/**
 * 推断 + 覆盖。需要判断某个具体模型能不能用的调用方都应走这里，而不是直接问
 * `getModelCapabilities(modelId)`：后者只看名字，会把覆盖漏掉。
 */
export async function resolveModelCapabilities(
  providerName: string,
  modelId: string,
): Promise<ModelCapabilityFlags> {
  const caps = getModelCapabilities(modelId);
  const overrides = await getModelCapabilityOverrides(providerName, modelId);
  return {
    ...caps,
    supportsVision:
      overrides.vision === undefined ? caps.supportsVision : overrides.vision,
  };
}

/** 订阅覆盖变化，返回取消订阅。 */
export function onModelCapabilitiesChanged(
  listener: (detail: {
    providerName: string;
    modelId: string;
    capability: OverrideableCapability;
  }) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(MODEL_CAPABILITIES_CHANGED, handler);
  return () => window.removeEventListener(MODEL_CAPABILITIES_CHANGED, handler);
}

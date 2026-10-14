import { providerRepository } from "../ProviderRepository";
import { KeyManager } from "@/lib/llm/KeyManager";
import { refreshProviderUseCase } from "./RefreshProvider";
import { syncDynamicProviders } from "@/lib/llm";
import type { ProviderEntity } from "../types";

export class UpdateProviderConfigUseCase {
  /**
   * 统一更新 Provider 配置（仅更改传入字段）。
   * - 负责归一化/校验
   * - 一次性写仓库，触发订阅，确保 UI 及时回显
   */
  async execute(name: string, input: Partial<Pick<ProviderEntity,
    | "displayName"
    | "url"
    | "apiKey"
    | "strategy"
    | "isVisible"
    | "preferences"
  >>) {
    const list = await providerRepository.getAll();
    const target = list.find((p) => p.name === name);
    if (!target) return;

    // --- 归一化与分流 ---
    const next: Partial<ProviderEntity> & { name: string } = { name };
    let urlChanged = false;

    if (typeof input.displayName !== 'undefined') {
      next.displayName = (input.displayName || '').trim();
    }
    if (typeof input.url !== 'undefined') {
      const trimmed = (input.url || '').trim();
      next.url = trimmed;
      urlChanged = trimmed !== target.url;
    }
    if (typeof input.strategy !== 'undefined') {
      next.strategy = input.strategy || undefined;
    }
    if (typeof input.isVisible !== 'undefined') {
      next.isVisible = !!input.isVisible;
    }
    if (typeof input.preferences !== 'undefined') {
      next.preferences = { ...target.preferences, ...input.preferences };
    }

    // 真实密钥写 KeyManager；仓库仅存用于 UI 显示的 apiKey（可为空）
    if (typeof input.apiKey !== 'undefined') {
      const cleaned = input.apiKey && String(input.apiKey).trim() ? String(input.apiKey).trim() : null;
      if (cleaned) await KeyManager.setProviderKey(name, cleaned);
      else await KeyManager.removeProviderKey(name);
      next.apiKey = cleaned;
    }

    // --- 一次性写入仓库（仅包含变化字段） ---
    await providerRepository.update(next);

    // 注意：聚合型提供商（如New API）不需要Provider级别的默认策略
    // 用户应该为每个模型单独设置策略，因此移除此处的默认策略初始化
    // try {
    //   const def = await specializedStorage.models.getProviderDefaultStrategy(name);
    //   if (!def) {
    //     await specializedStorage.models.setProviderDefaultStrategy(name, 'openai-compatible');
    //   }
    // } catch (_) {}

    // 当 URL 发生变化时触发一次刷新（带模型），以便状态与模型列表快速收敛
    if (urlChanged) {
      await refreshProviderUseCase.execute(name, { withModels: true });
    }

    // 同步动态 providers 到运行时注册表
    await syncDynamicProviders();
  }
}

export const updateProviderConfigUseCase = new UpdateProviderConfigUseCase();



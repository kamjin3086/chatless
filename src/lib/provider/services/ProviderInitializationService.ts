import { providerRepository } from "../ProviderRepository";
import { modelRepository } from "../ModelRepository";
import { ProviderEntity, ProviderStatus } from "../types";
import { ProviderRegistry } from "@/lib/llm";
import { KeyManager } from "@/lib/llm/KeyManager";
import { getStaticModels } from "../staticModels";

// 默认在全新安装时展示在 Provider 列表中的内置提供商
const DEFAULT_VISIBLE_PROVIDER_NAMES = new Set<string>([
  'LM Studio',
  'Ollama',
  'DeepSeek',
  'Google AI',
]);

/**
 * 仅负责初始化 Provider 列表与静态模型写入，不做状态检查。
 */
export class ProviderInitializationService {
  private async buildEntityFromRegistry(
    p: any,
    existingConfig?: ProviderEntity
  ): Promise<ProviderEntity> {
    // 与发送路径同一条规则：本地证据 > 目录默认 > 用户自建（#118）。
    // 早先这里只查目录、否则一律“要密钥”，于是自建端点每次启动都被改回需要密钥。
    const { AVAILABLE_PROVIDERS_CATALOG } = await import("../catalog");
    const catalogDef = AVAILABLE_PROVIDERS_CATALOG.find(def => def.name === p.name);
    const { resolveRequiresKey } = await import("../keyRequirement");
    const requiresKey = resolveRequiresKey({
      catalog: catalogDef?.requiresKey,
      strategy: p.strategy ?? catalogDef?.strategy,
      url: existingConfig?.url || p.baseUrl || "",
    }).requiresKey;

    // 优化：若已有持久化 apiKey 则不访问 KeyManager
    const apiKey = existingConfig?.apiKey ?? (requiresKey ? await KeyManager.getProviderKey(p.name) : null);
    const initStatus = requiresKey && !apiKey ? ProviderStatus.NO_KEY : ProviderStatus.UNKNOWN;

    let url = existingConfig?.url || p.baseUrl || "";
    if (p.name === "Ollama") {
      try {
        const { OllamaConfigService } = await import("@/lib/config/OllamaConfigService");
        const ollamaUrl = await OllamaConfigService.getOllamaUrl();
        if (!existingConfig?.url) {
          url = ollamaUrl;
        }
      } catch {
        // ignore
      }
    }

    // 保留用户可编辑字段与偏好设置，避免被初始化覆盖
    const entity: ProviderEntity = {
      name: p.name,
      url,
      requiresKey,
      status: existingConfig?.status || initStatus,
      lastChecked: existingConfig?.lastChecked || 0,
      apiKey: existingConfig?.apiKey || apiKey,
      isUserAdded: existingConfig?.isUserAdded ?? false,
      // 若用户已有配置则尊重用户；否则仅对白名单中的 Provider 默认可见
      isVisible: existingConfig?.isVisible ?? DEFAULT_VISIBLE_PROVIDER_NAMES.has(p.name),
      strategy: existingConfig?.strategy,
      displayName: existingConfig?.displayName,
      avatarSeed: existingConfig?.avatarSeed,
      preferences: existingConfig?.preferences,
    };
    return entity;
  }

  private async mergeStaticModelsIfNeeded(providerName: string): Promise<void> {
    const staticList = getStaticModels(providerName);
    if (!staticList?.length) return;
    const existing = (await modelRepository.get(providerName)) || [];
    // 若静态模型均已存在，则不写入，避免无意义的IO
    const existingNames = new Set(existing.map((m: any) => m.name));
    const hasMissing = staticList.some((s) => !existingNames.has(s.id));
    if (!hasMissing) return;

    const byName = new Map<string, { provider: string; name: string; label?: string; aliases: string[] }>();
    for (const m of existing) byName.set(m.name, m as any);
    for (const s of staticList) {
      if (!byName.has(s.id)) byName.set(s.id, { provider: providerName, name: s.id, label: s.label, aliases: [s.id] });
    }
    const merged = Array.from(byName.values());
    await modelRepository.save(providerName, merged as any);
  }

  private collectFinalList(
    builtInList: ProviderEntity[],
    existingProviders: ProviderEntity[],
    registryProviders: any[]
  ): ProviderEntity[] {
    const builtInNames = new Set(registryProviders.map((p) => p.name));
    const customProviders = existingProviders.filter((p) => !builtInNames.has(p.name));
    return [...builtInList, ...customProviders];
  }

  async saveInitialProviders(): Promise<ProviderEntity[]> {
    try {
      const { initializeLLM } = await import("@/lib/llm");
      await initializeLLM();
    } catch {
      // ignore
    }

    const { PROVIDER_ORDER } = await import("@/lib/llm");
    const registryProviders = ProviderRegistry.allInOrder(PROVIDER_ORDER);

    const existingProviders = await providerRepository.getAll();
    const existingConfigMap = new Map(existingProviders.map((p) => [p.name, p]));

    // 1) 生成内置（注册表）Provider 列表，并保留用户字段
    const builtInList: ProviderEntity[] = await Promise.all(
      registryProviders.map(async (p): Promise<ProviderEntity> => {
        const existingConfig = existingConfigMap.get(p.name);
        const entity = await this.buildEntityFromRegistry(p, existingConfig);
        await this.mergeStaticModelsIfNeeded(p.name);
        return entity;
      })
    );

    // 2) 合并自定义 Provider（不在注册表中的，原样保留） & 3) 汇总列表
    const finalList = this.collectFinalList(builtInList, existingProviders, registryProviders);

    // 若最终列表与现存等价（按 name 对应字段相等），跳过写入以优化启动性能
    if (!this.areProviderListsEqual(existingProviders, finalList)) {
      await providerRepository.saveAll(finalList);
    }
    return finalList;
  }

  private areProviderListsEqual(a: ProviderEntity[], b: ProviderEntity[]): boolean {
    if (a.length !== b.length) return false;
    const pick = (p: ProviderEntity) => ({
      name: p.name,
      url: p.url || '',
      requiresKey: !!p.requiresKey,
      status: p.status,
      lastChecked: p.lastChecked || 0,
      apiKey: p.apiKey ?? null,
      isUserAdded: !!p.isUserAdded,
      isVisible: p.isVisible !== false,
      strategy: p.strategy || undefined,
      displayName: p.displayName || undefined,
      avatarSeed: p.avatarSeed || undefined,
      preferences: p.preferences ? { useBrowserRequest: !!p.preferences.useBrowserRequest } : undefined,
    });
    const mapA = new Map(a.map((p) => [p.name, pick(p)]));
    const mapB = new Map(b.map((p) => [p.name, pick(p)]));
    if (mapA.size !== mapB.size) return false;
    for (const [name, va] of mapA) {
      const vb = mapB.get(name);
      if (!vb) return false;
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
    }
    return true;
  }
}

export const providerInitializationService = new ProviderInitializationService();



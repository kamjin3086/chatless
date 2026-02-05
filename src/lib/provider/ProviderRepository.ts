import { StorageUtil } from "@/lib/storage";
import { ProviderEntity, ProviderStatus } from "./types";
import { defaultCacheManager } from "@/lib/cache/CacheManager";

export class ProviderRepository {
  async getAll(): Promise<ProviderEntity[]> {
    // 先尝试从内存缓存读取
    const cached = await defaultCacheManager.get<ProviderEntity[]>("providers");
    if (cached) return cached;

    // 内存未命中则从持久化存储读取
    const list = await StorageUtil.getItem<ProviderEntity[]>("providers", [], "providers-config.json");

    // 写回内存缓存以便后续快速访问 & 触发订阅
    await defaultCacheManager.set("providers", list ?? []);
    return list ?? [];
  }

  /** 读取用户自定义排序（按 provider.name 数组） */
  async getUserOrder(): Promise<string[]> {
    const order = await StorageUtil.getItem<string[]>("userProviderOrder", [], "providers-config.json");
    return order || [];
  }

  /** 保存用户自定义排序（按 provider.name 数组） */
  async setUserOrder(order: string[]): Promise<void> {
    await StorageUtil.setItem("userProviderOrder", order, "providers-config.json");
    // 主动广播一次 providers 列表变更，触发 useProviderStore 订阅逻辑以按新顺序重新排序并同步到 UI
    try {
      const current = await this.getAll();
      await defaultCacheManager.set("providers", current);
    } catch (e) {
      console.warn('[ProviderRepository] broadcast providers after order change failed:', e);
    }
  }

  /** 覆盖写入完整列表 */
  async saveAll(list: ProviderEntity[]): Promise<void> {
    // 写入内存缓存
    await defaultCacheManager.set("providers", list);
    // 持久化到磁盘
    await StorageUtil.setItem("providers", list, "providers-config.json");
  }

  /** 更新指定 Provider 条目（按 name 匹配） */
  async update(partial: Partial<ProviderEntity> & { name: string }): Promise<void> {
    const list = await this.getAll();
    const idx = list.findIndex((p) => p.name === partial.name);
    if (idx >= 0) {
      const next = { ...list[idx], ...partial } as ProviderEntity;
      // 保护：禁止持久化中间态（CONNECTING）；发现则降级为 UNKNOWN
      if ((next as any).status === (ProviderStatus as any).CONNECTING) {
        next.status = ProviderStatus.UNKNOWN;
        // 清理中间态的提示信息
        next.lastReason = undefined;
        next.lastMessage = next.lastMessage ?? null;
      }
      list[idx] = next;
    } else {
      // 新增时补默认字段
      list.push({
        url: '',
        requiresKey: true,
        status: ProviderStatus.UNKNOWN,
        lastChecked: 0,
        isUserAdded: true,
        isVisible: true,
        ...(partial as any),
      } as ProviderEntity);
    }
    await this.saveAll(list);
  }

  /** 设置 UI 可见性（不影响已配置项） */
  async setVisibility(name: string, isVisible: boolean): Promise<void> {
    const list = await this.getAll();
    const idx = list.findIndex((p) => p.name === name);
    if (idx < 0) return;
    list[idx] = { ...list[idx], isVisible };
    await this.saveAll(list);
  }

  /** 新增或更新完整实体（更语义化） */
  async upsert(entity: ProviderEntity): Promise<void> {
    const list = await this.getAll();
    const idx = list.findIndex((p) => p.name === entity.name);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...entity };
    } else {
      list.push(entity);
    }
    await this.saveAll(list);
  }

  /** 按名称删除 Provider（谨慎使用） */
  async deleteByName(name: string): Promise<void> {
    const list = await this.getAll();
    const next = list.filter(p => p.name !== name);
    await this.saveAll(next);
  }

  /** 订阅全列表变化 */
  subscribe(cb: (list: ProviderEntity[]) => void): () => void {
    return defaultCacheManager.subscribe("providers", () => {
      this.getAll().then(cb).catch(console.error);
    });
  }
}

export const providerRepository = new ProviderRepository(); 

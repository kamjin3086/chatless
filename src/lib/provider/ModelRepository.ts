import { defaultCacheManager } from "@/lib/cache/CacheManager";
import { ModelEntity } from "./types";
import { specializedStorage } from "@/lib/storage";

const MODEL_KEY_PREFIX = "models:"; // 每个 provider 独立缓存
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 小时

type Listener = (provider: string) => void;

function isSameModelList(a: ModelEntity[] | undefined, b: ModelEntity[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if ((a[i] as any).label !== (b[i] as any).label) return false;
  }
  return true;
}

export class ModelRepository {
  private listeners: Set<Listener> = new Set();

  private key(name: string) {
    return MODEL_KEY_PREFIX + name;
  }

  async get(provider: string): Promise<ModelEntity[] | undefined> {
    // 先读内存缓存
    const inMem = await defaultCacheManager.get<ModelEntity[]>(this.key(provider));
    if (inMem) return inMem; // 允许为空数组作为已知状态

    // 尝试读取持久化存储
    try {
      const names = await specializedStorage.models.getProviderModels(provider);
      if (names && names.length) {
        // 同步读取 label 覆盖，保证重启后仍能显示“名称”而非 id
        const labelMap = await specializedStorage.models.getModelLabels?.(provider);
        let arr: ModelEntity[] = names.map((n) => ({
          provider,
          name: n,
          aliases: [n],
          // @ts-ignore 保留 label 字段以便 UI 使用
          label: labelMap && labelMap[n] ? labelMap[n] : undefined,
        } as any));

        // 进一步用静态模型的label进行补充（仅在 label 缺失时）
        try {
          const { getStaticModels } = await import('./staticModels');
          const staticList = getStaticModels(provider) || [];
          const labelById = new Map(staticList.map((m:any)=>[m.id, m.label]));
          arr = arr.map((m:any)=> m.label ? m : ({ ...m, label: labelById.get(m.name) || m.label }));
        } catch {}
        await defaultCacheManager.set(this.key(provider), arr);
        return arr;
      }
    } catch (error) {
      console.error(`Failed to get models for provider ${provider}:`, error);
      // 不抛出错误，但记录日志以便调试
    }

    // 不存在则返回空数组并写入缓存，减少上层判空复杂度
    await defaultCacheManager.set(this.key(provider), []);
    return [];
  }

  async save(provider: string, models: ModelEntity[], ttl: number = DEFAULT_TTL) {
    // 去重并规范：同一 id 只保留一个，名称与 id 一一对应
    const uniqueById = new Map<string, any>();
    for (const m of models as any[]) {
      if (!uniqueById.has(m.name)) uniqueById.set(m.name, m);
    }
    const normalized = Array.from(uniqueById.values());

    const inMem = await defaultCacheManager.get<ModelEntity[]>(this.key(provider));
    if (isSameModelList(inMem, normalized)) {
      return;
    }

    await defaultCacheManager.set(this.key(provider), normalized, { ttl });
    try {
      // 仅当 providerModels 变化时才写入
      const existingNames = await specializedStorage.models.getProviderModels(provider) || [];
      const nextNames = normalized.map((m:any)=>m.name);
      const equal = existingNames.length === nextNames.length && existingNames.every((n:string, i:number)=> n === nextNames[i]);
      if (!equal) {
        await specializedStorage.models.setProviderModels(provider, nextNames);
      }
      // 同步保存 label 覆盖（仅当 label 与 id 不同且值有变化）
      const labelMap = await specializedStorage.models.getModelLabels?.(provider) || {};
      for (const m of normalized) {
        const label = (m).label;
        if (label && label !== m.name && labelMap[m.name] !== label) {
          try { await specializedStorage.models.setModelLabel(provider, m.name, label); } catch {}
        }
      }
    } catch (error) {
      console.error(`Failed to save models for provider ${provider}:`, error);
      // 不抛出错误，但记录日志以便调试
    }

    // notify
    this.listeners.forEach(l=>l(provider));
  }

  /** 清空指定 provider 模型（保留键值结构） */
  async clear(provider: string) {
    await defaultCacheManager.set(this.key(provider), []);
    try { 
      await specializedStorage.models.setProviderModels(provider, []);
    } catch (error) {
      console.error(`Failed to clear models for provider ${provider}:`, error);
      // 不抛出错误，但记录日志以便调试
    }
    this.listeners.forEach(l=>l(provider));
  }

  subscribe(provider: string, cb: (models: ModelEntity[] | undefined) => void): () => void {
    return defaultCacheManager.subscribe(this.key(provider), () => {
      this.get(provider).then(cb).catch(console.error);
    });
  }

  subscribeAll(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const modelRepository = new ModelRepository(); 
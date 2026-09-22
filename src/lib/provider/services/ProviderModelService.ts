import { modelRepository } from "../ModelRepository";
import { providerRepository } from "../ProviderRepository";
import { ProviderStatus } from "../types";
import { defaultCacheManager } from "@/lib/cache/CacheManager";
import { EVENTS } from "../events/keys";
import { getStaticModels } from "../staticModels";
import { ProviderRegistry } from "@/lib/llm";
import { specializedStorage } from "@/lib/storage";
import { MODEL_FETCH_RULES, type ModelFetchRule } from "@/config/modelFetchRules";
import { tauriFetch } from "@/lib/request";
import {
  refreshAutoProviderModels,
  shouldSkipModelFetch,
  type FetchModelsOptions,
} from "@/lib/provider/modelFetchPolicy";

const DEFAULT_TTL = 24 * 60 * 60 * 1000;

// ---- 辅助：解析模型名用于排序（尽量鲁棒，解析失败则返回默认值） ----
function parseModelNameForSort(name: string, label?: string): {
  brand: string;         // 品牌/系列（gemini/gpt/qwen/...）
  versionScore: number;  // 版本号分数（如 2.5 > 1.5）
  variantRank: number;   // 变体权重（pro > flash > turbo > nano 等）
  sizeScore: number;     // 规模分数（b/m/k）
  revisionScore: number; // 修订号分数（如 010 > 002）
  isLatest: boolean;     // 是否 latest
  lower: string;         // 全名小写
} {
  try {
    const lower = String(name || '').toLowerCase();
    const text = `${(label || '').toLowerCase()} ${lower}`.trim();
    // 品牌/系列
    const known = ['gemini','gpt','deepseek','qwen','grok','claude','llama','mistral','glm','gemma','kimi','moonshot','yi','openai','google'];
    const brand = known.find(k => text.includes(k)) || (text.split(/[^a-z0-9]+/)[0] || '');

    // 版本号（取第一个 x.y 或 x）
    let versionScore = 0;
    const ver = text.match(/\b(\d+(?:\.\d+)?)(?:\s*|\b)/);
    if (ver) {
      const v = parseFloat(ver[1]);
      if (isFinite(v)) versionScore = Math.round(v * 1000); // 2.5 → 2500
    }

    // 变体权重：pro > flash > turbo > mini > nano > instruct > preview
    const order: Record<string, number> = {
      pro: 100,
      flash: 90,
      turbo: 80,
      ultra: 75,
      mini: 60,
      nano: 50,
      instruct: 40,
      preview: 10,
    };
    let variantRank = 0;
    for (const [k, w] of Object.entries(order)) { if (text.includes(k)) variantRank = Math.max(variantRank, w); }

    // 规模（b/m/k）
    const target = text;
    const match = target.match(/(\d+(?:\.\d+)?)([bmk])\b/); // 仅识别 b/m/k
    let sizeScore = 0;
    if (match) {
      const num = parseFloat(match[1]);
      const unit = match[2];
      const mul = unit === 'b' ? 1_000_000_000 : unit === 'm' ? 1_000_000 : 1_000; // b>m>k
      sizeScore = isFinite(num) ? num * mul : 0;
    }

    // latest 与修订号
    const isLatest = /\blatest\b/.test(target);
    let revisionScore = 0;
    const rev = target.match(/(?:^|[^a-z])([0-9]{2,4})(?:[^a-z]|$)/);
    if (rev) {
      const r = parseInt(rev[1]);
      if (isFinite(r)) revisionScore = r;
    }

    return { brand, versionScore, variantRank, sizeScore, revisionScore, isLatest, lower };
  } catch {
    return { brand: '', versionScore: 0, variantRank: 0, sizeScore: 0, revisionScore: 0, isLatest: false, lower: String(name || '').toLowerCase() };
  }
}

/**
 * 负责按需拉取模型列表，带 TTL 与错误降级。
 */
export class ProviderModelService {
  private inflight = new Map<string, Promise<void>>();
  private lastFetchAt = new Map<string, number>();

  /**
   * 拉取并写入该 provider 的模型列表。
   * 语义约定：
   * - 若策略实现了 fetchModels 且返回数组：该数组即为“权威列表”（允许为空），直接覆盖保存；
   * - 若 fetchModels 返回 null：视为暂不支持/失败，回退到“现有缓存 ∪ 静态模型”的并集；
   * - 排序与去重由本服务统一完成，策略无需关心；
   * - 保存后通过事件总线通知订阅者（provider 模型变化）。
   * 兼容旧调用：第二个参数可以是 TTL 毫秒数，或 { ttl, force, minIntervalMs }。
   */
  async fetchIfNeeded(name: string, ttlOrOptions: number | FetchModelsOptions = DEFAULT_TTL): Promise<void> {
    const options: FetchModelsOptions = typeof ttlOrOptions === 'number'
      ? { ttl: ttlOrOptions }
      : (ttlOrOptions || {});
    const ttl = options.ttl ?? DEFAULT_TTL;
    if (shouldSkipModelFetch(this.lastFetchAt.get(name), Date.now(), options)) {
      return;
    }
    if (this.inflight.has(name)) return this.inflight.get(name)!;
    const p = this._fetchImpl(name, ttl).finally(() => {
      this.lastFetchAt.set(name, Date.now());
      this.inflight.delete(name);
    });
    this.inflight.set(name, p);
    return p;
  }

  /** 静默刷新免密 Provider 与用户手动添加的 Provider 的模型列表（带默认节流；force 时立即拉取）。 */
  async refreshAutoProviders(options?: { force?: boolean }): Promise<void> {
    const list = await providerRepository.getAll();
    await refreshAutoProviderModels(
      list,
      (providerName, fetchOptions) => this.fetchIfNeeded(providerName, fetchOptions),
      options
    );
  }

  private async _fetchImpl(name: string, ttl: number): Promise<void> {
    // 0) 若存在“用户覆盖/调试规则”或“内置规则（纳入版本控制）”，优先按规则拉取
    try {
      const userRule = await specializedStorage.models.getProviderFetchDebugRule(name);
      // 允许以显示名称或唯一ID作为键；按精确与不区分大小写回退匹配
      const providers = await providerRepository.getAll();
      const target = providers.find((p) => p.name === name);
      const candidateKeys: string[] = [];
      if (name) candidateKeys.push(name);
      // 若存在 provider 唯一ID（假设字段为 id），加入候选
      const targetId = (target as any)?.id;
      if (targetId) candidateKeys.push(String(targetId));
      // 大小写不敏感回退键
      const insensitiveKeys = candidateKeys.map(k => k.toLowerCase());

      let builtInRule: ModelFetchRule | undefined = undefined;
      for (const key of candidateKeys) {
        if (MODEL_FETCH_RULES[key] !== undefined) { builtInRule = MODEL_FETCH_RULES[key]; break; }
      }
      if (!builtInRule) {
        // 回退到不区分大小写匹配
        const mapLower = new Map<string, ModelFetchRule>();
        for (const [k, v] of Object.entries(MODEL_FETCH_RULES)) {
          mapLower.set(k.toLowerCase(), v);
        }
        for (const low of insensitiveKeys) {
          if (mapLower.has(low)) { builtInRule = mapLower.get(low); break; }
        }
      }

      const rule = builtInRule || userRule;
      if (rule) {
        const base0 = (target?.url?.trim() || '').replace(/\/$/, '');
        const base = rule.useV1 && !/\/v1\b/.test(base0) ? `${base0}/v1` : base0;
        const url = base + (rule.endpointSuffix || '/models');
        const headers: Record<string, string> = {};
        if (target?.requiresKey) {
          try { const { KeyManager } = await import('@/lib/llm/KeyManager'); const k = await KeyManager.getProviderKey(name); if (k) headers['Authorization'] = `Bearer ${k}`; } catch {}
        }
        let onlineList: any[] = [];
        let ruleSuccess = false;
        try {
          const res: any = await tauriFetch(url, { method: 'GET', headers, fallbackToBrowserOnError: true, verboseDebug: true, debugTag: 'ModelList' });
          const pickByPath = (obj: any, path?: string) => {
            if (!path) return undefined;
            return path.split('.').reduce((acc: any, key: string) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
          };
          const arr: any[] = Array.isArray(pickByPath(res, rule.modelsArrayPath || 'data')) ? pickByPath(res, rule.modelsArrayPath || 'data') : (Array.isArray(res) ? res : []);
          const toTitleFromId = (s: string) => {
            if (!s) return s as any;
            let spaced = s.replace(/([a-z])([A-Z])/g, '$1 $2');
            spaced = spaced.replace(/[_\-:.\/]+/g, ' ');
            spaced = spaced.replace(/\s+/g, ' ').trim();
            return spaced.split(' ').map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
          };
          onlineList = arr.map((it) => {
            const id = (pickByPath(it, rule.idPath || 'id') ?? it?.id ?? it?.model ?? it?.name);
            let label = (pickByPath(it, rule.labelPath || '') ?? it?.label ?? it?.name);
            if ((label === undefined || label === null || String(label).trim() === '') && rule.autoLabelFromId) {
              label = toTitleFromId(String(id));
            }
            if (label === undefined || label === null || String(label).trim() === '') {
              label = String(id);
            }
            return { name: String(id), label: String(label), aliases: [String(id)] };
          }).filter((m) => m.name);
          ruleSuccess = true;
          // 将结果写入调试结果文件
          try { await specializedStorage.models.setProviderFetchDebugResult(name, onlineList.map(m=>({ name: m.name, label: m.label })) ); } catch {}
        } catch (e) {
          // 规则拉取失败则继续走常规逻辑
          console.warn('[ProviderModelService] 调试规则拉取失败，回退常规逻辑', e);
          try {
            const cached = await specializedStorage.models.getProviderFetchDebugResult(name);
            if (cached && Array.isArray(cached)) {
              onlineList = cached.map((m:any)=>({ name: m.name, label: m.label, aliases: [m.name] }));
              ruleSuccess = true;
            }
          } catch {}
        }
        if (ruleSuccess) {
          // 规则存在即认为其为权威来源（允许空数组）
          await modelRepository.save(name, onlineList as any, ttl);
          await defaultCacheManager.set(EVENTS.providerModels(name), true);
          return;
        }
      }
    } catch {}

    // 1) 在线拉取（若策略支持），优先使用网络结果
    //    目前 OllamaProvider 实现了 fetchModels，会访问 /api/tags。
    let online: Array<{ name: string; label?: string; aliases?: string[] }> | null = null;
    try {
      const strategy: any = ProviderRegistry.get(name);
      if (strategy && typeof strategy.fetchModels === 'function') {
        // 确保使用最新的 URL（例如 Ollama 可能由设置页更新）
        const providers = await providerRepository.getAll();
        const target = providers.find((p) => p.name === name);
        const effectiveUrl = target?.url?.trim() || (name === 'Ollama' ? 'http://localhost:11434' : '');
        if (strategy.baseUrl !== effectiveUrl) {
          strategy.baseUrl = effectiveUrl;
        }
        online = await strategy.fetchModels();
      }
    } catch (e) {
      // 忽略在线拉取失败，降级到本地静态与已存在的合并
      console.warn(`[ProviderModelService] 在线拉取 ${name} 模型失败，使用降级策略`, e);
    }

    // 2) 生成权威列表（authoritative）：
    //    - 若在线结果存在（即使为空数组），则使用在线结果作为唯一来源（解决 A→B 换地址后旧模型残留的问题）
    //    - 若在线结果为 null（网络/实现缺失），则回退：existing ∪ static
    const staticList = getStaticModels(name) || [];
    const existing = (await modelRepository.get(name)) || [];

    const byName = new Map<string, { provider: string; name: string; label?: string; aliases: string[]; contextWindow?: number }>();

    if (Array.isArray(online)) {
      // 在线结果为权威来源：仅以在线结果构建列表
      for (const m of online) {
        const key = m.name;
        const contextWindow = Number((m as { contextWindow?: number }).contextWindow);
        byName.set(key, {
          provider: name,
          name: key,
          label: m.label,
          aliases: m.aliases || [key],
          ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow: Math.floor(contextWindow) } : null),
        });
      }
    } else {
      // 在线失败：使用现有缓存与静态模型的并集，避免界面空白
      for (const m of existing) byName.set(m.name, m);
      for (const s of staticList) {
        if (!byName.has(s.id)) byName.set(s.id, { provider: name, name: s.id, label: s.label, aliases: [s.id] });
      }
    }

    let merged = Array.from(byName.values());
    // ---- 稳健排序：
    // 1) 同 baseName 按规模分数降序，再按是否 latest（latest 次于更大规模），再按完整小写名升序
    // 2) 不同 baseName 按 baseName 升序
    try {
      const keyCache = new Map<string, ReturnType<typeof parseModelNameForSort>>();
      const getKey = (n: string, lbl?: string) => {
        const key = lbl ? `${n}|${lbl}` : n;
        if (!keyCache.has(key)) keyCache.set(key, parseModelNameForSort(n, lbl));
        return keyCache.get(key)!;
      };
      merged = merged.sort((a, b) => {
        const ka = getKey(a.name, (a as any).label);
        const kb = getKey(b.name, (b as any).label);
        if (ka.brand !== kb.brand) return ka.brand.localeCompare(kb.brand);
        if (ka.versionScore !== kb.versionScore) return kb.versionScore - ka.versionScore; // 新版本靠前
        if (ka.variantRank !== kb.variantRank) return kb.variantRank - ka.variantRank; // pro/flash 等权重
        if (ka.isLatest !== kb.isLatest) return Number(kb.isLatest) - Number(ka.isLatest); // latest 靠前
        if (ka.sizeScore !== kb.sizeScore) return kb.sizeScore - ka.sizeScore; // 大模型靠前
        if (ka.revisionScore !== kb.revisionScore) return kb.revisionScore - ka.revisionScore; // 010 > 002
        return ka.lower.localeCompare(kb.lower);
      });
    } catch {
      // 排序异常则保持合并后的原始顺序，避免影响功能
    }
    await modelRepository.save(name, merged, ttl);
    // Remember a reported window so the output budget still knows it after a
    // restart; a window the user typed is never overwritten.
    try {
      const { ModelParametersService } = await import('@/lib/model-parameters');
      for (const model of merged as Array<{ name: string; contextWindow?: number }>) {
        if (model.contextWindow) {
          await ModelParametersService.setContextWindowIfUnset(name, model.name, model.contextWindow);
        }
      }
    } catch (error) {
      console.warn('[ProviderModelService] 记录模型上下文窗口失败:', error);
    }
    await defaultCacheManager.set(EVENTS.providerModels(name), true);
  }
}

export const providerModelService = new ProviderModelService();



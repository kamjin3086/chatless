import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ProviderMetadata } from '@/lib/metadata/types';
import { toast } from '@/components/ui/sonner';

// 新的 ProviderStatusStore
import {
  useProviderStatusStore,
} from '@/store/providerStatusStore';
import { ProviderRegistry } from '@/lib/llm';
import { useOllamaStore } from '@/store/ollamaStore';
import { KeyManager } from '@/lib/llm/KeyManager';
import { useProviderMetaStore } from '@/store/providerMetaStore';
import { useProviderStore } from '@/store/providerStore';
import { mapToProviderWithStatus } from '@/lib/provider/transform';
import { preloadProviderAndModelLogos } from '@/lib/utils/logoPreloader';

// 设置布局与 AI 模型页会各调一次 hook；连通性检查只跑一轮，避免状态点连闪
let didInitProviderConfigCheck = false;

// --- 类型定义 ---
// (可以考虑移到单独的 types 文件)
export interface ProviderWithStatus extends ProviderMetadata {
  // 显示名称（用户可编辑）
  displayName?: string;
  isConnected?: boolean;
  // 新的状态显示逻辑
  displayStatus?: 'CONNECTED' | 'CONNECTING' | 'NOT_CONNECTED' | 'NO_KEY' | 'UNKNOWN' | 'NO_FETCHER';
  statusTooltip?: string | null;
  // 最后检查时间
  lastCheckedAt?: number;
  // 临时状态（检查后显示，不持久化）
  temporaryStatus?: 'CONNECTING' | 'CONNECTED' | 'NOT_CONNECTED';
  // 配置状态（持久化，因为这是配置问题）
  configStatus?: 'NO_KEY' | 'NO_FETCHER';
  // 临时状态的消息
  temporaryMessage?: string | null;
  // 新增：上次稳定结果（用于悬浮提示）
  lastResult?: 'CONNECTED' | 'NOT_CONNECTED' | 'UNKNOWN';
  lastMessage?: string | null;

  healthCheckPath?: string;
  authenticatedHealthCheckPath?: string;
  isUserAdded?: boolean;
  isVisible?: boolean;
  /** 高级偏好设置 */
  preferences?: {
    /** 是否使用浏览器请求方式（兜底模式） */
    useBrowserRequest?: boolean;
  };
}

// --- 主 Hook ---
export function useProviderManagement() {
  const { map: statusMap, setStatus: setStatusStore } = useProviderStatusStore();
  const { models: ollamaModels, refreshModels: refreshOllamaModels, hasOnlineFetched } = useOllamaStore();
  const setGlobalQuickList = useProviderMetaStore(s=>s.setList);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    providers: repoProviders,
    isLoading: repoLoading,
    init: initProviders,
    refreshAll: storeRefreshAll,
  } = useProviderStore();

  // 合并 Repository 数据与 StatusStore；依赖不变时保持引用，避免设置页整表重挂
  const providers = useMemo(() => {
    return repoProviders
      .map(mapToProviderWithStatus)
      .filter((p: any) => p.isVisible !== false)
      .map((p) => {
        const st = statusMap[p.name];
        if (!st) return p;

        let displayStatus: string | undefined;
        let statusTooltip: string | undefined;

        if (st.configStatus) {
          displayStatus = st.configStatus;
          statusTooltip = st.temporaryMessage ?? undefined;
        } else if (st.temporaryStatus) {
          displayStatus = st.temporaryStatus;
          statusTooltip = st.temporaryMessage ?? undefined;
        } else {
          displayStatus = undefined;
          statusTooltip = undefined;
        }

        return {
          ...p,
          displayStatus,
          isConnected: st.temporaryStatus === 'CONNECTED',
          statusTooltip,
          lastCheckedAt: st.lastCheckedAt,
          lastResult: (st as any).lastResult,
          lastMessage: (st as any).lastMessage,
          temporaryStatus: st.temporaryStatus,
          configStatus: st.configStatus,
          temporaryMessage: st.temporaryMessage,
        } as ProviderWithStatus;
      });
  }, [repoProviders, statusMap]);
  const setConnecting = useProviderMetaStore(s=>s.setConnecting);

  // 页面卸载取消标记
  const cancelledRef = useRef<boolean>(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  // 初始加载 - 调用 store.init()
  useEffect(() => {
    initProviders().catch(console.error);
  }, [initProviders]);

  // 替换同步 effect
  useEffect(() => {
    (async () => {
      const converted = repoProviders
        .map(mapToProviderWithStatus)
        .filter((p:any) => p.isVisible !== false)
        .map(p => {
          // 启动时清理任何遗留的CONNECTING状态
          if (p.displayStatus === 'CONNECTING') {
            console.warn(`发现遗留的CONNECTING状态：${p.name}，将重置为UNKNOWN`);
            return { ...p, displayStatus: 'UNKNOWN' as const, statusTooltip: '状态未知，请手动刷新' };
          }
          return p;
        });

      setIsLoading(repoLoading);
      try { preloadProviderAndModelLogos(converted as any).catch(()=>{}); } catch { /* noop */ }
    })();

  }, [repoProviders, repoLoading]);

  // 初始化时对"检查过期"的 Provider 进行一次静默检查
  useEffect(() => {
    if (didInitProviderConfigCheck) return;
    didInitProviderConfigCheck = true;
    (async () => {
      try {
        const { providerRepository } = await import('@/lib/provider/ProviderRepository');
        const list = await providerRepository.getAll();

        // 初始化配置状态：仅依据“输入框（持久化的 apiKey）是否为空”来显示未配置密钥
        const configStatusUpdates: Record<string, any> = {};
        list.forEach(p => {
          const needsKey = !!p.requiresKey;
          const hasKey = !!(p.apiKey && String(p.apiKey).trim());
          if (needsKey && !hasKey) {
            configStatusUpdates[p.name] = {
              configStatus: 'NO_KEY',
              lastCheckedAt: p.lastChecked || Date.now(),
            };
          }
        });

        if (Object.keys(configStatusUpdates).length > 0) {
          const { bulkSet } = useProviderStatusStore.getState();
          // 不持久化：仅用于 UI 显示
          bulkSet(configStatusUpdates, false);
        }

        const STALE_MS = 10 * 60 * 1000; // 10 分钟
        const now = Date.now();
        const stale = list.filter(p => !p.lastChecked || (now - (p.lastChecked || 0)) > STALE_MS);
        if (stale.length === 0) return;
        const { checkController } = await import('@/lib/provider/check-controller');
        stale.forEach((p, idx) => {
          setTimeout(() => {
            try { checkController.requestCheck(p.name, { reason: 'init', debounceMs: 0, withModels: false }); } catch (e) {
              console.warn('init check request failed', e);
            }
          }, idx * 150);
        });
      } catch (e) {
        console.warn('init config status setup failed', e);
      }
    })();
  }, [setStatusStore]);

  // ---- 将 providers 同步到全局 store (providerMetaStore) ----
  useEffect(() => {
    setGlobalQuickList(providers as any);
  }, [providers, setGlobalQuickList]);

  // 不再需要本地过滤 useState

  // --- 数据加载 (loadData) ---
  // loadData 函数已废弃

  // --- 刷新单个 Provider（由 checkController 统一调度） ---
  const handleSingleProviderRefresh = useCallback(async (provider: ProviderWithStatus, showToast: boolean = true) => {
    const repoName = provider.name;
    if (cancelledRef.current) return;

    // 检查过程中不要提前写入 lastCheckedAt，避免沿用旧的 CONNECTED 结果闪「连接正常」
    const { checkController } = await import('@/lib/provider/check-controller');

    await new Promise<void>((resolve) => {
      const offStart = checkController.on('start', (p)=>{
        if (p.name !== repoName) return;
        setConnecting(provider.name, true);
        console.log('[ProviderCheck] start', repoName);
      });
      const offSuccess = checkController.on('success', (p)=>{
        if (p.name !== repoName) return;
        setConnecting(provider.name, false);
        console.log('[ProviderCheck] success', repoName, p.status, p.message);

        // 根据检查结果设置状态
        const now = Date.now();
        if (p.status === 'NO_KEY') {
          // 使用 KeyManager 中最新值与 UI 输入框共同判断
          const run = async () => {
            try {
              const { KeyManager } = await import('@/lib/llm/KeyManager');
              const latest = await KeyManager.getProviderKey(provider.name);
              const inputEmpty = !(provider.default_api_key && String(provider.default_api_key).trim());
              const keyEmpty = !(latest && String(latest).trim());
              setStatusStore(provider.name, {
                configStatus: (inputEmpty && keyEmpty) ? 'NO_KEY' : undefined,
                temporaryMessage: (inputEmpty && keyEmpty) ? (p.message ?? '未配置API密钥') : undefined,
                lastCheckedAt: now,
              }, false);
            } catch {
              // 回退：仅依据输入框
              const inputEmpty = !(provider.default_api_key && String(provider.default_api_key).trim());
              setStatusStore(provider.name, {
                configStatus: inputEmpty ? 'NO_KEY' : undefined,
                temporaryMessage: inputEmpty ? (p.message ?? '未配置API密钥') : undefined,
                lastCheckedAt: now,
              }, false);
            }
          };
          run();
        } else {
          setStatusStore(provider.name, {
            lastCheckedAt: now,
            lastResult: p.status === 'CONNECTED' ? 'CONNECTED' : 'NOT_CONNECTED',
            lastMessage: p.message ?? null,
          }, false);
          // 统一改用通知反馈结果：标题为 Provider 名称，描述为标准化文案
          if (showToast) {
            const title = provider.displayName || provider.name;
            if (p.status === 'CONNECTED') {
              toast.success(title, { description: p.message || '接口可访问', duration: 4000 });
            } else {
              toast.error(title, {
                description: p.message || '无法连接，请检查服务是否启动以及地址和端口',
                duration: 5000,
              });
            }
          }
        }

        // 移除重复通知与临时状态清理

        offStart(); offSuccess(); offFail(); offTimeout(); offCancel();
        resolve();
      });
      const offFail = checkController.on('fail', (p)=>{
        if (p.name !== repoName) return;
        setConnecting(provider.name, false);
        console.log('[ProviderCheck] fail', repoName, p.message);

        setStatusStore(provider.name, {
          lastCheckedAt: Date.now(),
          lastResult: 'NOT_CONNECTED',
          lastMessage: p.message ?? '无法连接',
        }, false);

        if (showToast) {
          toast.error(`${provider.displayName || provider.name}`, {
            description: p.message || '无法连接，请检查服务是否启动以及地址和端口',
          });
        }
        offStart(); offSuccess(); offFail(); offTimeout(); offCancel();
        resolve();
      });
      const offTimeout = checkController.on('timeout', (p)=>{
        if (p.name !== repoName) return;
        setConnecting(provider.name, false);
        console.log('[ProviderCheck] timeout', repoName);

        setStatusStore(provider.name, {
          lastCheckedAt: Date.now(),
          lastResult: 'NOT_CONNECTED',
          lastMessage: '连接超时',
        }, false);

        if (showToast) {
          toast.error(`${provider.displayName || provider.name}`, { description: '连接超时' });
        }
        offStart(); offSuccess(); offFail(); offTimeout(); offCancel();
        resolve();
      });
      const offCancel = checkController.on('cancel', (p)=>{
        if (p.name !== repoName) return;
        setConnecting(provider.name, false);
        setStatusStore(provider.name, { temporaryStatus: undefined, temporaryMessage: undefined });
        console.log('[ProviderCheck] cancel', repoName);
        offStart(); offSuccess(); offFail(); offTimeout(); offCancel();
        resolve();
      });

      // 发起请求
      console.log('[ProviderCheck] request', repoName);
      // 健康检查仅判定连通性，不自动拉取模型，避免额外401/噪声
      checkController.requestCheck(repoName, { reason: 'manual', debounceMs: 0, withModels: false });
    });
  }, [setConnecting, setStatusStore]);

  // --- EFFECT 1: Load Initial Data on Mount ---
  // Effect 1 被移除：首次连通性检查已在 loadData > runInitialChecks 完成。

  // Effect 2 被移除：首次连通性检查已在 loadData > runInitialChecks 完成。

  // --- EFFECT 3: Sync internal providers state with ollamaStore ---
  useEffect(() => {
    console.log("[useProviderManagement] Effect 3: Ollama models sync START", ollamaModels);
    // 覆盖策略：
    // - 若从未在线拉取过（hasOnlineFetched=false），并且 store 为空：不覆盖，保持仓库/静态模型，避免误清空。
    // - 一旦进行过在线拉取（无论结果是否为空），则以 store 为准覆盖到 UI，保证“空列表”也能反映真实状态；
    //   这可以解决从地址 A(20 个) 切换到地址 B(3 个) 后，旧模型残留的问题。
    if (!hasOnlineFetched && (!ollamaModels || ollamaModels.length === 0)) {
      console.log("[useProviderManagement] Effect 3: no online fetch yet and store empty, keep current provider models.");
      return;
    }
    // setProviders(currentProviders => { // This line was removed as per the edit hint
    //     const ollamaProvider = currentProviders.find(p => p.name === 'Ollama');
    //     if (!ollamaProvider) return currentProviders; // Ollama provider might not exist yet

    //     const currentOllamaModelNames = ollamaProvider.models.map(m => m.name) || [];
    //     if (currentOllamaModelNames.length === ollamaModels.length &&
    //         currentOllamaModelNames.every(name => ollamaModels.includes(name))) {
    //         console.log("[useProviderManagement] Effect 3: Internal Ollama models already match store. Skipping update.");
    //         return currentProviders;
    //     }

    //     console.log(`[useProviderManagement] Effect 3: Updating Ollama provider models in internal state.`);
    //     return currentProviders.map(provider => {
    //         if (provider.name === 'Ollama') {
    //             const updatedModels = ollamaModels.map((modelName: string): ModelMetadata => {
    //                 const existingModelData = provider.models.find((m: ModelMetadata) => m.name === modelName);
    //                 return {
    //                     name: modelName,
    //                     aliases: existingModelData?.aliases || [modelName],
    //                     api_key: existingModelData?.api_key
    //                 };
    //             });
    //             return { ...provider, models: updatedModels };
    //         }
    //         return provider;
    //     });
    // }); // This line was removed as per the edit hint
    console.log("[useProviderManagement] Effect 3: Ollama models sync END");
  }, [ollamaModels, hasOnlineFetched]);

  // --- 其他处理函数 ---

  const handleServiceUrlChange = useCallback(async (providerName: string, newUrl: string) => {
    try {
      const effectiveUrl = newUrl.trim() || (providerName === 'Ollama' ? 'http://localhost:11434' : '');
      const current = providers.find(
        (p) => p.name === providerName || p.aliases?.includes(providerName)
      );
      const prevUrl = (current?.api_base_url || '').trim().replace(/\/$/, '');
      const nextUrl = effectiveUrl.replace(/\/$/, '');
      if (prevUrl === nextUrl) return;

      const { updateProviderConfigUseCase } = await import('@/lib/provider/usecases/UpdateProviderConfig');
      await updateProviderConfigUseCase.execute(providerName, { url: effectiveUrl });

      if (providerName === 'Ollama') {
        const { OllamaConfigService } = await import('@/lib/config/OllamaConfigService');
        if (!newUrl.trim()) {
          const config = await OllamaConfigService.getConfig();
          delete config.api_base_url;
          await OllamaConfigService.setConfig(config);
        } else {
          await OllamaConfigService.setOllamaUrl(newUrl);
        }
      }

      try {
        const strat = ProviderRegistry.get(providerName);
        if (strat) {
          (strat as any).baseUrl = effectiveUrl;
        }
        if (providerName === 'Ollama') {
          const { updateOllamaProviderUrl } = await import('@/lib/llm');
          await updateOllamaProviderUrl(effectiveUrl);
        }
      } catch (e) { console.warn('Update ProviderRegistry baseUrl error', e);}

      if (providerName === 'Ollama') {
        try { await refreshOllamaModels(effectiveUrl); } catch {/* noop */}
      }

      toast.success("地址已保存");
      if (current) {
        void handleSingleProviderRefresh(current, false);
      }
    } catch (error: any) {
      console.error("Error updating provider URL:", error);
      toast.error("地址保存失败", { description: error?.message || "请检查后重试。" });
    }
  }, [refreshOllamaModels, handleSingleProviderRefresh, providers]);

  const handleProviderDefaultApiKeyChange = useCallback(async (providerName: string, apiKey: string) => {
    const finalApiKey = apiKey && apiKey.trim() ? apiKey.trim() : null;
    // 若值与当前相同，则直接返回，避免无谓刷新/写入
    const current = providers.find(p => p.name === providerName);
    if (current) {
      const currentNormalized = current.default_api_key && String(current.default_api_key).trim() ? String(current.default_api_key).trim() : null;
      if (currentNormalized === finalApiKey) {
        return;
      }
    }


    try {
      const { updateProviderConfigUseCase } = await import('@/lib/provider/usecases/UpdateProviderConfig');
      await updateProviderConfigUseCase.execute(providerName, { apiKey: finalApiKey });
    } catch (error: any) {
      console.error("更新 Provider 默认 API Key 覆盖配置失败:", error);
      toast.error("更新 API 密钥失败", { description: error?.message || "无法保存密钥更改。" });
      // loadData(true);
    }
  }, [handleSingleProviderRefresh, providers]);

  const handleModelApiKeyChange = useCallback(async (providerName: string, modelName: string, apiKey: string) => {
    const finalApiKey = apiKey || null;
    // setProviders(prev => // This line was removed as per the edit hint
    //   prev.map(p => {
    //     if (p.name === providerName) {
    //       return {
    //         ...p,
    //         models: p.models.map(m => (m.name === modelName ? { ...m, api_key: finalApiKey } : m))
    //       };
    //     }
    //     return p;
    //   })
    // ); // This line was removed as per the edit hint
    try {
      if (finalApiKey !== null) {
        await KeyManager.setModelKey(providerName, modelName, finalApiKey);
      } else {
        await KeyManager.removeModelKey(providerName, modelName);
      }
    } catch (error: any) {
      console.error("更新 Model API Key 覆盖配置失败:", error);
      toast.error("更新模型 API 密钥失败", { description: error?.message || "无法保存密钥更改。" });
      // loadData(true);
    }
  }, []);

  const handleGlobalRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await storeRefreshAll();

      // 全局刷新后，重新加载所有提供商的最新模型数据
      const { providerRepository } = await import('@/lib/provider/ProviderRepository');

      await providerRepository.getAll();


      toast.success("提供商刷新完成");
    } catch (e:any) {
      console.error("Global refresh failed", e);
      toast.error("刷新失败", { description: e?.message || String(e) });
    }
    setIsRefreshing(false);
  }, [storeRefreshAll]);

  // 处理偏好设置更改
  const handlePreferenceChange = useCallback(async (providerName: string, preferences: { useBrowserRequest?: boolean }) => {
    try {
      const { updateProviderConfigUseCase } = await import('@/lib/provider/usecases/UpdateProviderConfig');
      await updateProviderConfigUseCase.execute(providerName, { preferences });
      // 立即回显：在状态 store 中清除临时消息，并刷新 meta 列表（仓库订阅也会同步到，但这里先本地立即生效）
      try {
        const { providerRepository } = await import('@/lib/provider/ProviderRepository');
        const latest = await providerRepository.getAll();
        const target = latest.find(p=>p.name===providerName);
        if (target) {
          const { useProviderStore } = await import('@/store/providerStore');
          const { useProviderMetaStore } = await import('@/store/providerMetaStore');
          const { mapToProviderWithStatus } = await import('@/lib/provider/transform');
          const current = useProviderStore.getState().providers;
          const updated = current.map((prov:any)=> prov.name===providerName ? { ...prov, preferences: target.preferences } : prov);
          useProviderStore.setState({ providers: updated } as any);
          useProviderMetaStore.getState().setList(updated.map((v:any)=>mapToProviderWithStatus(v)) as any);
        }
      } catch (e) {
        console.warn('sync preferences to stores failed', e);
      }
      toast.success(`已更新 ${providerName} 的高级设置`);
    } catch (error) {
      console.error("Failed to update provider preferences:", error);
      toast.error("设置更新失败");
      // 回滚交由仓库订阅完成
    }
  }, []);

  return {
    providers,
    isLoading,
    isRefreshing,
    handleServiceUrlChange,
    handleProviderDefaultApiKeyChange,
    handleModelApiKeyChange,
    handleGlobalRefresh,
    handleSingleProviderRefresh,
    handlePreferenceChange
  };
}
"use client";
import { useState, useEffect } from 'react';
import React from 'react';
import { CheckCircle, XCircle, KeyRound, Loader2, AlertTriangle } from 'lucide-react';
import { ProviderStrategySelector } from './ProviderStrategySelector';
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"; // 使用 shadcn 折叠组件
import { ProviderHeader } from "./ProviderHeader";
import { isDevelopmentEnvironment } from '@/lib/utils/environment';
import ModelFetchDebugger from './ModelFetchDebugger';
import type { ModelMetadata } from '@/lib/metadata/types';
import { ModelParametersDialog } from '@/components/chat/ModelParametersDialog';
import { ProviderConnectionSection } from './ProviderConnectionSection';
import { ProviderModelList } from './ProviderModelList';
import { AVAILABLE_PROVIDERS_CATALOG } from '@/lib/provider/catalog';
import { toast } from '@/components/ui/sonner';
import { AdvancedSettingsDialog } from './AdvancedSettingsDialog';
import { useStableProviderIcon } from './useStableProviderIcon';
import { getAvatarSync } from '@/lib/utils/logoService';
import { useRecentModelsHint } from './useRecentModelsHint';
import { getProviderKeyDocLink } from '@/lib/provider/keyDocLinks';
import { OrcaRouterConnectPanel } from './OrcaRouterConnectPanel';
import { isOrcaRouterProvider } from '@/lib/orcarouter/adapters';

// 导入 ProviderWithStatus 类型
import type { ProviderWithStatus } from '@/hooks/useProviderManagement';

interface ProviderSettingsProps {
  provider: ProviderWithStatus;
  isConnecting: boolean; // 单个 Provider 是否正在连接 (用于 Loading 状态)
  isInitialChecking: boolean; // 是否处于全局初始检查状态 (用于禁用按钮)
  onUrlChange: (providerName: string, url: string) => void;
  onDefaultApiKeyChange: (providerName: string, apiKey: string) => void;
  onDefaultApiKeyBlur: (providerName: string) => void;
  onModelApiKeyChange: (modelName: string, apiKey: string) => void; // Model 也使用 name
  onModelApiKeyBlur: (modelName: string) => void;
  onRefresh: (provider: ProviderWithStatus) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean; // 受控展开状态（存在时启用受控模式）
  // 新增：偏好设置处理
  onPreferenceChange?: (providerName: string, preferences: { useBrowserRequest?: boolean }) => Promise<void>;
}

function ProviderSettingsImpl({
  provider,
  isConnecting,
  isInitialChecking,
  onUrlChange,
  onDefaultApiKeyChange,
  onDefaultApiKeyBlur,
  onModelApiKeyChange,
  onModelApiKeyBlur,
  onRefresh,
  onOpenChange,
  open,
  onPreferenceChange
}: ProviderSettingsProps) {
  // 受控/非受控展开状态：存在 open 则受控，否则本地管理
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState<boolean>(false);
  const isOpen = isControlled ? (open) : uncontrolledOpen;
  const setIsOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  // 保留最小状态集
  const [modelSearch, setModelSearch] = useState(''); // 模型搜索输入框的值
  const _lastUsedMap = useRecentModelsHint(provider.name); // 保留以便后续使用
  
  // 模型参数设置弹窗状态
  const [parametersDialogOpen, setParametersDialogOpen] = useState(false);
  const [selectedModelForParams, setSelectedModelForParams] = useState<{
    providerName: string;
    modelId: string;
    modelLabel?: string;
  } | null>(null);

  // —— 模型获取调试器状态 ——
  const [fetchDebuggerOpen, setFetchDebuggerOpen] = useState(false);
  const [hasFetchRule, setHasFetchRule] = useState<boolean>(false);
  const [_advancedDialogOpen, setAdvancedDialogOpen] = useState(false); // 高级设置对话框状态

  useEffect(() => {
    (async () => {
      try {
        const { specializedStorage } = await import('@/lib/storage');
        const rule = await specializedStorage.models.getProviderFetchDebugRule(provider.name);
        setHasFetchRule(!!rule);
      } catch {
        // 忽略错误
      }
    })();
  }, [provider.name]);

  useEffect(() => {
    if (!fetchDebuggerOpen) {
      (async () => {
        try {
          const { specializedStorage } = await import('@/lib/storage');
          const rule = await specializedStorage.models.getProviderFetchDebugRule(provider.name);
          setHasFetchRule(!!rule);
        } catch {
          // 忽略错误
        }
      })();
    }
  }, [fetchDebuggerOpen, provider.name]);

  // provider-specific API key / 控制台文档链接（集中在 keyDocLinks.ts 中维护）
  const docUrl = getProviderKeyDocLink(provider.name);

  // 稳定的图标加载：先显示头像，后台预取真实图标，命中后平滑替换（仅切换一次）
  const { iconSrc } = useStableProviderIcon(provider);
  const fallbackAvatarSrc = React.useMemo(() => getAvatarSync(provider.name.toLowerCase(), provider.name, 20), [provider.name]);

  // 处理打开模型参数设置弹窗
  const handleOpenParameters = (modelId: string, modelLabel?: string) => {
    setSelectedModelForParams({ 
      providerName: provider.name, 
      modelId, 
      modelLabel 
    });
    setParametersDialogOpen(true);
  };

  // 获取默认URL
  const getDefaultUrl = (providerName: string): string => {
    // 优先从目录中查询（包括 302AI、ocoolAI、OpenRouter、Groq 等代理）
    const def = AVAILABLE_PROVIDERS_CATALOG.find(d => d.name === providerName);
    if (def?.defaultUrl) return def.defaultUrl;
    // 兜底：常见官方默认地址
    switch (providerName.toLowerCase()) {
      case 'ollama':
        return 'http://localhost:11434';
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'anthropic':
        return 'https://api.anthropic.com/v1';
      case 'google ai':
        return 'https://generativelanguage.googleapis.com/v1beta';
      case 'deepseek':
        return 'https://api.deepseek.com';
      default:
        return '';
    }
  };

  // 重置URL到默认值
  const handleResetUrl = () => {
    const repoName = provider.aliases?.[0] || provider.name;
    const defaultUrl = getDefaultUrl(provider.name);
    setLocalUrl(defaultUrl);
    onUrlChange(repoName, defaultUrl);
    toast.success('已重置为默认地址', { description: defaultUrl });
  };

  // 优先判断是否正在进行初始检查 或 单个正在连接
  // const currentlyChecking = isConnecting || isInitialChecking; // <-- REMOVE THIS LINE or modify its usage
  // Display text/icon should primarily depend on isConnecting (individual status)
  // Button disabling can still use isInitialChecking
  const isGloballyInitializing = isInitialChecking; // Keep for disabling elements globally

  // 新的状态显示逻辑：默认不显示状态，按需显示
  let statusText: string | undefined;
  let StatusIcon: any = undefined;
  let badgeVariant: "secondary" | "destructive" | "outline" = "secondary";
  let badgeClasses = "";

  // 优先显示配置状态（持久化）
  if (provider.configStatus) {
    switch (provider.configStatus) {
      case 'NO_KEY':
        statusText = '未配置密钥';
        StatusIcon = KeyRound;
        badgeVariant = 'secondary';
        // 需求：去掉边框，增加不明显的底色
        badgeClasses = "text-gray-700 dark:text-gray-200 bg-gray-100/60 dark:bg-gray-800/40 px-2 py-1 text-xs font-medium rounded";
        break;
      case 'NO_FETCHER':
        statusText = '未实现检查';
        StatusIcon = AlertTriangle;
        badgeVariant = 'secondary';
        badgeClasses = "text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-1 text-xs font-medium";
        break;
    }
  }
  // 其次显示临时状态（检查后显示）
  else if (provider.temporaryStatus) {
    switch (provider.temporaryStatus) {
      case 'CONNECTING':
        statusText = '检查中...';
        StatusIcon = Loader2;
        badgeVariant = 'secondary';
        badgeClasses = "text-yellow-700 dark:text-yellow-300 bg-yellow-100/60 dark:bg-yellow-900/30 px-2 py-1 text-xs font-medium";
        break;
      case 'CONNECTED':
        statusText = '网络可达';
        StatusIcon = CheckCircle;
        badgeVariant = 'secondary';
        badgeClasses = "text-green-700 dark:text-green-300 bg-green-100/60 dark:bg-green-900/30 px-2 py-1 text-xs font-medium";
        break;
      case 'NOT_CONNECTED':
        statusText = '检查失败';
        StatusIcon = XCircle;
        badgeVariant = 'secondary';
        badgeClasses = "text-red-700 dark:text-red-300 bg-red-100/60 dark:bg-red-900/30 px-2 py-1 text-xs font-medium";
        break;
    }
  }
  // 默认不显示状态，只显示检查时间（如果有）
  else {
    // 不显示状态徽章，只在tooltip中显示检查时间
    statusText = undefined;
    StatusIcon = undefined;
  }

  // 本地 state 用于输入框内容（以本地为单一真实来源，失焦时提交保存）
  const [localUrl, setLocalUrl] = useState(provider.api_base_url);
  const [localDefaultApiKey, setLocalDefaultApiKey] = useState(provider.default_api_key || '');
  const [localModelApiKeys, setLocalModelApiKeys] = useState<{ [modelName: string]: string }>(() => {
      const obj: { [modelName: string]: string } = {};
      if (provider.models) {
        provider.models.forEach((model: ModelMetadata) => {
          obj[model.name] = model.api_key || '';
        });
      }
      return obj;
  });

  // 订阅模型仓库，确保新增/删除/重命名后即时更新列表而不触发整卡刷新
  const [localRepoModels, setLocalRepoModels] = useState<ModelMetadata[] | null>(null);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const { modelRepository } = await import('@/lib/provider/ModelRepository');
        const list = await modelRepository.get(provider.name);
        if (list) {
          setLocalRepoModels(list.map((m: any) => ({ name: m.name, label: m.label || m.name, aliases: m.aliases || [], api_key: (m).apiKey })) as any);
        }
        unsubscribe = modelRepository.subscribe(provider.name, async () => {
          const latest = await modelRepository.get(provider.name);
          setLocalRepoModels((latest || []).map((m: any) => ({ name: m.name, label: m.label || m.name, aliases: m.aliases || [], api_key: (m).apiKey })) as any);
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      try { unsubscribe?.(); } catch {
        // 忽略取消订阅错误
      }
    };
  }, [provider.name]);

  const modelsForDisplay: ModelMetadata[] = (localRepoModels ?? provider.models ?? []) as any;

  // 使用 ref 来跟踪是否是用户正在输入
  // 当切换到不同 provider 或其数据变更时，刷新本地初始值
  useEffect(() => {
      setLocalUrl(provider.api_base_url);
    setLocalDefaultApiKey(provider.default_api_key || '');
    const obj: { [modelName: string]: string } = {};
    const list = (localRepoModels ?? provider.models ?? []) as any;
    list.forEach((m: ModelMetadata) => {
      obj[m.name] = m.api_key || '';
    });
    setLocalModelApiKeys(obj);
  }, [provider.name, provider.api_base_url, provider.default_api_key, localRepoModels]);

  // 是否显示 API Key 相关字段 (Ollama 等不需要)
  const showApiKeyFields = provider.requiresApiKey !== false;

  // 是否允许用户新增模型（除 Ollama） - 保留以便后续使用
  const _canAddModels = provider.name !== 'Ollama';

  // —— 模型策略选择（仅对 multi 策略类 provider 有意义，如 New API） ——
  // 注意：New API作为聚合型提供商，用户应该为每个模型单独设置策略
  // 因此不显示Provider级别的默认策略设置，保持界面简洁
  const isMultiStrategyProvider = false; // 暂时禁用，因为聚合型提供商不需要Provider级默认策略
  const [defaultStrategy, setDefaultStrategy] = useState<string>('openai-compatible');
  const [_modelStrategies, _setModelStrategies] = useState<Record<string, string>>({});
  // 计算实际请求地址预览
  const endpointPreview = React.useMemo(() => {
    const base = (localUrl || '').replace(/\/$/, '');
    const strategy = (isMultiStrategyProvider ? defaultStrategy : undefined) ||
      (provider.name.toLowerCase()==='google ai' ? 'gemini' :
       provider.name.toLowerCase()==='anthropic' ? 'anthropic' :
       provider.name.toLowerCase()==='deepseek' ? 'deepseek' :
       'openai-compatible');
    if (!base) return '';
    switch (strategy) {
      case 'gemini':
        return `${base}/models/{model}:streamGenerateContent?alt=sse`;
      case 'anthropic':
        return `${base}/messages`;
      case 'deepseek':
        return `${base}/chat/completions`;
      case 'openai':
      case 'openai-compatible':
      default:
        return `${base}/chat/completions`;
    }
  }, [localUrl, provider.name, isMultiStrategyProvider, defaultStrategy]);

  React.useEffect(() => {
    (async () => {
      if (!isMultiStrategyProvider) return;
      const { specializedStorage } = await import('@/lib/storage');
      const def = await specializedStorage.models.getProviderDefaultStrategy(provider.name);
      setDefaultStrategy(def || 'openai-compatible');
      const map: Record<string, string> = {};
      for (const m of provider.models || []) {
        const s = await specializedStorage.models.getModelStrategy(provider.name, m.name);
        if (s) map[m.name] = s;
      }
      _setModelStrategies(map);
    })().catch(console.error);
  }, [provider.name, provider.models, isMultiStrategyProvider]);

  // 旧的"添加模型"、"重命名"逻辑已移至子组件
  // 能力图标渲染、搜索关键字高亮已迁移至子组件

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={(open)=>{ setIsOpen(open); onOpenChange?.(open); }} className="border border-slate-200/70 dark:border-slate-700/70 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
        <ProviderHeader
          provider={provider}
          isOpen={isOpen}
          isConnecting={isConnecting}
          isGloballyInitializing={isGloballyInitializing}
          statusText={statusText || ''}
          StatusIcon={StatusIcon}
          badgeVariant={badgeVariant}
          badgeClasses={badgeClasses}
          resolvedIconSrc={iconSrc}
          iconError={false}
          iconIsCatalog={false}
          iconExtIdx={0}
          iconExts={[] as readonly string[]}
          setIconExtIdx={() => 0}
          setIconError={() => {}}
          fallbackAvatarSrc={fallbackAvatarSrc}
          onOpenToggle={() => setIsOpen(!isOpen)}
          onRefresh={onRefresh}
          onOpenFetchDebugger={isDevelopmentEnvironment() ? (() => setFetchDebuggerOpen(true)) : undefined}
          hasFetchRule={hasFetchRule}
          onOpenSettings={() => setAdvancedDialogOpen(true)}
          onResetUrl={handleResetUrl}
          onPreferenceChange={onPreferenceChange}
        />

      <CollapsibleContent className="px-3 pb-3 pt-2 bg-slate-50/30 dark:bg-slate-900/30 border-t border-slate-200/70 dark:border-slate-700/70">
        
        <div className="space-y-3">
          <ProviderConnectionSection
            provider={provider}
            localUrl={localUrl}
            setLocalUrl={setLocalUrl}
            onUrlChange={onUrlChange}
            /* onUrlBlur removed */
            onResetUrl={handleResetUrl}
            showApiKeyFields={showApiKeyFields}
            localDefaultApiKey={localDefaultApiKey}
            setLocalDefaultApiKey={setLocalDefaultApiKey}
            docUrl={docUrl}
            onDefaultApiKeyChange={onDefaultApiKeyChange}
            onDefaultApiKeyBlur={onDefaultApiKeyBlur}
            endpointPreview={endpointPreview}
            onPreferenceChange={onPreferenceChange}
            showInlineMenu={false}
          />

          {/* OrcaRouter：并列展示 API Key 与 PKCE 账号登录两种接入方式 */}
          {isOrcaRouterProvider(provider.name) && (
            <OrcaRouterConnectPanel
              onCredentialChanged={() => onDefaultApiKeyBlur(provider.aliases?.[0] || provider.name)}
            />
          )}

          {/* 模型列表和配置 */}
          <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
            {isMultiStrategyProvider && (
              <ProviderStrategySelector providerName={provider.name} value={defaultStrategy as any} onChange={(v)=>setDefaultStrategy(v)} />
            )}
            <div className={isMultiStrategyProvider ? "mt-2" : ""}>
              <ProviderModelList
                provider={provider}
                modelsForDisplay={modelsForDisplay}
                modelSearch={modelSearch}
                setModelSearch={setModelSearch}
                showApiKeyFields={showApiKeyFields}
                localModelApiKeys={localModelApiKeys}
                setLocalModelApiKeys={setLocalModelApiKeys as any}
                onModelApiKeyChange={onModelApiKeyChange}
                onModelApiKeyBlur={onModelApiKeyBlur}
                onOpenParameters={handleOpenParameters}
              />
              </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>


    {/* 模型参数设置弹窗 */}
    <ModelParametersDialog
      open={parametersDialogOpen && !!selectedModelForParams}
      onOpenChange={setParametersDialogOpen}
      providerName={selectedModelForParams?.providerName || ''}
      modelId={selectedModelForParams?.modelId || ''}
      modelLabel={selectedModelForParams?.modelLabel}
    />

    {/* 模型获取调试器弹窗（独立组件） */}
    <ModelFetchDebugger open={fetchDebuggerOpen} onOpenChange={setFetchDebuggerOpen} provider={provider} baseUrl={localUrl || provider.api_base_url || ''} />
    
    {/* 高级设置对话框 */}
    {onPreferenceChange && (
      <AdvancedSettingsDialog
        open={_advancedDialogOpen}
        onOpenChange={setAdvancedDialogOpen}
        provider={provider}
        onPreferenceChange={onPreferenceChange}
      />
    )}
  </>
  );
}

export const ProviderSettings = React.memo(ProviderSettingsImpl, (prev, next) => {
  // 仅在关键属性变化时更新，展开其它项不触发全部重渲染
  const sameProviderCore = (
    prev.provider.name === next.provider.name &&
    prev.provider.api_base_url === next.provider.api_base_url &&
    prev.provider.default_api_key === next.provider.default_api_key &&
    prev.provider.displayStatus === next.provider.displayStatus &&
    (prev.provider.preferences?.useBrowserRequest ?? false) === (next.provider.preferences?.useBrowserRequest ?? false)
  );
  return (
    sameProviderCore &&
    prev.isConnecting === next.isConnecting &&
    prev.isInitialChecking === next.isInitialChecking &&
    prev.open === next.open
  );
});
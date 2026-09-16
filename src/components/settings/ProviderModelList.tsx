"use client";
import React from "react";
import type { ModelMetadata } from "@/lib/metadata/types";
import type { ProviderWithStatus } from "@/hooks/useProviderManagement";
import { ProviderAddModelDialog } from "./ProviderAddModelDialog";
import { Brain, Workflow, Camera, ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { getModelCapabilities } from "@/lib/provider/staticModels";
import { ProviderModelItem } from "./ProviderModelItem";
import { toast } from "@/components/ui/sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { StrategyValue } from "@/lib/provider/strategyInference";
import { isNoKeyProvider, NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS } from "@/lib/provider/modelFetchPolicy";

interface ProviderModelListProps {
  provider: ProviderWithStatus;
  modelsForDisplay: ModelMetadata[];
  modelSearch: string;
  setModelSearch: (v: string) => void;
  showApiKeyFields: boolean;
  localModelApiKeys: Record<string, string>;
  setLocalModelApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onModelApiKeyChange: (modelName: string, apiKey: string) => void;
  onModelApiKeyBlur: (modelName: string) => void;
  onOpenParameters: (modelId: string, modelLabel?: string) => void;
}

export function ProviderModelList(props: ProviderModelListProps) {
  const {
    provider, modelsForDisplay, modelSearch, setModelSearch,
    showApiKeyFields, localModelApiKeys, setLocalModelApiKeys,
    onModelApiKeyChange, onModelApiKeyBlur, onOpenParameters,
  } = props;

  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const getScroller = () => {
    let node: HTMLElement | null = rootRef.current;
    while (node) {
      const style = window.getComputedStyle(node);
      const oy = style.overflowY;
      if (oy === 'auto' || oy === 'scroll') return node;
      node = node.parentElement;
    }
    return (document.scrollingElement as HTMLElement) || document.documentElement;
  };

  const restoreScroll = (node: HTMLElement, top: number) => {
    let tries = 0;
    const maxTries = 30; // ~500ms @ 60fps
    const tick = () => {
      if (tries++ >= maxTries) return;
      if (Math.abs(node.scrollTop - top) > 1) node.scrollTop = top;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // Provider 特性
  const isOllama = (provider.name || '').toLowerCase().includes('ollama');
  // 批量策略入口（Ollama 不支持策略设置）
  const isMultiStrategyProvider = !isOllama;

  // —— 批量策略设置（轻量） ——
  const [batchMode, setBatchMode] = React.useState(false);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [batchStrategy, setBatchStrategy] = React.useState<'openai'|'openai-responses'|'openai-compatible'|'anthropic'|'gemini'|'deepseek'>('openai-compatible');
  const [strategyMap, setStrategyMap] = React.useState<Record<string, string | null>>({});

  const toggleChecked = (id: string) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  const setAll = (ids: string[], v: boolean) => setChecked(prev => ({ ...prev, ...Object.fromEntries(ids.map(i => [i, v])) }));

  const applyBatch = async (overrideStrategy?: string) => {
    try {
      const ids = Object.keys(checked).filter(k => checked[k]);
      if (ids.length === 0) { toast.error('请先选择模型'); return; }
      const { specializedStorage } = await import('@/lib/storage');
      const value = (overrideStrategy || batchStrategy) as any;
      await Promise.all(ids.map(id => specializedStorage.models.setModelStrategy(props.provider.name, id, value)));
      setStrategyMap(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, value])) }));
      toast.success(`已为 ${ids.length} 个模型设置策略`);
    } catch (e) {
      console.error(e);
      toast.error('批量设置失败');
    }
  };

  // —— 自动推断：根据模型ID推断策略 ——
  const { inferStrategyFromModelId } = require('@/lib/provider/strategyInference');

  const applyAutoInfer = async () => {
    try {
      const ids = Object.keys(checked).filter(k => checked[k]);
      if (ids.length === 0) { toast.error('请先选择模型'); return; }
      const { specializedStorage } = await import('@/lib/storage');
      const entries = ids.map(id => [id, inferStrategyFromModelId(id)] as const);
      const hits = entries.filter(([, s]) => !!s) as Array<[string, StrategyValue]>;
      if (hits.length) {
        await Promise.all(hits.map(([id, strat]) => specializedStorage.models.setModelStrategy(props.provider.name, id, strat)));
        setStrategyMap(prev => ({ ...prev, ...Object.fromEntries(hits) }));
      }
      const missed = ids.length - hits.length;
      toast.success(`已为 ${hits.length} 个模型设置策略${missed? `，${missed} 个未命中已跳过`: ''}`);
    } catch (e) {
      console.error(e);
      toast.error('自动推断失败');
    }
  };

  const clearBatch = async () => {
    try {
      const ids = Object.keys(checked).filter(k => checked[k]);
      if (ids.length === 0) { toast.error('请先选择模型'); return; }
      const { specializedStorage } = await import('@/lib/storage');
      await Promise.all(ids.map(id => specializedStorage.models.removeModelStrategy(props.provider.name, id)));
      setStrategyMap(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, null])) }));
      toast.success(`已清除 ${ids.length} 个模型的策略覆盖`);
    } catch (e) {
      console.error(e);
      toast.error('清除覆盖失败');
    }
  };

  // —— 刷新模型逻辑（复用于多个按钮位置） ——
  const refreshModels = async () => {
    try {
      const scroller = getScroller();
      const prevY = scroller.scrollTop;
      // 冻结列表容器高度，避免布局变化导致的回弹（不再强制锁定滚动事件，减少“跳定位”感）
      const root = rootRef.current as HTMLElement | null;
      const prevMinH = root ? root.style.minHeight : '';
      if (root) root.style.minHeight = `${root.offsetHeight}px`;
      const { providerModelService } = await import('@/lib/provider/services/ProviderModelService');
      await providerModelService.fetchIfNeeded(provider.name, { force: true });
      const { modelRepository } = await import('@/lib/provider/ModelRepository');
      const latest = await modelRepository.get(provider.name);
      toast.success('已刷新模型列表', { description: `${latest?.length || 0} 个模型` });
      // 轻量回到刷新前的大致位置（一次性），避免“来回拉扯”
      restoreScroll(scroller, prevY);
      setTimeout(() => {
        if (root) root.style.minHeight = prevMinH;
      }, 300);
    } catch (e:any) {
      toast.error('刷新模型失败', { description: e?.message || String(e) });
    }
  };

  // 载入策略覆盖，用于回显
  const modelIdsKey = modelsForDisplay.map((m) => m.name).join('\n');
  React.useEffect(() => {
    (async () => {
      try {
        const { specializedStorage } = await import('@/lib/storage');
        const map: Record<string, string | null> = {};
        for (const m of modelsForDisplay) {
          map[m.name] = await specializedStorage.models.getModelStrategy(provider.name, m.name);
        }
        setStrategyMap(map);
      } catch (e) { console.warn(e); }
    })();
    // modelsForDisplay 用 id 签名，避免同列表新数组引用导致整表重刷
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.name, modelIdsKey]);

  // 免密（本地）Provider：展开模型列表时静默拉取，2 分钟内不重复
  React.useEffect(() => {
    if (!isNoKeyProvider(provider)) return;
    void (async () => {
      try {
        const { providerModelService } = await import('@/lib/provider/services/ProviderModelService');
        await providerModelService.fetchIfNeeded(provider.name, {
          minIntervalMs: NO_KEY_MODEL_REFRESH_MIN_INTERVAL_MS,
        });
      } catch (e) {
        console.debug('auto refresh no-key models skipped', e);
      }
    })();
  }, [provider.name, provider.requiresApiKey]);

  const renderItem = (model: ModelMetadata) => (
    <div key={model.name} className="flex items-center gap-2 w-full">
      {batchMode && isMultiStrategyProvider && (
        <Checkbox checked={!!checked[model.name]} onCheckedChange={()=>toggleChecked(model.name)} className="h-3.5 w-3.5" />
      )}
      <div className="flex-1 min-w-0">
      <ProviderModelItem
      providerName={provider.name}
      model={model}
      showApiKeyFields={showApiKeyFields}
      apiKeyValue={localModelApiKeys[model.name] || ''}
      setApiKeyValue={(v) => setLocalModelApiKeys(prev => ({ ...prev, [model.name]: v }))}
      onModelApiKeyChange={onModelApiKeyChange}
      onModelApiKeyBlur={onModelApiKeyBlur}
      onOpenParameters={onOpenParameters}
      showStrategyBadge={batchMode && isMultiStrategyProvider}
      strategy={strategyMap[model.name] || null}
      onStrategyChange={(s: string | null)=>setStrategyMap(prev => ({ ...prev, [model.name]: s }))}
      allowStrategyActions={!isOllama}
      allowDelete={!isOllama}
      onRename={async (modelName, nextLabelRaw) => {
        const nextLabel = (nextLabelRaw || '').trim();
        if (!nextLabel) { toast.error('名称不可为空'); return; }
        const { modelRepository } = await import('@/lib/provider/ModelRepository');
        const { specializedStorage } = await import('@/lib/storage');
        const list = (await modelRepository.get(provider.name)) || [];
        const updated = list.map((m: any) => (m.name === modelName ? { ...m, label: nextLabel } : m));
        await modelRepository.save(provider.name, updated);
        await specializedStorage.models.setModelLabel(provider.name, modelName, nextLabel);
        toast.success('已重命名', { description: nextLabel });
      }}
      canDelete={(() => {
        const { getStaticModels } = require('@/lib/provider/staticModels');
        const staticList = getStaticModels(provider.name) || getStaticModels((provider as any).aliases?.[0] || provider.name) || [];
        const isStatic = staticList.some((m: any) => m.id === model.name);
        return !isStatic;
      })()}
      onDelete={async () => {
        const { modelRepository } = await import('@/lib/provider/ModelRepository');
        const list = (await modelRepository.get(provider.name)) || [];
        const next = list.filter((m: any) => m.name !== model.name);
        await modelRepository.save(provider.name, next);
        toast.success('已删除模型', { description: model.name });
      }}
    />
    </div>
    </div>
  );

  const [filterThinking, setFilterThinking] = React.useState(false);
  const [filterTools, setFilterTools] = React.useState(false);
  const [filterVision, setFilterVision] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const listAreaRef = React.useRef<HTMLDivElement | null>(null);
  const listContentRef = React.useRef<HTMLDivElement | null>(null);
  const searchVisible = searchOpen || !!modelSearch.trim();

  const [pageSize, setPageSize] = React.useState(12);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    if (searchVisible) searchRef.current?.focus();
  }, [searchVisible]);

  React.useEffect(() => {
    const root = rootRef.current;
    const area = listAreaRef.current;
    if ((!root && !area) || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const measure = () => {
      const areaEl = listAreaRef.current;
      const rootEl = rootRef.current;
      const contentH = listContentRef.current?.offsetHeight ?? 0;
      let h = areaEl?.clientHeight ?? 0;
      // 列表区域若跟着内容收缩，改用根容器剩余高度，避免每页被算成 3 条
      if (rootEl) {
        const toolbar = rootEl.firstElementChild as HTMLElement | null;
        const fromRoot = rootEl.clientHeight - (toolbar?.offsetHeight ?? 0) - 8;
        const collapsed = h > 0 && contentH > 0 && Math.abs(h - contentH) < 12;
        if (fromRoot > h + 24 || collapsed) h = Math.max(h, fromRoot);
      }
      if (h < 80) return;
      // 28px 分组标题 + 16px 底部留白，避免最后一条贴边
      const next = Math.max(1, Math.min(30, Math.floor((h - 44) / 36)));
      setPageSize((prev) => (prev === next ? prev : next));
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    if (area) ro.observe(area);
    if (root) ro.observe(root);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [modelsForDisplay.length]);

  React.useEffect(() => { setPage(1); }, [modelSearch, filterThinking, filterTools, filterVision, provider.name]);

  // —— 归类 ——
  const SERIES_ORDER = [
    'Gemini', 'GPT', 'DeepSeek', 'Qwen', 'Grok', 'Claude', 'LLaMA', 'Mistral', 'GLM', 'Gemma', 'Kimi', 'Moonshot', 'Yi'
  ] as const;
  type Series = typeof SERIES_ORDER[number] | '未归类';

  const detectSeries = (model: ModelMetadata): Series => {
    const s = `${model?.name || ''} ${model?.label || ''}`.toLowerCase();

    // 更宽松的匹配，允许匹配到更多变体
    if (s.includes('gemini')) return 'Gemini';
    if (s.includes('gpt') || s.includes('openai')) return 'GPT';
    if (s.includes('deepseek')) return 'DeepSeek';
    if (s.includes('qwen')) return 'Qwen';
    if (s.includes('grok')) return 'Grok';
    if (s.includes('claude') || s.includes('anthropic')) return 'Claude';
    if (
      s.includes('llama') ||
      s.includes('llama2') ||
      s.includes('llama-2') ||
      s.includes('llama3') ||
      s.includes('llama-3')
    ) return 'LLaMA';
    if (s.includes('mistral') || s.includes('mixtral') || s.includes('pixtral') || s.includes('codestral')) return 'Mistral';
    if (s.includes('glm') || s.includes('chatglm')) return 'GLM';
    if (
      s.includes('gemma') ||
      s.includes('gemma2') // 支持 gemma2-9b-it 这类
    ) return 'Gemma';
    if (s.includes('kimi')) return 'Kimi';
    if (s.includes('moonshot')) return 'Moonshot';
    if (s.includes('yi')) return 'Yi';
    return '未归类';
  };

  // —— 列表排序：与 Provider 侧保持一致的前端兜底排序 ——
  const variantOrder: Record<string, number> = { pro: 100, flash: 90, turbo: 80, ultra: 75, mini: 60, nano: 50, instruct: 40, preview: 10 };
  const extractVersion = (text: string): number => {
    const m = text.match(/\b(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const v = parseFloat(m[1]);
    return isFinite(v) ? Math.round(v * 1000) : 0;
  };
  const buildKey = (m: ModelMetadata) => {
    const t = `${(m.label || '').toLowerCase()} ${(m.name || '').toLowerCase()}`;
    const isLatest = /\blatest\b/.test(t);
    let variant = 0; for (const [k,w] of Object.entries(variantOrder)) if (t.includes(k)) variant = Math.max(variant, w);
    const brand = (()=>{
      const known = ['gemini','gpt','deepseek','qwen','grok','claude','llama','mistral','glm','gemma','kimi','moonshot','yi'];
      return known.find(k=>t.includes(k)) || '';
    })();
    // 首数字版本，优先确保 Gemini 2.5 > 1.5
    const version = extractVersion(t);
    // 规模分数（b/m/k）
    let sizeScore = 0; const ms = t.match(/(\d+(?:\.\d+)?)([bmk])\b/); if (ms) { const num = parseFloat(ms[1]); const unit = ms[2]; const mul = unit==='b'?1_000_000_000:unit==='m'?1_000_000:1_000; sizeScore = isFinite(num)? num*mul:0; }
    // 修订号
    let rev = 0; const rv = t.match(/(?:^|[^a-z])([0-9]{2,4})(?:[^a-z]|$)/); if (rv) { const r=parseInt(rv[1]); if (isFinite(r)) rev=r; }
    return { brand, version, variant, isLatest, sizeScore, rev, lower: t };
  };
  const compareModels = (a: ModelMetadata, b: ModelMetadata) => {
    const ka = buildKey(a); const kb = buildKey(b);
    if (ka.brand !== kb.brand) return ka.brand.localeCompare(kb.brand);
    if (ka.version !== kb.version) return kb.version - ka.version;
    if (ka.variant !== kb.variant) return kb.variant - ka.variant;
    if (ka.isLatest !== kb.isLatest) return Number(kb.isLatest) - Number(ka.isLatest);
    if (ka.sizeScore !== kb.sizeScore) return kb.sizeScore - ka.sizeScore;
    if (ka.rev !== kb.rev) return kb.rev - ka.rev;
    return ka.lower.localeCompare(kb.lower);
  };

  const filtered = modelsForDisplay.filter((m) => {
    const textOk = (m.label || m.name || '').toLowerCase().includes(modelSearch.toLowerCase());
    if (!textOk) return false;
    if (!filterThinking && !filterTools && !filterVision) return true;
    const caps = getModelCapabilities(m.name);
    if (filterThinking && !caps.supportsThinking) return false;
    if (filterTools && !caps.supportsFunctionCalling) return false;
    if (filterVision && !caps.supportsVision) return false;
    return true;
  }).sort(compareModels);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const groups = new Map<Series, ModelMetadata[]>();
  for (const x of pageItems) {
    const series = detectSeries(x);
    if (!groups.has(series)) groups.set(series, []);
    groups.get(series)!.push(x);
  }
  const orderedSeries: Series[] = [...SERIES_ORDER, '未归类'];

  React.useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  return (
    <div ref={rootRef} className="flex flex-col flex-1 min-h-0 h-full overflow-hidden gap-2">
      <div className="flex items-center gap-2 shrink-0 min-h-8">
        <h3 className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400 shrink-0">模型</h3>
        {modelsForDisplay.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="w-6 h-6 flex items-center justify-center rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                title="上一页"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-0.5 h-6 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 min-w-[36px] tabular-nums">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                title="下一页"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums whitespace-nowrap">
              {total} 个
            </span>
            {batchMode && isMultiStrategyProvider && (
              (() => {
                const ids = pageItems.map((x) => x.name);
                const allChecked = ids.length > 0 && ids.every((id) => !!checked[id]);
                const anyChecked = ids.some((id) => !!checked[id]);
                const label = allChecked ? "取消本页" : (anyChecked ? "反选" : "全选本页");
                return (
                  <button
                    type="button"
                    className="px-1.5 h-6 text-[11px] rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
                    onClick={() => {
                      if (allChecked) { setAll(ids, false); return; }
                      setChecked((prev) => {
                        const next: Record<string, boolean> = { ...prev };
                        for (const id of ids) next[id] = !prev[id];
                        return next;
                      });
                    }}
                  >
                    {label}
                  </button>
                );
              })()
            )}
          </div>
        )}
        {searchVisible && (
          <div className="relative flex-1 min-w-[8rem] max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (modelSearch) setModelSearch("");
                  else setSearchOpen(false);
                }
              }}
              placeholder="筛选模型"
              className="w-full h-8 pl-7 pr-7 text-sm rounded-lg border border-slate-200/80 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/50 focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400/50"
            />
            <button
              type="button"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-md"
              title="关闭搜索"
              onClick={() => {
                setModelSearch("");
                setSearchOpen(false);
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {modelsForDisplay.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (searchVisible && !modelSearch.trim()) setSearchOpen(false);
                  else setSearchOpen(true);
                }}
                className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${searchVisible ? "bg-slate-200/70 text-slate-700 dark:bg-white/12 dark:text-slate-200" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-white/8"}`}
                title="筛选模型"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFilterThinking((v) => !v)}
                className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${filterThinking ? "bg-slate-200/70 text-slate-700 dark:bg-white/12 dark:text-slate-200" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-white/8"}`}
                title="仅显示支持思考的模型"
              >
                <Brain className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFilterTools((v) => !v)}
                className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${filterTools ? "bg-slate-200/70 text-slate-700 dark:bg-white/12 dark:text-slate-200" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-white/8"}`}
                title="仅显示支持工具调用的模型"
              >
                <Workflow className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFilterVision((v) => !v)}
                className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${filterVision ? "bg-slate-200/70 text-slate-700 dark:bg-white/12 dark:text-slate-200" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-white/8"}`}
                title="仅显示支持视觉的模型"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            onClick={refreshModels}
            title="刷新模型列表"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {isMultiStrategyProvider && modelsForDisplay.length > 0 && (
            <Button
              variant="outline"
              className="h-8 px-2.5 text-xs rounded-lg"
              onClick={() => setBatchMode((v) => !v)}
            >
              {batchMode ? "退出批量" : "批量"}
            </Button>
          )}
          {!batchMode && !isOllama && (
            <ProviderAddModelDialog providerName={provider.name} onAdded={() => setModelSearch("")} />
          )}
          {isMultiStrategyProvider && batchMode && (
            <>
              <Select value={batchStrategy} onValueChange={(v:any)=>{ if (v === '__clear__') { const anyChecked = Object.values(checked).some(Boolean); if (anyChecked) { void clearBatch(); } return; } if (v === '__auto__') { void applyAutoInfer(); return; } setBatchStrategy(v); const anyChecked = Object.values(checked).some(Boolean); if (anyChecked) { void applyBatch(v); } }}>
                <SelectTrigger className="w-32 h-8 text-[10px] rounded border-slate-200/70 dark:border-slate-700/70"><SelectValue placeholder="选择策略"/></SelectTrigger>
                <SelectContent className="rounded min-w-[140px]">
                  <SelectItem value="__auto__" className="text-[11px] py-1.5">自动推断</SelectItem>
                  <SelectItem value="openai-compatible" className="text-[11px] py-1.5">OpenAI Compatible</SelectItem>
                  <SelectItem value="openai-responses" className="text-[11px] py-1.5">OpenAI Responses</SelectItem>
                  <SelectItem value="openai" className="text-[11px] py-1.5">OpenAI Strict</SelectItem>
                  <SelectItem value="anthropic" className="text-[11px] py-1.5">Anthropic</SelectItem>
                  <SelectItem value="gemini" className="text-[11px] py-1.5">Gemini</SelectItem>
                  <SelectItem value="deepseek" className="text-[11px] py-1.5">DeepSeek</SelectItem>
                  <SelectItem value="__clear__" className="text-[11px] py-1.5 text-red-600">清除覆盖</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" className="h-8 px-1.5 text-[10px] rounded" onClick={() => applyBatch()}>应用</Button>
              <Button variant="secondary" className="h-8 px-1.5 text-[10px] rounded border-slate-200/70 dark:border-slate-700/70 transition-colors" onClick={clearBatch}>清除</Button>
              <Button
                variant="ghost"
                className="h-8 px-1.5 text-[10px] rounded transition-colors"
                onClick={() => {
                  const ids = modelsForDisplay.map(m => m.name);
                  const allChecked = ids.every(id => !!checked[id]);
                  const anyChecked = ids.some(id => !!checked[id]);
                  if (allChecked) {
                    setChecked(prev => {
                      const next = { ...prev } as Record<string, boolean>;
                      ids.forEach(id => { next[id] = false; });
                      return next;
                    });
                  } else if (!anyChecked) {
                    setAll(ids, true);
                  } else {
                    setChecked(prev => {
                      const next = { ...prev } as Record<string, boolean>;
                      ids.forEach(id => { next[id] = !prev[id]; });
                      return next;
                    });
                  }
                }}
              >
                全选
              </Button>
            </>
          )}
        </div>
      </div>

      <div ref={listAreaRef} className="flex-1 min-h-0 overflow-hidden pb-4">
        {modelsForDisplay && modelsForDisplay.length > 0 ? (
          total === 0 ? (
            <div className="px-1 py-10 text-center">
              <p className="text-xs text-slate-400 dark:text-slate-500">没有符合筛选条件的模型</p>
            </div>
          ) : (
            <div ref={listContentRef} className="space-y-2">
              {orderedSeries.map((series) => {
                const list = groups.get(series) || [];
                if (list.length === 0) return null;
                return (
                  <div key={series}>
                    <div className="flex items-center justify-between px-1 pb-0.5">
                      <div className="text-xs font-medium text-slate-400 dark:text-slate-500">{series}</div>
                      {batchMode && isMultiStrategyProvider ? (
                        (() => {
                          const groupIds = list.map((x) => x.name);
                          const allChecked = groupIds.every((id) => !!checked[id]);
                          const next = !allChecked;
                          return (
                            <button
                              type="button"
                              className="text-[11px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              onClick={() => setAll(groupIds, next)}
                            >
                              {allChecked ? "取消" : "全选"}
                            </button>
                          );
                        })()
                      ) : null}
                    </div>
                    <div className="space-y-0.5">
                      {[...list].sort(compareModels).map(renderItem)}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="px-1 py-10 text-center">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {provider.displayStatus === "NO_KEY"
                ? "填写密钥后可拉取模型，也可手动添加"
                : "暂无模型，可刷新列表或手动添加"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}


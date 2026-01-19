"use client";
import React from "react";
import type { ModelMetadata } from "@/lib/metadata/types";
import type { ProviderWithStatus } from "@/hooks/useProviderManagement";
import { Input } from "@/components/ui/input";
import { ProviderAddModelDialog } from "./ProviderAddModelDialog";
import { Brain, Workflow, Camera, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { getModelCapabilities } from "@/lib/provider/staticModels";
import { ProviderModelItem } from "./ProviderModelItem";
import { toast } from "@/components/ui/sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { StrategyValue } from "@/lib/provider/strategyInference";

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

  // 搜索框展开状态
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchWrapRef = React.useRef<HTMLDivElement | null>(null);

  // 点击外部关闭搜索框
  React.useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (searchOpen && searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [searchOpen]);

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
      await providerModelService.fetchIfNeeded(provider.name);
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
  }, [provider.name, modelsForDisplay]);

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

  // —— 分页 ——
  const PAGE_SIZE = 12; // 一页更少条目，避免内部滚动条，滚动交给页面
  const [page, setPage] = React.useState(1);

  // 仅在筛选条件变化时重置分页，刷新模型列表时保持当前页，避免视觉跳动
  React.useEffect(() => { setPage(1); }, [modelSearch, filterThinking, filterTools, filterVision]);

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

  return (
    <div ref={rootRef} className="space-y-1.5">
      {/* 紧凑工具栏 */}
      <div className="flex items-center justify-between py-1 px-2 bg-slate-50/30 dark:bg-slate-900/10 rounded">
        <div className="flex items-center gap-1.5">
          {/* 能力筛选按钮组 */}
          <div className="flex items-center gap-0.5">
            <button 
              type="button" 
              onClick={()=>setFilterThinking(v=>!v)} 
              className={`p-0.5 h-5 w-5 rounded flex items-center justify-center transition-colors ${filterThinking? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300':'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`} 
              title="仅显示支持思考的模型"
            >
              <Brain className="w-3 h-3"/>
            </button>
            <button 
              type="button" 
              onClick={()=>setFilterTools(v=>!v)} 
              className={`p-0.5 h-5 w-5 rounded flex items-center justify-center transition-colors ${filterTools? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300':'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`} 
              title="仅显示支持工具调用的模型"
            >
              <Workflow className="w-3 h-3"/>
            </button>
            <button 
              type="button" 
              onClick={()=>setFilterVision(v=>!v)} 
              className={`p-0.5 h-5 w-5 rounded flex items-center justify-center transition-colors ${filterVision? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300':'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`} 
              title="仅显示支持视觉的模型"
            >
              <Camera className="w-3 h-3"/>
            </button>
          </div>
          {/* 搜索框 */}
          <div ref={searchWrapRef} className="h-5 flex items-center">
            {searchOpen ? (
              <Input 
                value={modelSearch} 
                onChange={(e) => setModelSearch(e.target.value)} 
                placeholder="筛选模型" 
                className="h-5 text-[11px] w-32 rounded border-slate-200/70 dark:border-slate-700/70 bg-white dark:bg-slate-800" 
                autoFocus 
              />
            ) : (
              <button 
                onClick={() => setSearchOpen(true)} 
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors" 
                title="筛选模型"
              >
                <svg className="w-3 h-3 text-slate-500 dark:text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
                </svg>
              </button>
            )}
          </div>
          {/* 刷新模型列表按钮 - 移到工具栏上方 */}
          <button 
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-500 dark:text-slate-400 transition-colors" 
            onClick={refreshModels}
            title="刷新模型列表"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="flex items-center gap-1 md:flex-nowrap flex-wrap">
          {isMultiStrategyProvider && (
            <Button 
              variant="outline" 
              className="h-5 px-1.5 text-[10px] rounded border-slate-200/70 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors" 
              onClick={()=>setBatchMode(v=>!v)}
            >
              {batchMode? '退出' : '批量'}
            </Button>
          )}
          {!batchMode && !isOllama && (
            <ProviderAddModelDialog providerName={provider.name} onAdded={() => setModelSearch('')} />
          )}
          {isMultiStrategyProvider && batchMode && (
            <>
              <Select value={batchStrategy} onValueChange={(v:any)=>{ if (v === '__clear__') { const anyChecked = Object.values(checked).some(Boolean); if (anyChecked) { void clearBatch(); } return; } if (v === '__auto__') { void applyAutoInfer(); return; } setBatchStrategy(v); const anyChecked = Object.values(checked).some(Boolean); if (anyChecked) { void applyBatch(v); } }}>
                <SelectTrigger className="w-32 h-5 text-[10px] rounded border-slate-200/70 dark:border-slate-700/70"><SelectValue placeholder="选择策略"/></SelectTrigger>
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
              <Button className="h-5 px-1.5 text-[10px] rounded bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/40 border border-blue-200/50 dark:border-blue-800/40 transition-colors" onClick={() => applyBatch()}>应用</Button>
              <Button variant="secondary" className="h-5 px-1.5 text-[10px] rounded border-slate-200/70 dark:border-slate-700/70 transition-colors" onClick={clearBatch}>清除</Button>
              <Button
                variant="ghost"
                className="h-5 px-1.5 text-[10px] rounded transition-colors"
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

      <div className="space-y-1">
        {modelsForDisplay && modelsForDisplay.length > 0 ? (
          (() => {
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
            const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            const safePage = Math.min(Math.max(1, page), totalPages);
            const start = (safePage - 1) * PAGE_SIZE;
            const pageItems = filtered.slice(start, start + PAGE_SIZE);

            const groups = new Map<Series, ModelMetadata[]>();
            for (const x of pageItems) {
              const series = detectSeries(x);
              if (!groups.has(series)) groups.set(series, []);
              groups.get(series)!.push(x);
            }

            const orderedSeries: Series[] = [...SERIES_ORDER, '未归类'];

            return (
              <>
                {/* 分组渲染 */}
                {orderedSeries.map(series => {
                  const list = groups.get(series) || [];
                  if (list.length === 0) return null;
                  return (
                    <div key={series} className="mt-1">
                      <div className="flex items-center justify-between px-2 py-1 bg-slate-50/50 dark:bg-slate-900/20 rounded-t border-x border-t border-slate-200/50 dark:border-slate-700/50">
                        <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 tracking-wide">{series}</div>
                        {batchMode && isMultiStrategyProvider ? (
                          (() => {
                            const groupIds = list.map(x => x.name);
                            const allChecked = groupIds.every(id => !!checked[id]);
                            const next = !allChecked;
                            return (
                              <button
                                type="button"
                                className="text-[9px] px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                                onClick={() => setAll(groupIds, next)}
                              >
                                {allChecked ? '取消' : '全选'}
                              </button>
                            );
                          })()
                        ) : null}
                        
                      </div>
                      <div className="space-y-0 border-x border-b border-slate-200/50 dark:border-slate-700/50 rounded-b p-1 bg-white/40 dark:bg-slate-900/20">
                        {list.sort(compareModels).map(renderItem)}
                      </div>
                    </div>
                  );
                })}
                
                {/* 分页控件 - 移到底部 */}
                <div className="flex items-center justify-between gap-2 text-[10px] px-2 py-1 mt-1 bg-slate-50/30 dark:bg-slate-900/10 rounded">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 dark:text-slate-400">共 {total} 个</span>
                    {batchMode && isMultiStrategyProvider && (
                      (() => {
                        const ids = pageItems.map(x=>x.name);
                        const allChecked = ids.every(id => !!checked[id]);
                        const anyChecked = ids.some(id => !!checked[id]);
                        const label = allChecked ? '取消本页' : (anyChecked ? '反选' : '全选本页');
                        return (
                          <button
                            className="px-1.5 py-0.5 text-[9px] rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-500 transition-colors"
                            onClick={()=>{
                              if (allChecked) { setAll(ids, false); return; }
                              setChecked(prev => {
                                const next: Record<string, boolean> = { ...prev };
                                for (const id of ids) next[id] = !prev[id];
                                return next;
                              });
                            }}
                          >{label}</button>
                        );
                      })()
                    )}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button 
                      className="w-5 h-5 flex items-center justify-center rounded disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-500 dark:text-slate-400 transition-colors" 
                      disabled={safePage<=1} 
                      onClick={()=>setPage(p=>Math.max(1,p-1))}
                      title="上一页"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                    <span className="px-1.5 h-5 flex items-center justify-center text-slate-600 dark:text-slate-400 min-w-[32px]">{safePage}/{totalPages}</span>
                    <button 
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-500 dark:text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" 
                      disabled={safePage>=totalPages} 
                      onClick={()=>setPage(p=>Math.min(totalPages,p+1))}
                      title="下一页"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </>
            );
          })()
        ) : (
          (()=>{
            const noModels = provider.models && provider.models.length === 0;
            const connecting = provider.displayStatus === 'CONNECTING';
            const noKey = provider.displayStatus === 'NO_KEY';
            if (noModels && !connecting) {
              return (
                <div className="text-xs text-gray-500 dark:text-gray-400 py-2 pl-2 flex items-center justify-between">
                  <span>未找到可用模型。核对提供商是否需要v1路径或使用↗菜单‘调试网络请求’功能拉取模型。</span>
                  <button className="px-2 py-1 border rounded" onClick={refreshModels}>刷新模型</button>
                </div>
              );
            }
            return (
              <p className="text-xs text-gray-500 dark:text-gray-400 py-2 pl-2">
                {noModels ? '正在加载模型...' : (noKey ? '已显示已知/静态模型。配置 API 密钥后可拉取最新模型。' : '')}
              </p>
            );
          })()
        )}
      </div>
    </div>
  );
}


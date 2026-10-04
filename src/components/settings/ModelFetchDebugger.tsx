"use client";
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
// 开发辅助：本面板使用更轻量的原生 input/textarea，避免臃肿
import SchemaModelQuickPicker from './SchemaModelQuickPicker';
import { Badge } from '@/components/ui/badge';
import { tauriFetch } from '@/lib/request';
import { toast } from '@/components/ui/sonner';
import type { ProviderWithStatus } from '@/hooks/useProviderManagement';

interface ModelFetchDebuggerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderWithStatus;
  baseUrl: string;
}

export function ModelFetchDebugger({ open, onOpenChange, provider, baseUrl }: ModelFetchDebuggerProps) {
  const [rule, setRule] = useState<{ useV1?: boolean; endpointSuffix?: string; modelsArrayPath?: string; idPath?: string; labelPath?: string; autoLabelFromId?: boolean }>({ endpointSuffix: '/models', useV1: undefined });
  const [debugFetchLoading, setDebugFetchLoading] = useState(false);
  const [debugResult, setDebugResult] = useState<string>('');
  const [debugStats, setDebugStats] = useState<{ listOk?: boolean; total?: number; idMatched?: number; labelMatched?: number; firstExtracted?: { id?: string; label?: string }; firstRaw?: any } | null>(null);
  const [showFirstRaw, setShowFirstRaw] = useState(false);
  // 使用全局（会话级）模型选择器状态
  // 不落地存储，仅在应用运行期间记忆
  const [schemaHelperModel, setSchemaHelperModel] = useState<string>('');
  const [schemaText, setSchemaText] = useState<string>('');
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { specializedStorage } = await import('@/lib/storage');
        const saved = await specializedStorage.models.getProviderFetchDebugRule(provider.name);
        if (saved) setRule(saved);
        const last = await specializedStorage.models.getProviderFetchDebugResult(provider.name);
        if (last && last.length) setDebugResult(JSON.stringify(last, null, 2));
      } catch {}
    })();
  }, [provider.name]);

  const pickByPath = (obj: any, path?: string) => {
    if (!path) return undefined;
    return path.split('.').reduce((acc: any, key: string) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  };

  const toTitleFromId = (s: string) => {
    if (!s) return s;
    let spaced = s.replace(/([a-z])([A-Z])/g, '$1 $2');
    spaced = spaced.replace(/[_\-:.\/]+/g, ' ');
    spaced = spaced.replace(/\s+/g, ' ').trim();
    return spaced.split(' ').map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
  };

  const handleDoFetch = async () => {
    setDebugFetchLoading(true);
    setDebugResult('');
    try {
      const base0 = (baseUrl || '').replace(/\/$/, '');
      const baseX = rule.useV1 && !/\/v1\b/.test(base0) ? `${base0}/v1` : base0;
      let url = baseX + (rule.endpointSuffix || '/models');
      const headers: Record<string, string> = {};
      // Google AI 特殊：使用 ?key=API_KEY，不加 Authorization 头
      if (provider.name.toLowerCase() === 'google ai') {
        try {
          const { KeyManager } = await import('@/lib/llm/KeyManager');
          const k = await KeyManager.getProviderKey(provider.name);
          if (k) url += (url.includes('?') ? '&' : '?') + `key=${encodeURIComponent(k)}`;
        } catch {}
      } else if (provider.requiresApiKey) {
        try {
          const { KeyManager } = await import('@/lib/llm/KeyManager');
          const k = await KeyManager.getProviderKey(provider.name);
          if (k) headers['Authorization'] = `Bearer ${k}`;
        } catch {}
      }
      const res: any = await tauriFetch(url, { method: 'GET', headers, fallbackToBrowserOnError: true, verboseDebug: true, debugTag: 'ModelList' });
      // 若 schema 文本区为空，则自动填充为最新响应体，便于一键 AI 解析
      try {
        const current = (schemaText || '').trim();
        if (!current) {
          const pretty = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
          setSchemaText(pretty);
        }
      } catch {}
      const possible = pickByPath(res, rule.modelsArrayPath || 'data');
      const arr: any[] = Array.isArray(possible) ? possible : (Array.isArray(res) ? res : []);
      let idMatched = 0; let labelMatched = 0;
      const mapped = arr.map((it) => {
        const idVal = pickByPath(it, rule.idPath || 'id') ?? it?.id ?? it?.model ?? it?.name;
        let labelVal: any = pickByPath(it, rule.labelPath || '') ?? it?.label ?? it?.name;
        if ((labelVal === undefined || labelVal === null || String(labelVal).trim() === '') && rule.autoLabelFromId) {
          labelVal = toTitleFromId(String(idVal));
        }
        if (labelVal === undefined || labelVal === null || String(labelVal).trim() === '') {
          labelVal = String(idVal);
        }
        if (idVal !== undefined && idVal !== null && String(idVal).length > 0) idMatched++;
        if (labelVal !== undefined && labelVal !== null && String(labelVal).length > 0) labelMatched++;
        return { name: String(idVal), label: String(labelVal) };
      }).filter((m) => m.name);

      const firstRaw = arr && arr.length > 0 ? arr[0] : undefined;
      const firstExtracted = mapped && mapped.length > 0 ? { id: mapped[0].name, label: mapped[0].label } : undefined;
      setDebugStats({ listOk: Array.isArray(arr), total: arr.length, idMatched, labelMatched, firstExtracted, firstRaw });
      setDebugResult(JSON.stringify({ url, count: mapped.length, models: mapped }, null, 2));
      try {
        const { specializedStorage } = await import('@/lib/storage');
        await specializedStorage.models.setProviderFetchDebugRule(provider.name, rule);
        await specializedStorage.models.setProviderFetchDebugResult(provider.name, mapped);
      } catch {}
    } catch (e: any) {
      setDebugResult(`请求失败: ${e?.message || String(e)}`);
      setDebugStats(null);
    } finally {
      setDebugFetchLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[960px] w-[96vw]">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <DialogTitle>模型获取调试器 - {provider.name}</DialogTitle>
            <SchemaModelQuickPicker className="min-w-[280px]" />
          </div>
          <DialogDescription>基于主路径配置列表接口与解析规则，点击“获取”在下方查看结果。</DialogDescription>
        </DialogHeader>

        
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">粘贴模型列表 Schema（可选）</label>
              <textarea value={schemaText} onChange={(e)=>setSchemaText(e.target.value)} placeholder="粘贴 OpenAPI/JSON 示例返回或文档片段，AI 将尝试解析出列表路径/ID/名称路径" className="min-h-[90px] w-full border border-slate-300 rounded-md px-2 py-1 font-mono text-[12px] bg-white dark:bg-slate-800 dark:border-slate-600" />
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="dialogPrimary" disabled={!schemaText || parsing} onClick={async()=>{
                  setParsing(true);
                  try {
                    const { suggestModelFetchRule } = await import('@/lib/rules/modelFetchSchemaHelper');
                    // 目前解析逻辑不依赖后端调用，未来如需调用所选模型可在此扩展
                    const suggestion = await suggestModelFetchRule({ model: schemaHelperModel, schemaText });
                    if (suggestion) {
                      setRule(r=>({ ...r, endpointSuffix: suggestion.endpointSuffix ?? r.endpointSuffix, modelsArrayPath: suggestion.modelsArrayPath ?? r.modelsArrayPath, idPath: suggestion.idPath ?? r.idPath, labelPath: suggestion.labelPath ?? r.labelPath }));
                    }
                    // 追加：如选择了 provider/model，则调用 AI 进一步解析，覆盖建议字段
                    const { useSchemaHelperStore } = await import('@/store/schemaHelperStore');
                    const st = useSchemaHelperStore.getState();
                    if (st.selectedProvider && st.selectedModelId) {
                      const { aiParseSchemaWithModel } = await import('@/lib/rules/schema-ai-parser');
                      const aiRes = await aiParseSchemaWithModel(st.selectedProvider, st.selectedModelId, schemaText);
                      if (aiRes) {
                        setRule(r=>({
                          ...r,
                          endpointSuffix: aiRes.endpointSuffix ?? r.endpointSuffix,
                          modelsArrayPath: aiRes.modelsArrayPath ?? r.modelsArrayPath,
                          idPath: aiRes.idPath ?? r.idPath,
                          labelPath: aiRes.labelPath ?? r.labelPath,
                        }));
                      }
                    }
                  } catch (e) { console.error('解析 Schema 失败', e); } finally { setParsing(false); }
                }}>AI 解析并填充</Button>
                <Button size="sm" variant="dialogSecondary" onClick={()=>setSchemaText('')}>清空</Button>
              </div>
            </div>
          </div>

        <div className="space-y-3 text-sm max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-start">
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">主路径</label>
              <div className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 break-all select-text text-xs">{(baseUrl || '').replace(/\/$/, '')}</div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">是否带 v1</label>
              <div className="h-7 flex items-center gap-2">
                <input type="checkbox" checked={!!rule.useV1} onChange={(e)=>setRule(r=>({...r, useV1: e.target.checked}))} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">路径补充</label>
              <input value={rule.endpointSuffix || ''} onChange={(e)=>setRule(r=>({...r, endpointSuffix: e.target.value}))} placeholder="/models 或 /v1/models" className="h-7 w-64 border border-slate-300 rounded-md px-2 text-xs bg-white dark:bg-slate-800 dark:border-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">列表路径</label>
              <input value={rule.modelsArrayPath || ''} onChange={(e)=>setRule(r=>({...r, modelsArrayPath: e.target.value}))} placeholder="例如 data 或 result.items" className="h-7 w-64 border border-slate-300 rounded-md px-2 text-xs bg-white dark:bg-slate-800 dark:border-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">模型ID路径</label>
              <input value={rule.idPath || ''} onChange={(e)=>setRule(r=>({...r, idPath: e.target.value}))} placeholder="例如 id 或 model" className="h-7 w-64 border border-slate-300 rounded-md px-2 text-xs bg-white dark:bg-slate-800 dark:border-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">模型名称路径</label>
              <input value={rule.labelPath || ''} onChange={(e)=>setRule(r=>({...r, labelPath: e.target.value}))} placeholder="可选 例如 name 或 label" className="h-7 w-64 border border-slate-300 rounded-md px-2 text-xs bg-white dark:bg-slate-800 dark:border-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">名称为空时自动生成</label>
              <div className="h-7 flex items-center gap-2">
                <input type="checkbox" checked={!!rule.autoLabelFromId} onChange={(e)=>setRule(r=>({...r, autoLabelFromId: e.target.checked}))} />
                <span className="text-[11px] text-slate-500">将 id 转为“空格分词+每词首字母大写”，如 deepseek-chat → Deepseek Chat</span>
              </div>
            </div>
          </div>


          <div className="flex items-center gap-2 mt-1">
            <Button onClick={handleDoFetch} disabled={debugFetchLoading} variant="dialogPrimary" size="sm">{debugFetchLoading ? '获取中…' : '获取'}</Button>
            <Button onClick={async()=>{ const { specializedStorage } = await import('@/lib/storage'); await specializedStorage.models.setProviderFetchDebugRule(provider.name, rule); toast.success('规则已保存'); }} variant="dialogSecondary" size="sm">保存规则</Button>
          </div>

          {debugStats && (
            <>
              <div className="mt-3 text-xs flex flex-wrap items-center gap-2">
                <Badge variant="outline">列表路径: {debugStats.listOk ? '✓' : '✗'}</Badge>
                <Badge variant="outline">返回: {debugStats.total ?? 0}</Badge>
                <Badge variant="outline">ID: {debugStats.idMatched ?? 0}</Badge>
                <Badge variant="outline">名称: {debugStats.labelMatched ?? 0}</Badge>
                {debugStats.firstExtracted && (
                  <span className="text-slate-600 dark:text-slate-300 ml-1">提取(ID: {debugStats.firstExtracted.id}, 名称: {debugStats.firstExtracted.label})</span>
                )}
                <button className="ml-auto text-[11px] text-blue-600 hover:underline" onClick={() => setShowFirstRaw(v => !v)}>{showFirstRaw ? '隐藏原始项' : '查看原始项'}</button>
              </div>
              {showFirstRaw && (
                <div className="mt-2">
                  <textarea readOnly value={debugStats.firstRaw ? JSON.stringify(debugStats.firstRaw, null, 2) : ''} className="min-h-[90px] w-full border border-slate-300 rounded-md px-2 py-1 font-mono text-[11px] bg-slate-50 dark:bg-slate-800 dark:border-slate-600" />
                </div>
              )}
            </>
          )}

          <div className="mt-3">
            <label className="text-xs text-slate-500">获取结果</label>
            <textarea value={debugResult} onChange={(e)=>setDebugResult(e.target.value)} className="min-h-[160px] w-full border border-slate-300 rounded-md px-2 py-1 font-mono text-[12px] bg-slate-50 dark:bg-slate-800 dark:border-slate-600" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ModelFetchDebugger;


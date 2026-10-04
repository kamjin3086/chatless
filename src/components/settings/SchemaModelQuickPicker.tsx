"use client";
/**
 * 开发辅助组件：Schema 解析用模型选择器（从全部 Provider 中选择）
 * 注意：这是开发/调试辅助功能，不影响聊天等正式功能；
 * - 状态仅保存在 zustand（会话级），不写入本地存储；
 * - UI 简洁，避免引入复杂依赖。
 */
import React, { useEffect } from 'react';
import { useProviderMetaStore } from '@/store/providerMetaStore';
import { useSchemaHelperStore } from '@/store/schemaHelperStore';

interface SchemaModelQuickPickerProps {
  className?: string;
}

export default function SchemaModelQuickPicker({ className }: SchemaModelQuickPickerProps) {
  const providers = useProviderMetaStore(s => s.list) as any[];
  const { selectedProvider, selectedModelId, setSelection } = useSchemaHelperStore();

  // 默认选择：首次加载时选中第一个 Provider/其第一个模型
  useEffect(() => {
    if (!providers || providers.length === 0) return;
    if (!selectedProvider) {
      const firstP = providers[0];
      const firstM = (firstP.models && firstP.models[0]?.name) || '';
      setSelection(firstP.name, firstM);
    } else {
      const p = providers.find(p=>p.name===selectedProvider);
      if (p && (!selectedModelId || !p.models?.some((m:any)=>m.name===selectedModelId))) {
        const firstM = (p.models && p.models[0]?.name) || '';
        setSelection(p.name, firstM);
      }
    }
     
  }, [providers]);

  return (
    <div className={className}>
      <div className="text-xs text-slate-500 mb-1">AI 解析模型（从全部 Provider 选择）</div>
      <div className="flex gap-2 items-center">
        <select
          value={selectedProvider || ''}
          onChange={(e) => setSelection(e.target.value, '')}
          className="h-8 border border-slate-300 rounded-md px-2 text-sm bg-white dark:bg-slate-800 dark:border-slate-600"
        >
          <option value="" disabled>选择提供商</option>
          {providers.map((p:any)=> (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>

        <select
          value={selectedModelId || ''}
          onChange={(e) => setSelection(selectedProvider || '', e.target.value)}
          disabled={!selectedProvider}
          className="w-40 h-8 border border-slate-300 rounded-md px-2 text-sm bg-white dark:bg-slate-800 dark:border-slate-600"
        >
          <option value="" disabled>{selectedProvider ? '选择模型' : '先选择提供商'}</option>
          {(providers.find((pp:any)=>pp.name===selectedProvider)?.models || []).map((m:any)=> (
            <option key={m.name} value={m.name}>{m.label || m.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}


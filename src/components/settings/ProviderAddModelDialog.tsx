"use client";
import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { mergeManualModels } from "@/lib/provider/manualModelAdd";

type Strategy = 'default' | 'auto' | 'openai-compatible' | 'openai-responses' | 'openai' | 'anthropic' | 'gemini' | 'deepseek';

type Row = { id: string; label: string; strategy: Strategy };

const STRATEGY_OPTIONS: Array<{ value: Strategy; label: string }> = [
  { value: 'default', label: '跟随默认' },
  { value: 'auto', label: '自动推断策略（按模型ID）' },
  { value: 'openai-compatible', label: 'OpenAI Compatible (/v1/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (/v1/responses)' },
  { value: 'openai', label: 'OpenAI Strict' },
  { value: 'anthropic', label: 'Anthropic (messages)' },
  { value: 'gemini', label: 'Google Gemini (generateContent)' },
  { value: 'deepseek', label: 'DeepSeek (chat/completions)' },
];

// 手机上字段独占一行、输入框吃到 40px 高；sm 以上恢复原来的 32px 密集排版
const FIELD_CLASS = "w-full h-10 px-3 rounded-md border border-slate-200/70 dark:border-slate-700/70 bg-white dark:bg-slate-800/60 text-sm sm:h-8 sm:px-2.5 sm:text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-400/50 transition-colors hover:border-slate-300 dark:hover:border-slate-600";
const FIELD_LABEL_CLASS = "mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-400 sm:hidden";

export function ProviderAddModelDialog({ providerName, onAdded }: { providerName: string; onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ id: '', label: '', strategy: 'default' }]);
  const [saving, setSaving] = useState(false);

  const canSubmit = useMemo(() => rows.some(r => (r.id || '').trim().length > 0), [rows]);

  const addRow = () => setRows(prev => [...prev, { id: '', label: '', strategy: 'default' }]);
  const removeRow = (idx: number) => setRows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));

  const submit = async () => {
    const payload = rows
      .map(r => ({ id: (r.id || '').trim(), label: (r.label || '').trim(), strategy: r.strategy }))
      .filter(r => !!r.id);
    if (payload.length === 0) { toast.error('请至少填写一个模型 ID'); return; }

    setSaving(true);
    try {
      const { modelRepository } = await import('@/lib/provider/ModelRepository');
      const { specializedStorage } = await import('@/lib/storage');
      const existing = (await modelRepository.get(providerName)) || [];

      // 以覆盖为准：存在则更新 label，不存在则追加
      const list = mergeManualModels(providerName, existing, payload);

      await modelRepository.save(providerName, list);

      // 写入模型策略覆盖（非 default 才写；auto 则按ID推断）
      const { inferStrategyFromModelId } = require('@/lib/provider/strategyInference');
      await Promise.all(
        payload.filter(p => p.strategy !== 'default').map(p => {
          const st = p.strategy === 'auto' ? inferStrategyFromModelId(p.id) : p.strategy;
          if (!st) return Promise.resolve();
          return specializedStorage.models.setModelStrategy(providerName, p.id, st);
        })
      );

      toast.success(`已添加/更新 ${payload.length} 个模型`);
      setOpen(false);
      setRows([{ id: '', label: '', strategy: 'default' }]);
      onAdded?.();
    } catch (e: any) {
      console.error(e);
      toast.error('保存失败', { description: e?.message || String(e) });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs rounded-lg">添加</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-none sm:overflow-visible sm:max-w-[720px] border-slate-200/80 dark:border-slate-700/80 shadow-lg">
        <DialogHeader className="border-b border-slate-200/60 dark:border-slate-700/60 pb-3">
          <DialogTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">添加模型</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {/* 列名仅在宽屏显示一次；手机上每个字段自带标题，窄列会把中文挤成半行 */}
          <div className="hidden sm:grid grid-cols-12 gap-2 items-center px-1">
            <div className="col-span-4 text-[11px] font-medium text-slate-600 dark:text-slate-400">模型名称（显示名，可选）</div>
            <div className="col-span-4 text-[11px] font-medium text-slate-600 dark:text-slate-400">模型 ID</div>
            <div className="col-span-3 text-[11px] font-medium text-slate-600 dark:text-slate-400">请求策略</div>
            <div className="col-span-1" />
          </div>

          {rows.map((row, idx) => (
            <div
              key={idx}
              className={cn(
                "flex flex-col gap-2",
                idx > 0 && "border-t border-slate-200/60 pt-3 dark:border-slate-700/60",
                "sm:grid sm:grid-cols-12 sm:items-center sm:gap-2 sm:border-t-0 sm:pt-0"
              )}
            >
              <div className="sm:col-span-4">
                <label htmlFor={`add-model-label-${idx}`} className={FIELD_LABEL_CLASS}>模型名称（显示名，可选）</label>
                <input
                  id={`add-model-label-${idx}`}
                  className={FIELD_CLASS}
                  value={row.label}
                  onChange={e=>setRows(prev=> prev.map((r,i)=> i===idx? { ...r, label: e.target.value } : r))}
                  placeholder="如：Gemini 2.5 Pro" />
              </div>
              <div className="sm:col-span-4">
                <label htmlFor={`add-model-id-${idx}`} className={FIELD_LABEL_CLASS}>模型 ID</label>
                <input
                  id={`add-model-id-${idx}`}
                  className={FIELD_CLASS}
                  value={row.id}
                  onChange={e=>setRows(prev=> prev.map((r,i)=> i===idx? { ...r, id: e.target.value } : r))}
                  placeholder="如：gemini-2.5-pro" />
              </div>
              <div className="sm:col-span-3">
                <span className={FIELD_LABEL_CLASS} aria-hidden>请求策略</span>
                <Select value={row.strategy} onValueChange={(v:any)=>setRows(prev=> prev.map((r,i)=> i===idx? { ...r, strategy: v } : r))}>
                  <SelectTrigger aria-label="请求策略" className="h-10 w-full truncate text-xs border-slate-200/70 dark:border-slate-700/70 sm:h-8 sm:text-[11px]">
                    <SelectValue placeholder="跟随默认" className="truncate" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[360px]">
                    {STRATEGY_OPTIONS.map(opt=> (
                      <SelectItem key={opt.value} value={opt.value} className="text-[11px] truncate">{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-end gap-2 sm:col-span-1 sm:gap-1">
                <Button type="button" aria-label="添加一行" variant="outline" className="h-9 w-9 rounded-md p-0 sm:h-7 sm:w-7" onClick={addRow}>+</Button>
                <Button type="button" aria-label="删除该行" variant="outline" className="h-9 w-9 rounded-md text-slate-500 dark:text-slate-400 border-slate-200/70 dark:border-slate-700/70 p-0 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors sm:h-7 sm:w-7" onClick={()=>removeRow(idx)} disabled={rows.length<=1}>−</Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="border-t border-slate-200/60 dark:border-slate-700/60 pt-3 gap-2">
          {/* 桌面保持原来的描边按钮与「取消 在左、主操作 在右」排列 */}
          <Button variant="outline" className="hidden h-8 px-3 text-xs border-slate-200/70 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors sm:inline-flex" onClick={()=>setOpen(false)} disabled={saving}>取消</Button>
          {/* 手机：取消退成文字按钮，主操作整宽压在下面（DialogFooter 在窄屏是 column-reverse） */}
          <Button variant="ghost" className="h-10 w-full text-sm text-slate-600 dark:text-slate-300 sm:hidden" onClick={()=>setOpen(false)} disabled={saving}>取消</Button>
          <Button className="h-11 w-full text-sm sm:h-8 sm:w-auto sm:px-3 sm:text-xs" onClick={submit} disabled={saving || !canSubmit}>{saving? '保存中…' : '批量添加/更新'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

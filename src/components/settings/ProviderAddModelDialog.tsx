"use client";
import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "@/i18n/useTranslation";
import { inferStrategyFromModelId } from "@/lib/provider/strategyInference";
import { formatProviderModelCount, translateProviderModelNotification } from "./providerModelPresentation";

type Strategy = 'default' | 'auto' | 'openai-compatible' | 'openai-responses' | 'openai' | 'anthropic' | 'gemini' | 'deepseek';

type Row = { id: string; label: string; strategy: Strategy };

const STRATEGY_OPTIONS: Array<{ value: Exclude<Strategy, 'default' | 'auto'>; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI Compatible (/v1/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (/v1/responses)' },
  { value: 'openai', label: 'OpenAI Strict' },
  { value: 'anthropic', label: 'Anthropic (messages)' },
  { value: 'gemini', label: 'Google Gemini (generateContent)' },
  { value: 'deepseek', label: 'DeepSeek (chat/completions)' },
];

export function ProviderAddModelDialog({ providerName, onAdded }: { providerName: string; onAdded?: () => void }) {
  const t = useTranslation();
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
    if (payload.length === 0) { toast.error(translateProviderModelNotification('provider.models.idRequired')); return; }

    setSaving(true);
    try {
      const { modelRepository } = await import('@/lib/provider/ModelRepository');
      const { specializedStorage } = await import('@/lib/storage');
      const list = (await modelRepository.get(providerName)) || [];

      // 以覆盖为准：存在则更新 label，不存在则追加
      const idToIndex = new Map(list.map((m: any, i: number) => [String(m.name).toLowerCase(), i]));
      for (const r of payload) {
        const key = r.id.toLowerCase();
        if (idToIndex.has(key)) {
          const i = idToIndex.get(key)!;
          list[i] = { ...list[i], label: r.label || list[i].label };
        } else {
          list.push({ provider: providerName, name: r.id, label: r.label || undefined, aliases: [r.id] } as any);
        }
      }

      await modelRepository.save(providerName, list);

      // 写入模型策略覆盖（非 default 才写；auto 则按ID推断）
      await Promise.all(
        payload.map(p => {
          if (p.strategy === 'default') return Promise.resolve();
          const st = p.strategy === 'auto' ? inferStrategyFromModelId(p.id) : p.strategy;
          if (!st) return Promise.resolve();
          return specializedStorage.models.setModelStrategy(providerName, p.id, st);
        })
      );

      toast.success(translateProviderModelNotification('provider.models.addedOrUpdated').replace('{0}', formatProviderModelCount(translateProviderModelNotification, payload.length)));
      setOpen(false);
      setRows([{ id: '', label: '', strategy: 'default' }]);
      onAdded?.();
    } catch (e: any) {
      console.error(e);
      toast.error(translateProviderModelNotification('provider.models.saveFailed'), { description: e?.message || String(e) });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs rounded-lg">{t('provider.models.add')}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] border-slate-200/80 dark:border-slate-700/80 shadow-lg">
        <DialogHeader className="border-b border-slate-200/60 dark:border-slate-700/60 pb-3">
          <DialogTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('provider.models.addTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {/* 表头仅显示一次，避免每行重复列名 */}
          <div className="grid grid-cols-12 gap-2 items-center px-1">
            <div className="col-span-4 text-[11px] font-medium text-slate-600 dark:text-slate-400">{t('provider.models.optionalDisplayName')}</div>
            <div className="col-span-4 text-[11px] font-medium text-slate-600 dark:text-slate-400">{t('provider.models.id')}</div>
            <div className="col-span-3 text-[11px] font-medium text-slate-600 dark:text-slate-400">{t('provider.models.requestStrategy')}</div>
            <div className="col-span-1" />
          </div>

          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-4">
                <input
                  className="w-full h-8 px-2.5 rounded-md border border-slate-200/70 dark:border-slate-700/70 bg-white dark:bg-slate-800/60 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-400/50 transition-colors hover:border-slate-300 dark:hover:border-slate-600"
                  aria-label={t('provider.models.optionalDisplayName')}
                  value={row.label}
                  onChange={e=>setRows(prev=> prev.map((r,i)=> i===idx? { ...r, label: e.target.value } : r))}
                  placeholder={t('provider.models.nameExample')} />
              </div>
              <div className="col-span-4">
                <input
                  className="w-full h-8 px-2.5 rounded-md border border-slate-200/70 dark:border-slate-700/70 bg-white dark:bg-slate-800/60 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-400/50 transition-colors hover:border-slate-300 dark:hover:border-slate-600"
                  aria-label={t('provider.models.id')}
                  value={row.id}
                  onChange={e=>setRows(prev=> prev.map((r,i)=> i===idx? { ...r, id: e.target.value } : r))}
                  placeholder={t('provider.models.idExample')} />
              </div>
              <div className="col-span-3">
                <Select value={row.strategy} onValueChange={(v:any)=>setRows(prev=> prev.map((r,i)=> i===idx? { ...r, strategy: v } : r))}>
                  <SelectTrigger aria-label={t('provider.models.requestStrategy')} className="h-8 text-[11px] w-full truncate border-slate-200/70 dark:border-slate-700/70">
                    <SelectValue placeholder={t('provider.models.followDefault')} className="truncate" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[360px]">
                    <SelectItem value="default" className="text-[11px] truncate">{t('provider.models.followDefault')}</SelectItem>
                    <SelectItem value="auto" className="text-[11px] truncate">{t('provider.models.inferStrategyById')}</SelectItem>
                    {STRATEGY_OPTIONS.map(opt=> (
                      <SelectItem key={opt.value} value={opt.value} className="text-[11px] truncate">{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1 flex items-center gap-1 justify-end">
                <Button type="button" aria-label={t('provider.models.addRow')} variant="outline" className="h-7 w-7 rounded-md p-0" onClick={addRow}>+</Button>
                <Button type="button" aria-label={t('provider.models.removeRow')} variant="outline" className="h-7 w-7 rounded-md text-slate-500 dark:text-slate-400 border-slate-200/70 dark:border-slate-700/70 p-0 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors" onClick={()=>removeRow(idx)} disabled={rows.length<=1}>−</Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="border-t border-slate-200/60 dark:border-slate-700/60 pt-3 gap-2">
          <Button variant="outline" className="h-8 px-3 text-xs border-slate-200/70 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors" onClick={()=>setOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button className="h-8 px-3 text-xs" onClick={submit} disabled={saving || !canSubmit}>{saving ? t('provider.models.saving') : t('provider.models.addOrUpdate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


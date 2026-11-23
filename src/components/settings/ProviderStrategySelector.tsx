"use client";
import { inferStrategyFromModelId, type StrategyValue } from "@/lib/provider/strategyInference";
import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "@/i18n/useTranslation";
import { formatProviderModelStrategyUpdate, translateProviderModelNotification } from "./providerModelPresentation";

type Strategy = 'openai' | 'openai-responses' | 'openai-compatible' | 'anthropic' | 'gemini' | 'deepseek' | '__auto__';

const STRATEGY_OPTIONS: Array<{ value: Exclude<Strategy, '__auto__'>; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI Compatible (/v1/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (/v1/responses)' },
  { value: 'openai', label: 'OpenAI Strict' },
  { value: 'anthropic', label: 'Anthropic (messages)' },
  { value: 'gemini', label: 'Google Gemini (generateContent)' },
  { value: 'deepseek', label: 'DeepSeek (chat/completions)' },
];

export function ProviderStrategySelector({
  providerName,
  value,
  onChange,
}: {
  providerName: string;
  value: Strategy;
  onChange: (v: Strategy) => void;
}) {
  const t = useTranslation();
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t('provider.models.defaultStrategy')}</label>
      <div className="flex items-center gap-2">
        <Select
          value={value}
          onValueChange={async (val: Strategy) => {
            try {
              if (val === '__auto__') {
                // 自动推断：清除provider默认策略，由每个模型按ID推断；对已有模型尝试一次性写入推断结果
                const { modelRepository } = await import('@/lib/provider/ModelRepository');
                const { specializedStorage } = await import('@/lib/storage');
                const list = (await modelRepository.get(providerName)) || [];
                const mapped = list.map((m:any)=> [m.name, inferStrategyFromModelId(m.name)] as const);
                const hits = mapped.filter(([, s]) => !!s) as Array<[string, StrategyValue]>;
                if (hits.length) {
                  await Promise.all(hits.map(([id, st]) => specializedStorage.models.setModelStrategy(providerName, id, st)));
                }
                await specializedStorage.models.removeProviderDefaultStrategy(providerName);
                onChange('openai-compatible');
                const skipped = list.length - (hits?.length || 0);
                toast.success(formatProviderModelStrategyUpdate(translateProviderModelNotification, hits.length, skipped));
              } else {
                onChange(val);
                const { specializedStorage } = await import('@/lib/storage');
                await specializedStorage.models.setProviderDefaultStrategy(providerName, val);
                toast.success(translateProviderModelNotification('provider.models.defaultStrategyUpdated'));
              }
            } catch (e) {
              console.error(e);
              toast.error(translateProviderModelNotification('provider.models.defaultStrategyFailed'));
            }
          }}
        >
          <SelectTrigger className="w-80 h-8 text-xs">
            <SelectValue placeholder={t('provider.models.chooseDefaultStrategy')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__" className="text-xs">{t('provider.models.inferStrategyById')}</SelectItem>
            {STRATEGY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">{t('provider.models.defaultStrategyHelp')}</p>
    </div>
  );
}


"use client";
import type { StrategyValue } from "@/lib/provider/strategyInference";
import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";

type Strategy = 'openai' | 'openai-responses' | 'openai-compatible' | 'anthropic' | 'gemini' | 'deepseek' | '__auto__';

const STRATEGY_OPTIONS: Array<{ value: Strategy; label: string }> = [
  { value: '__auto__', label: '自动推断策略（按模型ID）' },
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
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">默认请求策略</label>
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
                const { inferStrategyFromModelId } = require('@/lib/provider/strategyInference');
                const mapped = list.map((m:any)=> [m.name, inferStrategyFromModelId(m.name)] as const);
                const hits = mapped.filter(([, s]) => !!s) as Array<[string, StrategyValue]>;
                if (hits.length) {
                  await Promise.all(hits.map(([id, st]) => specializedStorage.models.setModelStrategy(providerName, id, st)));
                }
                await specializedStorage.models.removeProviderDefaultStrategy(providerName);
                onChange('openai-compatible');
                const skipped = list.length - (hits?.length || 0);
                toast.success(`已为 ${hits.length} 个模型自动设置策略${skipped? `，${skipped} 个未命中已跳过`: ''}`);
              } else {
                onChange(val);
                const { specializedStorage } = await import('@/lib/storage');
                await specializedStorage.models.setProviderDefaultStrategy(providerName, val);
                toast.success('已更新默认策略');
              }
            } catch (e) {
              console.error(e);
              toast.error('更新默认策略失败');
            }
          }}
        >
          <SelectTrigger className="w-80 h-8 text-xs">
            <SelectValue placeholder="选择默认请求策略" />
          </SelectTrigger>
          <SelectContent>
            {STRATEGY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">对于 New API 等聚合服务，默认策略会应用到未单独指定策略的模型上。</p>
    </div>
  );
}


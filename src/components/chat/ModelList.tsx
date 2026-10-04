"use client";

import React, { useState } from "react";
import { SelectItem, SelectGroup } from "@/components/ui/select";
import { ChevronRight } from "lucide-react";
import { ModelSelectItem } from "./ModelSelectItem";
import { Bot, Search } from "lucide-react";
import type { ProviderMetadata } from "@/lib/metadata/types";
import { cn } from "@/lib/utils";
import { ProviderGlyph } from "./ProviderGlyph";

interface ModelListProps {
  models: ProviderMetadata[];
  globalDefaultModel: string | null;
  currentModelId: string | null;
  currentSelection?: string | null;
  searchQuery: string;
  onSetDefault: (e: React.MouseEvent, providerName: string, modelName: string) => void;
  onOpenParameters?: (providerName: string, modelId: string, modelLabel?: string) => void;
}

export function ModelList({
  models,
  globalDefaultModel,
  currentModelId,
  currentSelection,
  searchQuery,
  onSetDefault,
  onOpenParameters,
}: ModelListProps) {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (currentSelection && currentSelection.includes("::")) {
      const providerName = currentSelection.split("::")[0];
      if (providerName) initial.add(providerName);
    } else if (currentModelId) {
      const provider = models.find((p) => p.models.some((m) => m.name === currentModelId));
      if (provider) initial.add(provider.name);
    }
    return initial;
  });

  React.useEffect(() => {
    if (!currentSelection || !currentSelection.includes("::")) return;
    const providerName = currentSelection.split("::")[0];
    if (!providerName) return;
    setExpandedProviders((prev) => {
      if (prev.has(providerName)) return prev;
      const next = new Set(prev);
      next.add(providerName);
      return next;
    });
  }, [currentSelection]);

  const toggleProvider = (name: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (models.length === 0) {
    return (
      <div className="py-6 text-center text-slate-500 dark:text-slate-400">
        {searchQuery ? (
          <>
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">未找到匹配的模型</p>
          </>
        ) : (
          <>
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">无可用模型数据</p>
          </>
        )}
      </div>
    );
  }

  const searching = searchQuery.trim().length > 0;

  return (
    <div className="flex flex-col gap-0.5">
      {models.map((provider) => {
        const expanded = searching || expandedProviders.has(provider.name);
        const providerLabel = (provider as { displayName?: string }).displayName || provider.name;
        return (
          <SelectGroup key={provider.name}>
            <button
              type="button"
              className="flex w-full items-center gap-2 h-8 px-2 rounded-md hover:bg-slate-100/80 dark:hover:bg-white/5 cursor-pointer"
              onClick={() => toggleProvider(provider.name)}
            >
              <ProviderGlyph provider={provider} size={16} />
              <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-slate-700 dark:text-slate-200">
                {providerLabel}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                {provider.models.length}
              </span>
              <ChevronRight
                className={cn(
                  "w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform",
                  expanded && "rotate-90"
                )}
              />
            </button>
            {expanded &&
              provider.models.map((model) => (
                <SelectItem
                  key={`${provider.name}::${model.name}`}
                  value={`${provider.name}::${model.name}`}
                  className="p-0 m-0 pr-7 rounded-md"
                >
                  <div className="pl-6 w-full">
                    <ModelSelectItem
                      provider={provider}
                      model={model}
                      isDefault={globalDefaultModel === `${provider.name}/${model.name}`}
                      isSelected={
                        currentSelection
                          ? currentSelection === `${provider.name}::${model.name}`
                          : currentModelId === model.name
                      }
                      onSetDefault={onSetDefault}
                      onOpenParameters={onOpenParameters}
                    />
                  </div>
                </SelectItem>
              ))}
          </SelectGroup>
        );
      })}
    </div>
  );
}

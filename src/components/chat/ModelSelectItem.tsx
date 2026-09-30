"use client";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProviderMetadata, ModelMetadata } from "@/lib/metadata/types";
import { ProviderGlyph } from "./ProviderGlyph";

interface ModelSelectItemProps {
  provider: ProviderMetadata;
  model: ModelMetadata;
  isDefault: boolean;
  isSelected: boolean;
  showProviderIcon?: boolean;
  onSetDefault: (e: React.MouseEvent, providerName: string, modelName: string) => void;
  onOpenParameters?: (providerName: string, modelId: string, modelLabel?: string) => void;
}

export function ModelSelectItem({
  provider,
  model,
  isSelected,
  showProviderIcon = false,
}: ModelSelectItemProps) {
  const label = model.label || model.name;
  const providerLabel = (provider as { displayName?: string }).displayName || provider.name;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1 min-h-7 cursor-pointer",
            isSelected
              ? "bg-slate-200/70 dark:bg-white/10"
              : "hover:bg-slate-100/80 dark:hover:bg-white/6"
          )}
        >
          {showProviderIcon && <ProviderGlyph provider={provider} size={14} />}
          <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-slate-700 dark:text-slate-200">
            {label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[420px] text-xs">
        <div className="space-y-0.5">
          <div><span className="text-slate-400 mr-1">ID</span>{model.name}</div>
          <div className="text-slate-400">{providerLabel}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

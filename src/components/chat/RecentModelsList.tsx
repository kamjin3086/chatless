"use client";

import { SelectItem } from "@/components/ui/select";
import { ModelSelectItem } from "./ModelSelectItem";
import { Clock } from "lucide-react";
import type { ProviderMetadata, ModelMetadata } from '@/lib/metadata/types';

interface RecentModelsListProps {
  recentModelDetails: { provider: ProviderMetadata, model: ModelMetadata }[];
  globalDefaultModel: string | null;
  currentModelId: string | null;
  onSetDefault: (e: React.MouseEvent, providerName: string, modelName: string) => void;
  onOpenParameters?: (providerName: string, modelId: string, modelLabel?: string) => void;
}

export function RecentModelsList({
  recentModelDetails,
  globalDefaultModel,
  currentModelId,
  onSetDefault,
  onOpenParameters,
}: RecentModelsListProps) {
  if (recentModelDetails.length === 0) {
    return (
      <div className="py-6 text-center text-gray-500 dark:text-gray-400">
        <Clock className="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p className="text-sm">暂无最近使用模型</p>
      </div>
    );
  }

  return (
    <>
      {recentModelDetails.map(({ provider, model }) => (
        <SelectItem key={`${provider.name}::${model.name}`} value={`${provider.name}::${model.name}`} className="p-0 m-0 pr-7 rounded-md">
          <ModelSelectItem
            provider={provider}
            model={model}
            isDefault={globalDefaultModel === `${provider.name}/${model.name}`}
            isSelected={currentModelId === model.name}
            showProviderIcon
            onSetDefault={onSetDefault}
            onOpenParameters={onOpenParameters}
          />
        </SelectItem>
      ))}
    </>
  );
} 
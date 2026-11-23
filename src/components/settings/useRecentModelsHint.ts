"use client";
import React from "react";
import { specializedStorage } from "@/lib/storage";
import { translate } from "@/i18n";
import { useLocaleStore } from "@/store/localeStore";

export function useRecentModelsHint(providerName: string) {
  const [lastUsedMap, setLastUsedMap] = React.useState<Record<string, string>>({});
  const locale = useLocaleStore((state) => state.locale);

  React.useEffect(() => {
    (async () => {
      try {
        await specializedStorage.models.getRecentModels();
        const pair = await specializedStorage.models.getLastSelectedModelPair();
        const map: Record<string, string> = {};
        if (pair && pair.provider === providerName) {
          map[pair.modelId] = translate(locale, 'modelChooser.recentlyUsedHint');
        }
        setLastUsedMap(map);
      } catch {}
    })();
  }, [providerName, locale]);

  return lastUsedMap;
}


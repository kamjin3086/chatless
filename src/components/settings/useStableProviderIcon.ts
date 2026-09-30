"use client";

import React from "react";
import { AVAILABLE_PROVIDERS_CATALOG } from "@/lib/provider/catalog";
import {
  getResolvedUrlForBase,
  isUrlKnownMissing,
  ensureLogoCacheReady,
  getAvatarSync,
  markResolvedBase,
  markUrlMissing,
} from "@/lib/utils/logoService";
import type { ProviderWithStatus } from "@/hooks/useProviderManagement";

/**
 * 稳定的 Provider 图标加载（无头像占位）：
 * - 命中缓存映射则直接使用真实图标
 * - 否则使用透明占位（不显示头像），后台预加载可用后缀，成功后仅切换一次
 * - 使用命中/失败缓存避免重复 404
 */
export function useStableProviderIcon(provider: ProviderWithStatus) {
  const iconStr = typeof provider.icon === "string" ? provider.icon : "";
  const iconIsData = !!(iconStr && iconStr.startsWith("data:image"));
  const iconIsCatalog = !!(iconStr && iconStr.startsWith("/llm-provider-icon/"));
  const exts = ["png", "svg", "webp", "jpeg", "jpg"] as const;

  const nameSlugBase = `/llm-provider-icon/${provider.name
    .toLowerCase()
    .replace(/\s+/g, "-")}`;
  const catalogDef = AVAILABLE_PROVIDERS_CATALOG.find((c) => c.name === provider.name);
  const catalogIdBase = catalogDef ? `/llm-provider-icon/${catalogDef.id}` : null;
  const iconBaseFromProp = iconIsCatalog ? iconStr.replace(/\.(svg|png|webp|jpeg|jpg)$/i, "") : null;
  const candidateBases = React.useMemo(
    () => [catalogIdBase, iconBaseFromProp, nameSlugBase].filter(Boolean) as string[],
    [catalogIdBase, iconBaseFromProp, nameSlugBase]
  );

  // 是否“有目录 logo 的高概率候选”：存在目录定义或传入即为目录路径
  const _likelyCatalog = !!catalogDef || iconIsCatalog;

  // 统一“头像优先”策略：初始使用头像（或 data:image 图标），后台预加载命中后替换一次
  const initialSrc = React.useMemo(() => {
    if (iconIsData) return iconStr;
    for (const base of candidateBases) {
      const mapped = getResolvedUrlForBase(base);
      if (mapped) return mapped;
    }
    // 自定义 Provider：使用更大的圆角头像，观感更自然
    return getAvatarSync(provider.name.toLowerCase(), provider.name, 24);
  }, [iconIsData, iconStr, candidateBases, provider.name]);
  const [displaySrc, setDisplaySrc] = React.useState<string>(initialSrc);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (iconIsData) return; // 已有 data:image，无需预加载
        await ensureLogoCacheReady();

        // 优先使用已解析映射（若初始没命中，二次确认防止竞态）
        for (const base of candidateBases) {
          const mapped = getResolvedUrlForBase(base);
          if (mapped) { if (!cancelled) setDisplaySrc(mapped); return; }
        }

        // 逐个尝试首个可用的真实图标
        for (const base of candidateBases) {
          const candidates = exts
            .map((ext) => `${base}.${ext}`)
            .filter((u) => !isUrlKnownMissing(u));
          for (const url of candidates) {
            const ok = await new Promise<boolean>((resolve) => {
              const img = new window.Image();
              img.onload = () => resolve(true);
              img.onerror = () => resolve(false);
              img.src = url;
            });
            if (ok) { markResolvedBase(base, url); if (!cancelled) setDisplaySrc(url); return; } else {
              markUrlMissing(url);
            }
          }
        }
      } catch {
        // 忽略预加载失败，保留头像
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [iconIsData, iconStr, candidateBases]);

  return { iconSrc: displaySrc } as const;
}



"use client";

import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { generateAvatarDataUrl } from "@/lib/avatar";
import { getResolvedUrlForBase } from "@/lib/utils/logoService";
import type { ProviderMetadata } from "@/lib/metadata/types";

function resolveProviderIcon(provider: ProviderMetadata, size: number): { primary: string; fallback: string } {
  const displayName = (provider as { displayName?: string }).displayName || provider.name;
  const fallback = generateAvatarDataUrl(provider.name.toLowerCase(), displayName, size);
  const icon = typeof provider.icon === "string" ? provider.icon : "";
  if (icon.startsWith("data:image")) return { primary: icon, fallback };
  if (icon.startsWith("/llm-provider-icon/")) {
    const base = icon.replace(/\.(svg|png|webp|jpeg|jpg)$/i, "");
    return { primary: getResolvedUrlForBase(base) || icon, fallback };
  }
  if (icon.startsWith("/")) return { primary: icon, fallback };
  return { primary: fallback, fallback };
}

export function ProviderGlyph({
  provider,
  size = 16,
  className,
}: {
  provider: ProviderMetadata;
  size?: number;
  className?: string;
}) {
  const { primary, fallback } = useMemo(
    () => resolveProviderIcon(provider, size),
    [provider, size]
  );
  const [src, setSrc] = useState(primary);

  useEffect(() => {
    setSrc(primary);
  }, [primary]);

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-sm object-contain", className)}
      onError={() => {
        if (src !== fallback) setSrc(fallback);
      }}
    />
  );
}

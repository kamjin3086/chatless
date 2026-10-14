"use client";
import React, { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { KeyRound, ExternalLink, CheckCircle2, XCircle, Loader2, AlertTriangle, Eye, EyeOff, Pencil } from "lucide-react";
import type { ProviderWithStatus } from "@/hooks/useProviderManagement";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { resolveConnectionHintStatus } from "@/lib/provider/connectionHintStatus";
import { formatConnectionCheckMessage } from "@/lib/provider/formatConnectionCheckMessage";

function ConnectionStatusHint({
  provider,
  isConnecting,
}: {
  provider: ProviderWithStatus;
  isConnecting?: boolean;
}) {
  const message = formatConnectionCheckMessage(
    provider.statusTooltip || provider.temporaryMessage || provider.lastMessage
  );
  const status = resolveConnectionHintStatus(!!isConnecting, provider);

  if (!status) return null;

  const styles: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
    CONNECTING: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      className: "text-slate-500 dark:text-slate-400",
      label: "检测中",
    },
    CONNECTED: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      className: "text-emerald-600 dark:text-emerald-400",
      label: "连接正常",
    },
    NOT_CONNECTED: {
      icon: <XCircle className="w-3 h-3" />,
      className: "text-red-600 dark:text-red-400",
      label: "无法连接",
    },
    NO_KEY: {
      icon: <KeyRound className="w-3 h-3" />,
      className: "text-slate-500 dark:text-slate-400",
      label: "未配置密钥",
    },
    NO_FETCHER: {
      icon: <AlertTriangle className="w-3 h-3" />,
      className: "text-slate-500 dark:text-slate-400",
      label: "无法拉取",
    },
  };

  const entry = styles[status];
  if (!entry) return null;

  const tip =
    message && message !== entry.label
      ? message
      : status === "NO_FETCHER"
        ? "无法拉取模型列表"
        : null;

  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs leading-none whitespace-nowrap",
        entry.className,
        tip && "cursor-default"
      )}
    >
      {entry.icon}
      {entry.label}
    </span>
  );

  if (!tip) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex min-w-0 max-w-full outline-none">
          {chip}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-xs">
        <p className="text-xs leading-relaxed">{tip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100/80 dark:hover:text-slate-300 dark:hover:bg-white/10 transition-colors"
    >
      {children}
    </button>
  );
}

function InlineEditableValue({
  value,
  onCommit,
  placeholder,
  emptyLabel,
  mono,
  secret,
  extra,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
  emptyLabel: string;
  mono?: boolean;
  secret?: boolean;
  extra?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [reveal, setReveal] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    onCommit(next);
    setEditing(false);
    setReveal(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    setReveal(false);
  };

  if (editing) {
    return (
      <div className="relative min-w-0">
        <input
          ref={inputRef}
          value={draft}
          type={secret && !reveal ? "password" : "text"}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className={cn(
            "w-full h-8 px-2.5 pr-8 rounded-md border border-slate-200/80 dark:border-slate-700/60 bg-white/90 dark:bg-slate-800/60 text-[13px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400/50",
            mono && "font-mono"
          )}
        />
        {secret && (
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-md"
            title={reveal ? "隐藏" : "显示"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    );
  }

  const hasValue = value.trim().length > 0;
  const shown = !hasValue
    ? emptyLabel
    : secret && !reveal
      ? "••••••••"
      : value;

  return (
    <div className="flex items-center gap-0.5 min-w-0 h-8">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "min-w-0 flex-1 text-left truncate text-[13px] leading-8",
          hasValue
            ? "text-slate-700 dark:text-slate-200"
            : "text-slate-400 dark:text-slate-500",
          mono && hasValue && "font-mono"
        )}
        title={hasValue && !secret ? value : undefined}
      >
        {shown}
      </button>
      <IconButton title="编辑" onClick={() => setEditing(true)}>
        <Pencil className="w-3.5 h-3.5" />
      </IconButton>
      {secret && hasValue && (
        <IconButton title={reveal ? "隐藏密钥" : "显示密钥"} onClick={() => setReveal((v) => !v)}>
          {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </IconButton>
      )}
      {extra}
    </div>
  );
}

interface ProviderConnectionSectionProps {
  provider: ProviderWithStatus;
  localUrl: string;
  setLocalUrl: (v: string) => void;
  onUrlChange: (providerName: string, url: string) => void;
  showApiKeyFields: boolean;
  localDefaultApiKey: string;
  setLocalDefaultApiKey: (v: string) => void;
  docUrl?: string;
  onDefaultApiKeyChange: (providerName: string, apiKey: string) => void;
  onDefaultApiKeyBlur: (providerName: string) => void;
  endpointPreview?: string;
  isConnecting?: boolean;
}

export function ProviderConnectionSection(props: ProviderConnectionSectionProps) {
  const {
    provider,
    localUrl,
    setLocalUrl,
    onUrlChange,
    showApiKeyFields,
    localDefaultApiKey,
    setLocalDefaultApiKey,
    docUrl,
    onDefaultApiKeyChange,
    onDefaultApiKeyBlur,
    endpointPreview,
    isConnecting,
  } = props;

  const repoName = provider.aliases?.[0] || provider.name;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("grid gap-x-5 gap-y-1", showApiKeyFields ? "grid-cols-2" : "grid-cols-1")}>
        <div className="flex h-5 items-center gap-2 min-w-0">
          <label className="shrink-0 whitespace-nowrap text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
            服务地址
          </label>
          <div className="ml-auto min-w-0 flex justify-end">
            <ConnectionStatusHint provider={provider} isConnecting={isConnecting} />
          </div>
        </div>

        {showApiKeyFields ? (
          <div className="flex h-5 items-center gap-2 min-w-0">
            <label className="shrink-0 whitespace-nowrap text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
              API 密钥
            </label>
            {docUrl && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { linkOpener } = await import("@/lib/utils/linkOpener");
                    const success = await linkOpener.openLink(docUrl);
                    if (!success) toast.error("无法打开链接，请稍后重试");
                  } catch (error) {
                    console.error("打开链接失败:", error);
                    toast.error("打开链接失败");
                  }
                }}
                className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                获取密钥
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        ) : null}

        <InlineEditableValue
          key={`${provider.name}-url`}
          value={localUrl}
          placeholder={provider.name.toLowerCase() === "ollama" ? "http://localhost:11434" : "https://…"}
          emptyLabel="未设置服务地址"
          mono
          onCommit={(next) => {
            setLocalUrl(next);
            onUrlChange(repoName, next);
          }}
          extra={
            endpointPreview ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100/80 dark:hover:text-slate-300 dark:hover:bg-white/10"
                    title="实际请求地址"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="max-w-md">
                  <p className="text-xs break-all">{endpointPreview}</p>
                </TooltipContent>
              </Tooltip>
            ) : null
          }
        />

        {showApiKeyFields ? (
          <InlineEditableValue
            key={`${provider.name}-key`}
            value={localDefaultApiKey}
            placeholder="可选，部分服务不需要"
            emptyLabel="未设置"
            secret
            onCommit={(next) => {
              setLocalDefaultApiKey(next);
              onDefaultApiKeyChange(repoName, next);
              onDefaultApiKeyBlur(repoName);
            }}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

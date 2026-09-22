"use client";

/**
 * 已启用能力标签条
 * 
 * 展示当前激活的能力，点击标签可弹出简约上拉进行切换
 * 每种能力有独特的颜色标识
 */

import { useState, useRef } from "react";
import { X, Database, Plug, Settings, Folder, ExternalLink, FileText } from "lucide-react";
import type { KnowledgeBase } from "@/lib/knowledgeService";
import { QuickSelectPopover, type QuickSelectOption } from "./QuickSelectPopover";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { FileOpener } from "@/lib/utils/fileOpener";

interface ActiveCapabilitiesBarProps {
  // Web Search
  webSearchEnabled?: boolean;
  webSearchProvider?: string;
  webSearchProviders?: QuickSelectOption[];
  onDisableWebSearch?: () => void;
  onSelectWebSearchProvider?: (id: string) => void;
  
  // Knowledge Base
  selectedKnowledgeBase?: KnowledgeBase | null;
  availableKnowledgeBases?: QuickSelectOption[];
  onRemoveKnowledgeBase?: () => void;
  onSelectKnowledgeBase?: (id: string) => void;
  
  // MCP Servers
  enabledMcpServers?: string[];
  onClickMcp?: () => void;
  
  // Session Parameters
  hasSessionParameters?: boolean;
  onClickSessionParameters?: () => void;

  // WorkDir
  workingDir?: string;
  /** True when @WorkDir is a directory the user attached (removable). */
  workingDirAttached?: boolean;
  onRemoveWorkingDir?: () => void;

  // Document attachment (input file)
  attachedDocument?: { name: string; fileSize?: number };
  onRemoveDocument?: () => void;
}

export function ActiveCapabilitiesBar({
  webSearchEnabled: _webSearchEnabled,
  webSearchProvider: _webSearchProvider,
  webSearchProviders: _webSearchProviders = [],
  onDisableWebSearch: _onDisableWebSearch,
  onSelectWebSearchProvider: _onSelectWebSearchProvider,
  selectedKnowledgeBase,
  availableKnowledgeBases = [],
  onRemoveKnowledgeBase,
  onSelectKnowledgeBase,
  enabledMcpServers = [],
  onClickMcp,
  hasSessionParameters,
  onClickSessionParameters,
  workingDir,
  workingDirAttached = false,
  onRemoveWorkingDir,
  attachedDocument,
  onRemoveDocument,
}: ActiveCapabilitiesBarProps) {
  // 上拉状态
  const [knowledgeBasePopoverOpen, setKnowledgeBasePopoverOpen] = useState(false);
  
  // 锚点元素
  const knowledgeBaseRef = useRef<HTMLButtonElement>(null);

  // 简化：状态栏仅展示“已附加内容”（不展示“已启用”文案与过多技术项）
  const hasAny =
    selectedKnowledgeBase ||
    enabledMcpServers.length > 0 ||
    hasSessionParameters ||
    !!workingDir ||
    !!attachedDocument;

  if (!hasAny) {
    return null;
  }

  // 标签基础样式
  const tagBase = "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-all duration-150 group";

  const basename = (p: string): string => {
    const s = String(p || "").replace(/\\/g, "/").replace(/\/+$/g, "");
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  };

  const openWorkingDir = async () => {
    if (!workingDir) return;
    try {
      await FileOpener.openDirectory(workingDir);
    } catch (e) {
      toast.error("打开目录失败", { description: String(e) });
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        {/* 网络搜索不在状态栏显示：入口在输入框按钮处 */}

        {/* 知识库标签 - 紫色系 */}
        {selectedKnowledgeBase && (
          <button
            ref={knowledgeBaseRef}
            onClick={() => setKnowledgeBasePopoverOpen(true)}
            className={cn(
              tagBase,
              "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400",
              "hover:bg-violet-100 dark:hover:bg-violet-900/50",
              "border border-violet-200/50 dark:border-violet-800/50"
            )}
          >
            <Database className="w-3 h-3" />
            <span className="max-w-[100px] truncate">{selectedKnowledgeBase.name}</span>
            <X
              className="w-3 h-3 opacity-40 group-hover:opacity-100 hover:text-violet-700 dark:hover:text-violet-300"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveKnowledgeBase?.();
              }}
            />
          </button>
        )}

        {/* 工作目录标签 - 绿色系 */}
        {workingDir && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void openWorkingDir();
            }}
            className={cn(
              tagBase,
              "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
              "hover:bg-emerald-100 dark:hover:bg-emerald-900/50",
              "border border-emerald-200/50 dark:border-emerald-800/50"
            )}
            title={workingDir}
          >
            <Folder className="w-3 h-3" />
            {/* 只显示文件夹名，悬浮显示完整路径 */}
            <span className="max-w-[160px] truncate">{basename(workingDir)}</span>
            <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-100" />
            {/* 会话自带的产物目录不能移除，只能打开；附加的用户目录才可以摘下。 */}
            {workingDirAttached && (
              <X
                className="w-3 h-3 opacity-40 group-hover:opacity-100 hover:text-emerald-700 dark:hover:text-emerald-300"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveWorkingDir?.();
                }}
              />
            )}
          </button>
        )}

        {/* 文档附加标签 - 橙色系 */}
        {attachedDocument?.name && (
          <button
            className={cn(
              tagBase,
              "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
              "hover:bg-amber-100 dark:hover:bg-amber-900/50",
              "border border-amber-200/50 dark:border-amber-800/50"
            )}
            title={attachedDocument.name}
          >
            <FileText className="w-3 h-3" />
            <span className="max-w-[140px] truncate">{attachedDocument.name}</span>
            <X
              className="w-3 h-3 opacity-40 group-hover:opacity-100 hover:text-amber-800 dark:hover:text-amber-200"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDocument?.();
              }}
            />
          </button>
        )}

        {/* MCP 标签 - 绿色系 */}
        {enabledMcpServers.length > 0 && (
          <button
            onClick={onClickMcp}
            className={cn(
              tagBase,
              "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
              "hover:bg-emerald-100 dark:hover:bg-emerald-900/50",
              "border border-emerald-200/50 dark:border-emerald-800/50"
            )}
          >
            <Plug className="w-3 h-3" />
            <span>MCP: {enabledMcpServers.length}</span>
          </button>
        )}

        {/* 会话参数标签 - 橙色系 */}
        {hasSessionParameters && (
          <button
            onClick={onClickSessionParameters}
            className={cn(
              tagBase,
              "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
              "hover:bg-amber-100 dark:hover:bg-amber-900/50",
              "border border-amber-200/50 dark:border-amber-800/50"
            )}
          >
            <Settings className="w-3 h-3" />
            <span>参数</span>
          </button>
        )}
      </div>

      {/* 网络搜索上拉选择：已移除（入口统一在输入框按钮/面板中） */}

      {/* 知识库上拉选择 */}
      <QuickSelectPopover
        open={knowledgeBasePopoverOpen}
        onOpenChange={setKnowledgeBasePopoverOpen}
        anchorEl={knowledgeBaseRef.current}
        options={availableKnowledgeBases}
        selectedId={selectedKnowledgeBase?.id}
        onSelect={(id) => onSelectKnowledgeBase?.(id)}
        title="切换知识库"
        emptyText="暂无知识库"
        accentColor="violet"
      />
    </>
  );
}

"use client";

/**
 * 附件菜单组件
 * 
 * 将图片、文档、知识库等附件相关操作收纳到一个菜单中
 * 每种附件类型有独特的颜色标识
 */

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Plus, Image, FileText, Database, Loader2, Check, ChevronLeft, Search, X, Sparkles, AtSign,
} from "lucide-react";
import { KnowledgeService, KnowledgeBase } from "@/lib/knowledgeService";
import { cn } from "@/lib/utils";
import { useLocaleStore } from '@/store/localeStore';
import { composerTriggers, type ComposerTrigger } from './composerTriggers';
import { AndroidAttachmentSheet, AndroidAttachmentSheetContent } from './AndroidAttachmentSheet';
import type { AndroidAttachmentSelections } from './androidAttachmentSelection';
import {
  ActionPanel,
  ActionPanelTrigger,
  ActionPanelContent,
  ActionPanelHeader,
  ActionPanelList,
  ActionPanelItem,
  ActionPanelDivider,
  ActionPanelEmpty,
} from "@/components/ui/action-panel";

interface AttachmentMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  isParsingDocument?: boolean;
  hasDocument?: boolean;
  selectedKnowledgeBase?: KnowledgeBase | null;
  onOpenComposerPanel: (trigger: ComposerTrigger) => void;
  onPickImage: () => void;
  onCapturePhoto?: () => void;
  photoActionsDisabled?: boolean;
  /** Android: the batch and folder pickers, with their disclosures, belong to this sheet. */
  androidAttachments?: AndroidAttachmentSelections;
  onPickDocument?: () => void;
  documentLabel?: string;
  documentDescription?: string;
  onSelectKnowledgeBase: (kb: KnowledgeBase | null) => void;
}

export function AttachmentMenu({
  open,
  onOpenChange: setOpen,
  disabled = false,
  isParsingDocument = false,
  hasDocument = false,
  selectedKnowledgeBase,
  onOpenComposerPanel,
  onPickImage,
  onCapturePhoto,
  photoActionsDisabled,
  androidAttachments,
  onPickDocument,
  documentLabel = "附加文档",
  documentDescription,
  onSelectKnowledgeBase,
}: AttachmentMenuProps) {
  const t = useLocaleStore((s) => s.t);
  useLocaleStore((s) => s.locale);
  const focusComposerOnClose = useRef(false);
  const [view, setView] = useState<"main" | "knowledge-base">("main");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loadingKb, setLoadingKb] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 加载知识库列表
  useEffect(() => {
    if (view === "knowledge-base" && knowledgeBases.length === 0) {
      setLoadingKb(true);
      KnowledgeService.getAllKnowledgeBases()
        .then(setKnowledgeBases)
        .catch(() => {})
        .finally(() => setLoadingKb(false));
    }
  }, [view, knowledgeBases.length]);

  // 关闭时重置视图
  useEffect(() => {
    if (!open) {
      setTimeout(() => setView("main"), 200);
      setSearchQuery("");
    }
  }, [open]);

  const handleAction = (action: () => void) => {
    action();
    setOpen(false);
  };

  const filteredKnowledgeBases = knowledgeBases.filter((kb) =>
    searchQuery
      ? kb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (kb.description?.toLowerCase().includes(searchQuery.toLowerCase()))
      : true
  );

  const hasAnyAttachment = hasDocument || selectedKnowledgeBase;

  // 主菜单视图
  const renderMainView = () => (
    <>
      <ActionPanelHeader
        title="附加内容"
        icon={<Plus className="w-4 h-4 text-slate-400" />}
      />

      <ActionPanelList maxHeight="min(20rem, 55vh)">
        {([
          { trigger: composerTriggers.skill, title: t('chatComposer.skills'), Icon: Sparkles },
          { trigger: composerTriggers.prompt, title: t('chatComposer.prompts'), Icon: FileText },
          { trigger: composerTriggers.mention, title: t('chatComposer.mentions'), Icon: AtSign },
        ] as const).map(({ trigger, title, Icon }) => (
          <ActionPanelItem
            key={trigger}
            icon={<Icon className="size-4 text-slate-600 dark:text-slate-300" />}
            title={title}
            suffix={<kbd className="rounded border border-border px-1.5 text-xs text-muted-foreground">{trigger}</kbd>}
            onClick={() => {
              focusComposerOnClose.current = true;
              handleAction(() => onOpenComposerPanel(trigger));
            }}
          />
        ))}
        <ActionPanelDivider />
        <ActionPanelItem
          icon={<Image className="w-4 h-4 text-pink-500" />}
          title={'上传图片'}
          description={'JPG, PNG, GIF, WebP'}
          disabled={photoActionsDisabled}
          onClick={() => handleAction(onPickImage)}
        />

        {/* 文档 - 橙色系 */}
        {onPickDocument && (
          <ActionPanelItem
            icon={<FileText className={cn("w-4 h-4", hasDocument ? "text-amber-500" : "text-amber-400")} />}
            title={documentLabel}
            description={documentDescription ?? (hasDocument ? "已附加文档" : "PDF, Word, Markdown 等")}
            disabled={hasDocument}
            selected={hasDocument}
            onClick={() => handleAction(onPickDocument)}
          />
        )}

        <ActionPanelDivider />

        {/* 知识库 - 紫色系 */}
        <ActionPanelItem
          icon={<Database className={cn("w-4 h-4", selectedKnowledgeBase ? "text-violet-500" : "text-violet-400")} />}
          title={selectedKnowledgeBase ? `知识库: ${selectedKnowledgeBase.name}` : "选择知识库"}
          description={selectedKnowledgeBase ? "点击更换或移除" : "基于知识库内容回答"}
          selected={!!selectedKnowledgeBase}
          onClick={() => setView("knowledge-base")}
        />
      </ActionPanelList>
    </>
  );

  // 知识库选择视图
  const renderKnowledgeBaseView = () => (
    <>
      <ActionPanelHeader
        title="选择知识库"
        icon={
          <button
            onClick={() => setView("main")}
            className="p-0.5 -ml-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <ChevronLeft className="w-4 h-4 text-slate-500" />
          </button>
        }
        action={
          selectedKnowledgeBase ? (
            <button
              onClick={() => {
                onSelectKnowledgeBase(null);
                setOpen(false);
              }}
              className="text-[11px] text-rose-500 hover:text-rose-600 transition-colors"
            >
              移除
            </button>
          ) : null
        }
      />

      {/* 搜索框 */}
      <div className="px-2 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索知识库..."
            className="w-full pl-8 pr-8 py-2 text-sm bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>
      </div>

      <ActionPanelList maxHeight="12rem">
        {loadingKb ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          </div>
        ) : filteredKnowledgeBases.length > 0 ? (
          filteredKnowledgeBases.map((kb) => (
            <ActionPanelItem
              key={kb.id}
              icon={<Database className="w-4 h-4 text-violet-500" />}
              title={kb.name}
              description={kb.description?.replace(/\\n|\n/g, " ").slice(0, 50) || "暂无描述"}
              selected={selectedKnowledgeBase?.id === kb.id}
              suffix={selectedKnowledgeBase?.id === kb.id ? <Check className="w-4 h-4 text-violet-500" /> : null}
              onClick={() => {
                onSelectKnowledgeBase(kb);
                setOpen(false);
              }}
            />
          ))
        ) : (
          <ActionPanelEmpty
            icon={<Database className="w-6 h-6 text-slate-300" />}
            title="没有找到知识库"
            description={searchQuery ? "尝试其他关键词" : "暂无可用的知识库"}
          />
        )}
      </ActionPanelList>
    </>
  );

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      className={cn(
        "composer-tool h-8 w-8 shrink-0 rounded-md border-0 bg-transparent shadow-none hover:bg-transparent dark:hover:bg-transparent",
        hasAnyAttachment
          ? "glass-chip-ok"
          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      )}
      title="附加内容"
    >
      {isParsingDocument ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Plus className="w-4 h-4" />
      )}
    </Button>
  );

  // Android gets a bottom sheet of the pickers this build can actually run; the desktop
  // popover below keeps its entries, chevron view and behaviour untouched.
  if (androidAttachments) {
    return (
      <AndroidAttachmentSheet
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
        title={t('androidAttachmentSheet.title')}
      >
        <AndroidAttachmentSheetContent
          selections={androidAttachments}
          document={
            onPickDocument
              ? {
                  label: documentLabel,
                  description: documentDescription,
                  attached: hasDocument,
                  onPick: onPickDocument,
                }
              : undefined
          }
          photoActionsDisabled={photoActionsDisabled}
          onCapturePhoto={onCapturePhoto}
          onPickPhoto={onPickImage}
          onAction={handleAction}
        />
      </AndroidAttachmentSheet>
    );
  }

  return (
    <ActionPanel open={open} onOpenChange={setOpen}>
      <ActionPanelTrigger>{trigger}</ActionPanelTrigger>

      <ActionPanelContent
        width="md"
        maxHeight="23rem"
        onCloseAutoFocus={(event) => {
          if (!focusComposerOnClose.current) return;
          focusComposerOnClose.current = false;
          event.preventDefault();
        }}
      >
        {view === "main" ? renderMainView() : renderKnowledgeBaseView()}
      </ActionPanelContent>
    </ActionPanel>
  );
}

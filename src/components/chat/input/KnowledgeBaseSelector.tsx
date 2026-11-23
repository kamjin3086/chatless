"use client";

/**
 * 知识库选择器组件
 * 
 * ## 重构说明
 * 
 * 使用统一的 ActionPanel 组件实现 Popover 样式，
 * 保持与其他面板的样式一致性。
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Database, Check } from "lucide-react";
import { KnowledgeService, KnowledgeBase } from "@/lib/knowledgeService";
import { cn } from "@/lib/utils";
import {
  ActionPanel,
  ActionPanelTrigger,
  ActionPanelContent,
  ActionPanelHeader,
  ActionPanelSearch,
  ActionPanelList,
  ActionPanelItem,
  ActionPanelEmpty,
} from "@/components/ui/action-panel";
import { useTranslation } from "@/i18n/useTranslation";

interface KnowledgeBaseSelectorProps {
  onSelect: (knowledgeBase: KnowledgeBase) => void;
  selectedKnowledgeBase: KnowledgeBase | null;
}

export function KnowledgeBaseSelector({
  onSelect,
  selectedKnowledgeBase,
}: KnowledgeBaseSelectorProps) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadKnowledgeBases = async () => {
    setLoading(true);
    try {
      const kbs = await KnowledgeService.getAllKnowledgeBases();
      setKnowledgeBases(kbs);
    } catch (error) {
      console.error("加载知识库列表失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadKnowledgeBases();
    }
  }, [open]);

  const filteredKnowledgeBases = knowledgeBases.filter((kb) =>
    searchQuery
      ? kb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (kb.description &&
          kb.description.toLowerCase().includes(searchQuery.toLowerCase()))
      : true
  );

  const handleSelect = (kb: KnowledgeBase) => {
    onSelect(kb);
    setOpen(false);
    setSearchQuery("");
  };

  const handleClear = () => {
    setSearchQuery("");
  };

  return (
    <ActionPanel open={open} onOpenChange={setOpen}>
      <ActionPanelTrigger>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "composer-tool h-8 w-8 rounded-md shrink-0 border-0 bg-transparent shadow-none hover:bg-transparent dark:hover:bg-transparent",
            selectedKnowledgeBase
              ? "glass-chip-knowledge"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          )}
          title={selectedKnowledgeBase ? t('chatAttachment.changeKnowledgeBase') : t('chatAttachment.chooseKnowledgeBase')}
        >
          <Database className="w-4 h-4" />
        </Button>
      </ActionPanelTrigger>

      <ActionPanelContent width="lg" maxHeight="24rem">
        <ActionPanelHeader
          title={t('chatAttachment.chooseKnowledgeBase')}
          subtitle={t('chatAttachment.answerFromSelectedKnowledgeBase')}
          icon={<Database className="w-4 h-4 text-slate-500" />}
        />

        <ActionPanelSearch
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={handleClear}
          placeholder={t('chatAttachment.searchKnowledgeBases')}
        />

        <ActionPanelList maxHeight="14rem">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : filteredKnowledgeBases.length > 0 ? (
            filteredKnowledgeBases.map((kb) => (
              <KnowledgeBaseItem
                key={kb.id}
                kb={kb}
                isSelected={selectedKnowledgeBase?.id === kb.id}
                onSelect={() => handleSelect(kb)}
              />
            ))
          ) : (
            <ActionPanelEmpty
              icon={<Database className="w-8 h-8" />}
              title={t('chatAttachment.noMatchingKnowledgeBases')}
              description={
                searchQuery ? t('chatAttachment.tryOtherKeywordsSearch') : t('chatAttachment.noKnowledgeBases')
              }
            />
          )}
        </ActionPanelList>
      </ActionPanelContent>
    </ActionPanel>
  );
}

// 知识库列表项
interface KnowledgeBaseItemProps {
  kb: KnowledgeBase;
  isSelected: boolean;
  onSelect: () => void;
}

function KnowledgeBaseItem({
  kb,
  isSelected,
  onSelect,
}: KnowledgeBaseItemProps) {
  const t = useTranslation();
  // 清理描述文本
  const cleanDescription = kb.description
    ? kb.description
        .replace(/\\n|\n|\r|\\r|\t|\\t/g, " ")
        .replace(/\s{2,}/g, " ")
    : t('chatAttachment.noKnowledgeBaseDescription');

  return (
    <ActionPanelItem
      icon={
        <Database
          className={cn(
            "w-4 h-4",
            isSelected
              ? "text-slate-600 dark:text-slate-300"
              : "text-slate-500 dark:text-slate-400"
          )}
        />
      }
      title={kb.name}
      description={cleanDescription}
      selected={isSelected}
      suffix={
        isSelected ? (
          <Check className="w-4 h-4 text-slate-600 dark:text-slate-300" />
        ) : null
      }
      onClick={onSelect}
    />
  );
}

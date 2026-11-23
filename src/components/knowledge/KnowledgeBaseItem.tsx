"use client";

import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KnowledgeBase } from "@/lib/knowledgeService";
import { ContextMenu } from '@/components/ui/context-menu';
import { useTranslation } from "@/i18n/useTranslation";

interface KnowledgeBaseItemProps {
  kb: KnowledgeBase & { documentCount?: number };
  isActive: boolean;
  onClick: (id: string) => void;
  onRename?: (kb: KnowledgeBase) => void;
  onDelete?: (kb: KnowledgeBase) => void;
}

export function KnowledgeBaseItem({ kb, isActive, onClick, onRename, onDelete }: KnowledgeBaseItemProps) {
  const t = useTranslation();
  const desc = (kb.description || "").replace(/(\\n|\\r|\\t)/g, " ").replace(/(\r?\n|\r)/g, " ").trim();

  const menuItems = [
    {
      id: 'rename',
      text: t('knowledge.rename'),
      action: () => onRename?.(kb)
    },
    { id: 'separator', text: '', separator: true },
    {
      id: 'delete',
      text: t('knowledge.delete'),
      action: () => onDelete?.(kb)
    }
  ];

  return (
    <ContextMenu menuItems={menuItems}>
      <button
        onClick={() => onClick(kb.id)}
        className={cn(
          "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors overflow-hidden",
          isActive
            ? "bg-slate-100 dark:bg-slate-800/50"
            : "hover:bg-slate-50 dark:hover:bg-slate-800/20"
        )}
      >
        {/* 激活状态的强调条 */}
        {isActive && (
          <div className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-blue-500" />
        )}

        <BrainCircuit className="h-5 w-5 shrink-0 text-slate-500" />
        <div className="flex-1 overflow-hidden">
          <p className="truncate font-medium">{kb.name}</p>
          <p className="truncate text-xs text-slate-400 max-w-full">
            {desc || t('knowledge.noDescription')}
          </p>
        </div>
      </button>
    </ContextMenu>
  );
} 
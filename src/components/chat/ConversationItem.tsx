"use client";

import React, { useMemo } from 'react';
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextMenu, createConversationMenuItems } from "@/components/ui/context-menu";
import { Flag, Star } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";
import { useProviderMetaStore } from '@/store/providerMetaStore';
import type { ProviderMetadata } from '@/lib/metadata/types';

interface ConversationItemProps {
  conversation: Conversation;
  isCurrent: boolean;
  isRenaming: boolean;
  renameInputValue: string;
  onSelect: (id: string) => void;
  onRenameStart: (e: React.MouseEvent, conv: Conversation) => void;
  onTitleClick: (e: React.MouseEvent, conv: Conversation) => void;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameBlur: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onDelete: (e: React.MouseEvent, conv: Conversation) => void;
  onStar: (id: string) => void;
  onToggleImportant: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
}

function ConversationItemImpl({
  conversation,
  isCurrent,
  isRenaming,
  renameInputValue,
  onSelect,
  onRenameStart,
  onTitleClick,
  onRenameChange,
  onRenameSubmit: _onRenameSubmit,
  onRenameBlur,
  onRenameKeyDown,
  onDelete,
  onStar,
  onToggleImportant,
  onDuplicate,
  onExport,
}: ConversationItemProps) {
  // 使用固定的时间戳数字作为依赖，避免对象引用变化导致的重新计算
  // 但在格式化时仍然使用Date对象
  const updatedAtTimestamp = new Date(conversation.updated_at).getTime();
  
  const compactTime = useMemo(() => {
    // formatDistanceToNow需要Date对象，而不是时间戳数字
    const formattedTime = formatDistanceToNow(new Date(updatedAtTimestamp), {
      addSuffix: true,
      locale: zhCN,
    });
    return formattedTime.replace(/^大约\s*/, '约 ');
  }, [updatedAtTimestamp]);

  return (
    <ContextMenu
      menuItems={createConversationMenuItems(
        conversation.id,
        conversation.is_important,
        (conversation as any).is_favorite,
        (_id) => onRenameStart({ stopPropagation: () => {} } as React.MouseEvent, conversation),
        (_id) => onDelete({ stopPropagation: () => {} } as React.MouseEvent, conversation),
        onStar,
        onToggleImportant,
        onDuplicate,
        onExport
      )}
    >
      <li
        className={cn(
          "group relative flex flex-col gap-0.5 px-2 py-1.5 rounded-md transition-colors duration-150 cursor-pointer",
          isCurrent
            ? "text-blue-600 dark:text-blue-400 bg-blue-50/70 dark:bg-blue-900/20"
            : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 hover:text-slate-900 dark:hover:text-slate-200"
        )}
        onClick={() => onSelect(conversation.id)}
      >
        {/* 活动强调条 - 简化设计 */}
        {isCurrent && (
          <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-blue-500 dark:bg-blue-400 rounded-r-full" />
        )}
        <div className="flex items-center gap-1.5 min-w-0 ml-1.5">
          {isRenaming ? (
            <Input
              value={renameInputValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameBlur}
              onKeyDown={onRenameKeyDown}
              className="h-6 px-2 py-0 text-[13px] bg-white dark:bg-slate-800 rounded-lg border-blue-400/60"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 w-full">
              {(conversation.is_important || (conversation as any).is_favorite) && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {conversation.is_important && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Flag className="w-3 h-3 text-red-500 dark:text-red-400 fill-current" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>重要对话</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {(conversation as any).is_favorite && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Star className="w-3 h-3 text-yellow-500 dark:text-yellow-400 fill-current" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>已收藏</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
              <div
                className="flex-1 text-[13px] font-medium truncate cursor-pointer leading-tight"
                onClick={(e) => onTitleClick(e, conversation)}
                onDoubleClick={(e) => onRenameStart(e, conversation)}
              >
                {conversation.title}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-xs mt-0.5 ml-1.5 min-h-[14px]">
          <div className="flex-1 min-w-0 flex items-center gap-1.5 pr-1">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{compactTime}</span>
            {/* 模型名：使用opacity控制显示，min-h保证高度不跳动 */}
            <span className="text-slate-300 dark:text-slate-600 transition-opacity duration-200 group-hover:opacity-100 opacity-0 pointer-events-none">·</span>
            <div className="flex items-center transition-opacity duration-200 group-hover:opacity-100 opacity-0 pointer-events-none">
              <ModelLabelSpan conversation={conversation} />
            </div>
          </div>
        </div>
      </li>
    </ContextMenu>
  );
}

function ModelLabelSpan({ conversation }: { conversation: Conversation }) {
  const metadata = useProviderMetaStore((s)=> s.list as unknown as ProviderMetadata[]);
  const maps = useMemo(() => {
    const byModel = new Map<string, string>();
    const byProvModel = new Map<string, string>();
    for (const p of (metadata || [])) {
      const provName = (p as any).name as string;
      const models = (p as any).models || [];
      for (const m of models) {
        const id = m?.name as string;
        const label = (m?.label as string) || '';
        if (id && label) {
          if (!byModel.has(id)) byModel.set(id, label);
          byProvModel.set(`${provName}::${id}`, label);
        }
      }
    }
    return { byModel, byProvModel };
  }, [metadata]);

  const prov = (conversation as any).model_provider as string | undefined;
  const id = conversation.model_id;
  const key = prov ? `${prov}::${id}` : '';
  const label = (prov && maps.byProvModel.get(key)) || maps.byModel.get(id);
  const display = label || conversation.model_id;
  return (
    <span
      className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis truncate max-w-[10rem] sm:max-w-[12rem]"
      title={(conversation as any).model_full_id || conversation.model_id}
    >
      {display}
    </span>
  );
}

// 防止列表滚动时的重复渲染：仅在关键属性变更时更新
export const ConversationItem = React.memo(ConversationItemImpl, (prev, next) => {
  const a = prev.conversation;
  const b = next.conversation;
  const sameConv = a.id === b.id
    && a.title === b.title
    && a.updated_at === b.updated_at
    && a.model_id === b.model_id
    && (a as any).model_provider === (b as any).model_provider
    && (a as any).is_favorite === (b as any).is_favorite
    && a.is_important === b.is_important;
  return (
    sameConv
    && prev.isCurrent === next.isCurrent
    && prev.isRenaming === next.isRenaming
    && prev.renameInputValue === next.renameInputValue
  );
});
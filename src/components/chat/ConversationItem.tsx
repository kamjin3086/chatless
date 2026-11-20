"use client";

import React, { useMemo } from 'react';
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextMenu, createConversationMenuItems } from "@/components/ui/context-menu";
import { Star } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import type { Locale } from '@/i18n/types';
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";

interface ConversationItemProps {
  conversation: Conversation;
  locale: Locale;
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
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  archiveLabel: string;
  onArchive: () => void;
}

function ConversationItemImpl({
  conversation,
  locale,
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
  onDuplicate,
  onExport,
  archiveLabel,
  onArchive,
}: ConversationItemProps) {
  // 使用固定的时间戳数字作为依赖，避免对象引用变化导致的重新计算
  // 但在格式化时仍然使用Date对象
  const updatedAtTimestamp = new Date(conversation.updated_at).getTime();
  
  const compactTime = useMemo(() => {
    if (!Number.isFinite(updatedAtTimestamp)) return '';
    const formattedTime = formatDistanceToNow(new Date(updatedAtTimestamp), {
      addSuffix: true,
      locale: locale === 'zh' ? zhCN : enUS,
    });
    return locale === 'zh' ? formattedTime.replace(/^大约\s*/, '约 ') : formattedTime;
  }, [updatedAtTimestamp, locale]);

  return (
    <ContextMenu
      menuItems={createConversationMenuItems(
        conversation.id,
        (conversation as any).is_favorite,
        (_id) => onRenameStart({ stopPropagation: () => {} } as React.MouseEvent, conversation),
        (_id) => onDelete({ stopPropagation: () => {} } as React.MouseEvent, conversation),
        onStar,
        onDuplicate,
        onExport,
        { text: archiveLabel, action: onArchive },
      )}
    >
      <li
        className={cn(
          "group relative flex min-h-9 min-w-0 items-center rounded-md px-2 py-1.5 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600 dark:focus-visible:outline-sky-400 motion-reduce:transition-none",
          isCurrent
            ? "bg-sky-600/10 text-slate-950 dark:bg-sky-400/12 dark:text-slate-50"
            : "text-slate-800 hover:bg-slate-500/[0.07] dark:text-slate-200 dark:hover:bg-white/[0.07]"
        )}
        tabIndex={isRenaming ? -1 : 0}
        aria-current={isCurrent ? 'true' : undefined}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onSelect(conversation.id);
        }}
        onClick={() => onSelect(conversation.id)}
      >
        {/* Keep the selection marker visible in addition to the row fill. */}
        {isCurrent && (
          <div className="absolute left-0 top-2 bottom-2 w-px bg-sky-600 dark:bg-sky-400 rounded-r-full" />
        )}
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
          {isRenaming ? (
            <Input
              value={renameInputValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameBlur}
              onKeyDown={onRenameKeyDown}
              className="inline-edit h-6 w-full min-w-0 px-0 py-0 text-sm bg-transparent border-0 border-b border-slate-300/60 dark:border-slate-600/50 rounded-none shadow-none focus-visible:ring-0"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 w-full">
              {(conversation as any).is_favorite && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Star className="w-3 h-3 text-yellow-500 dark:text-yellow-400 fill-current" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>已收藏</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
              <div
                className={cn('min-w-0 flex-1 truncate text-sm leading-5', isCurrent ? 'font-semibold' : 'font-medium')}
                title={[conversation.title, conversation.model_full_id || conversation.model_id].filter(Boolean).join('\n')}
                onClick={(e) => onTitleClick(e, conversation)}
                onDoubleClick={(e) => onRenameStart(e, conversation)}
              >
                {conversation.title}
              </div>
              {compactTime && (
                <span className="pointer-events-none hidden max-w-[50%] shrink-0 truncate text-xs leading-5 text-slate-600 group-hover:block group-focus-visible:block dark:text-slate-300">
                  {compactTime}
                </span>
              )}
            </div>
          )}
        </div>
      </li>
    </ContextMenu>
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
    && a.model_full_id === b.model_full_id
    && (a as any).model_provider === (b as any).model_provider
    && (a as any).is_favorite === (b as any).is_favorite;
  return (
    sameConv
    && prev.locale === next.locale
    && prev.archiveLabel === next.archiveLabel
    && prev.isCurrent === next.isCurrent
    && prev.isRenaming === next.isRenaming
    && prev.renameInputValue === next.renameInputValue
  );
});

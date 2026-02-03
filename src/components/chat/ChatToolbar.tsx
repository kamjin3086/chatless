"use client";

import React, { useState } from 'react';
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  ArrowUpIcon,
  ArrowDownIcon,
  LocateFixed
} from 'lucide-react';
import { MessageNavigationMenu } from './MessageNavigationMenu';
import type { Message } from '@/types/chat';

interface ChatToolbarProps {
  messages: Message[];
  onNavigateToMessage: (messageId: string) => void;
  onScrollToTop: () => void;
  onScrollToBottom: () => void;
  className?: string;
}

export function ChatToolbar({ 
  messages, 
  onNavigateToMessage,
  onScrollToTop,
  onScrollToBottom,
  className 
}: ChatToolbarProps) {
  const [showMessageList, setShowMessageList] = useState(false);

  if (messages.length < 2) {
    return null;
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex items-center gap-px text-slate-500 dark:text-slate-400",
          className
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onScrollToTop}
              className="h-5 w-5 flex items-center justify-center hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title="顶部"
            >
              <ArrowUpIcon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs px-2 py-1">
            <p>顶部</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onScrollToBottom}
              className="h-5 w-5 flex items-center justify-center hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title="底部"
            >
              <ArrowDownIcon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs px-2 py-1">
            <p>底部</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu open={showMessageList} onOpenChange={setShowMessageList}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-5 w-5 flex items-center justify-center hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  title="定位"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs px-2 py-1">
              <p>定位</p>
            </TooltipContent>
          </Tooltip>
          
          <MessageNavigationMenu 
            messages={messages}
            onNavigateToMessage={onNavigateToMessage}
            onClose={() => setShowMessageList(false)}
          />
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
} 
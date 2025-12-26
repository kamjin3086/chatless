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
import { Button } from "@/components/ui/button";
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
          "flex items-center gap-0.5 px-0.5 bg-white/40 dark:bg-slate-800/40 backdrop-blur-sm rounded-full border border-gray-200/30 dark:border-gray-600/30",
          className
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onScrollToTop}
              className="h-6 w-6 p-0 opacity-60 hover:opacity-80 dark:opacity-50 hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
            >
              <ArrowUpIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>滚动到顶部</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onScrollToBottom}
              className="h-6 w-6 p-0 opacity-60 hover:opacity-80 dark:opacity-50 hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
            >
              <ArrowDownIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>滚动到底部</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu open={showMessageList} onOpenChange={setShowMessageList}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-60 hover:opacity-80 dark:opacity-50 hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
                >
                  <LocateFixed className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>消息列表</p>
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
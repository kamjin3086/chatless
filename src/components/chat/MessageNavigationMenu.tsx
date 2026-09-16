"use client";

import React, { useState, useMemo } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  UserIcon, 
  BotIcon,
  FilterIcon,
  SearchIcon,
  ClockIcon
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import type { Message } from '@/types/chat';

interface MessageNavigationMenuProps {
  messages: Message[];
  onNavigateToMessage: (messageId: string) => void;
  onClose: () => void;
}

const getMessagePreview = (content: string, maxLength = 60) => {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + '...';
};

const highlightSearchTerm = (text: string, query: string) => {
  if (!query.trim()) return text;
  
  const regex = new RegExp(`(${query})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, index) => 
    regex.test(part) ? (
      <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">
        {part}
      </mark>
    ) : part
  );
};

export function MessageNavigationMenu({ messages, onNavigateToMessage, onClose }: MessageNavigationMenuProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'user' | 'assistant'>('all');

  const filteredMessages = useMemo(() => {
    let filtered = messages;

    if (filterType !== 'all') {
      filtered = filtered.filter(msg => msg.role === filterType);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(msg => 
        msg.content.toLowerCase().includes(query)
      );
    }

    return filtered.map((msg, index) => ({
      ...msg,
      originalIndex: messages.findIndex(m => m.id === msg.id)
    }));
  }, [messages, searchQuery, filterType]);

  return (
    <DropdownMenuContent 
      className="w-80 max-h-96 overflow-hidden flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200"
      side="top"
      align="start"
      onCloseAutoFocus={(e) => e.preventDefault()}
    >
      <DropdownMenuLabel className="text-sm text-slate-800 dark:text-slate-100">
        <div className="flex items-center justify-between">
          <span>消息导航 ({messages.length}条)</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <FilterIcon className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="left">
              <DropdownMenuItem onClick={() => setFilterType('all')}>
                <span className={filterType === 'all' ? 'font-bold' : ''}>全部</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilterType('user')}>
                <UserIcon className="w-3 h-3 mr-2" />
                <span className={filterType === 'user' ? 'font-bold' : ''}>用户</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilterType('assistant')}>
                <BotIcon className="w-3 h-3 mr-2" />
                <span className={filterType === 'assistant' ? 'font-bold' : ''}>AI</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DropdownMenuLabel>
      
      <div className="p-2">
        <div className="relative">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground dark:text-gray-400" />
          <Input
            placeholder="搜索消息内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>

      <DropdownMenuSeparator />

      <div className="flex-1 overflow-y-auto">
        {filteredMessages.length > 0 ? (
          filteredMessages.map((message) => (
            <DropdownMenuItem
              key={message.id}
              onClick={() => {
                onNavigateToMessage(message.id);
                onClose();
              }}
              className="flex flex-col items-start p-3 cursor-pointer"
            >
              <div className="flex items-center gap-2 w-full mb-1">
                {message.role === 'user' ? (
                  <UserIcon className="w-3 h-3 text-blue-500 flex-shrink-0" />
                ) : (
                  <BotIcon className="w-3 h-3 text-green-500 flex-shrink-0" />
                )}
                <span className="text-xs font-medium">
                  {message.role === 'user' ? '用户' : 'AI助手'}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  #{message.originalIndex + 1}
                </span>
              </div>
              
              <div className="text-sm w-full text-left text-muted-foreground dark:text-gray-400">
                {highlightSearchTerm(
                  getMessagePreview(message.content), 
                  searchQuery
                )}
              </div>
              <div className="flex items-center gap-1.5 w-full mt-2 text-xs text-muted-foreground/80">
                <ClockIcon className="w-3 h-3" />
                <span>
                  {formatDistanceToNow(message.created_at, { addSuffix: true, locale: zhCN })}
                </span>
              </div>
            </DropdownMenuItem>
          ))
        ) : (
          <div className="text-center py-4 text-sm text-muted-foreground">
            <p>无匹配消息</p>
          </div>
        )}
      </div>
    </DropdownMenuContent>
  );
} 
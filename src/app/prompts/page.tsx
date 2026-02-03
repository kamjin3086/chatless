'use client';

import { PromptsHeader } from "@/components/prompts/PromptsHeader";
import { PromptList } from "@/components/prompts/PromptList";
import { PromptsEmptyState } from "@/components/prompts/PromptsEmptyState";
import { RecentUsedList } from "@/components/ui/RecentUsedList";
import { usePromptStore } from "@/store/promptStore";
import { useChatStore } from "@/store/chatStore";
import { useEffect, useMemo } from "react";
import { filterAndSortPrompts } from "@/lib/prompt/search";
import { toast } from "@/components/ui/sonner";
import { useRouter } from "next/navigation";

export default function PromptsPage() {
  const prompts = usePromptStore((s) => s.prompts);
  const ui = usePromptStore((s) => s.ui);
  const loadFromDatabase = usePromptStore((s) => s.loadFromDatabase);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const router = useRouter();

  useEffect(() => {
    loadFromDatabase().catch(() => {});
  }, [loadFromDatabase]);

  // 筛选后的提示词列表
  const mapped = useMemo(() => {
    const filtered = filterAndSortPrompts(prompts, { 
      query: ui?.searchQuery, 
      favoriteOnly: ui?.favoriteOnly, 
      tag: ui?.tagFilter || undefined, 
      sortBy: ui?.sortBy || 'recent' 
    });
    return filtered.map((p) => ({
      id: p.id,
      title: p.name,
      description: p.description || '',
      content: p.content,
      tags: p.tags || [],
      shortcuts: p.shortcuts || [],
      usageCount: p.stats?.uses || 0,
      lastUpdated: new Date(p.updatedAt).toLocaleString(),
      isFavorite: !!p.favorite,
    }));
  }, [prompts, ui]);

  // 最近使用的提示词（按使用时间排序，取前5个）
  const recentlyUsed = useMemo(() => {
    return prompts
      .filter(p => p.stats?.lastUsedAt)
      .sort((a, b) => (b.stats?.lastUsedAt || 0) - (a.stats?.lastUsedAt || 0))
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        name: p.name,
        iconType: 'prompt',
        subtitle: p.tags?.slice(0, 2).join(', ') || '',
        time: p.stats?.lastUsedAt ? new Date(p.stats.lastUsedAt).toLocaleDateString() : '',
      }));
  }, [prompts]);

  // 应用提示词到当前对话
  const handleApplyPrompt = (id: string) => {
    if (!currentConversationId) {
      toast.info('请先选择一个对话');
      router.push('/chat');
      return;
    }
    updateConversation(currentConversationId, { 
      system_prompt_applied: { promptId: id, mode: 'permanent' } as any 
    });
    toast.success('已应用到当前对话');
    router.push('/chat');
  };

  return (
    <div className="h-full w-full flex flex-col bg-white/95 dark:bg-slate-900/95 overflow-hidden">
      {/* 顶部工具栏 */}
      <PromptsHeader />
      
      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-7xl mx-auto">
          {mapped.length > 0 ? (
            <PromptList prompts={mapped} />
          ) : (
            <PromptsEmptyState />
          )}
        </div>
      </div>

      {/* 最近使用区域 */}
      {recentlyUsed.length > 0 && (
        <div className="border-t border-slate-200/50 dark:border-slate-700/30 p-3 flex-shrink-0">
          <div className="max-w-7xl mx-auto">
            <RecentUsedList 
              title="最近使用"
              items={recentlyUsed}
              onItemClick={handleApplyPrompt}
              emptyText="暂无"
            />
          </div>
        </div>
      )}
    </div>
  );
}

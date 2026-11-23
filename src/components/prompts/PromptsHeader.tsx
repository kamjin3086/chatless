'use client';

import { useState, useMemo } from 'react';
import { Search, Plus, Star, X } from 'lucide-react';
import { PromptEditorDialog } from './PromptEditorDialog';
import { usePromptStore } from '@/store/promptStore';
import { PromptImportExport } from './PromptImportExport';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';

export function PromptsHeader() {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const createPrompt = usePromptStore((s) => s.createPrompt);
  const prompts = usePromptStore((s) => s.prompts);
  const ui = usePromptStore((s) => s.ui);
  const setSearchQuery = usePromptStore((s) => s.setSearchQuery);
  const setFavoriteOnly = usePromptStore((s) => s.setFavoriteOnly);
  const setTagFilter = usePromptStore((s) => s.setTagFilter);
  const setSortBy = usePromptStore((s) => s.setSortBy);

  // 从实际提示词中提取标签，按使用频率排序，只取前5个
  const topTags = useMemo(() => {
    const tagCount: Record<string, number> = {};
    prompts.forEach(prompt => {
      (prompt.tags || []).forEach(tag => {
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      });
    });
    
    return Object.entries(tagCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));
  }, [prompts]);

  const hasFilters = ui?.tagFilter || ui?.favoriteOnly || ui?.searchQuery;

  return (
    <div className="app-topbar px-4 py-2 border-b border-slate-200/50 dark:border-slate-700/30">
      <div className="max-w-6xl mx-auto space-y-2">
        {/* 主要操作区域 */}
        <div className="flex items-center justify-between gap-3">
          {/* 左侧：搜索 */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              aria-label={t('prompts.search')}
              placeholder={t('prompts.search')}
              value={ui?.searchQuery || ''}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 pl-7 pr-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600"
            />
          </div>
          
          {/* 中间：筛选 */}
          <div className="flex items-center gap-1.5">
            {/* 标签筛选 */}
            <select
              aria-label={t('prompts.filterByTag')}
              value={ui?.tagFilter || '__all__'}
              onChange={(e) => setTagFilter(e.target.value === '__all__' ? null : e.target.value)}
              className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none"
            >
              <option value="__all__">{t('prompts.allTags')}</option>
              {topTags.map(({ tag }) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>

            {/* 收藏筛选 */}
            <button
              onClick={() => setFavoriteOnly(!ui?.favoriteOnly)}
              className={cn(
                "h-7 px-2 text-xs rounded-md flex items-center gap-1 transition-colors",
                ui?.favoriteOnly 
                  ? "glass-chip-active bg-slate-200/50 text-slate-700 border border-slate-300/50 dark:bg-white/10 dark:text-slate-200 dark:border-white/20"
                  : "border border-slate-200/60 dark:border-slate-700/40 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40"
              )}
            >
              <Star className={cn("w-3 h-3", ui?.favoriteOnly && "fill-current")} />
              {t('prompts.favorites')}
            </button>

            {/* 排序 */}
            <select
              aria-label={t('prompts.sortBy')}
              value={ui?.sortBy || 'recent'}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none"
            >
              <option value="recent">{t('prompts.updated')}</option>
              <option value="created">{t('prompts.created')}</option>
              <option value="frequency">{t('prompts.usage')}</option>
              <option value="name">{t('prompts.name')}</option>
            </select>
          </div>

          {/* 右侧：操作按钮 */}
          <div className="flex items-center gap-1.5">
            <PromptImportExport />
            <button
              onClick={() => setOpen(true)}
              className="h-7 px-2.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400 rounded-md transition-colors flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('prompts.new')}
            </button>
          </div>
        </div>

        {/* 当前筛选状态 */}
        {hasFilters && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-slate-400">{t('prompts.filters')}</span>
            {ui?.tagFilter && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {ui.tagFilter}
                <button aria-label={t('prompts.removeTagFilter')} onClick={() => setTagFilter(null)} className="ml-0.5 hover:text-slate-900 dark:hover:text-slate-100">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )}
            {ui?.favoriteOnly && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-slate-200/70 bg-slate-100/70 text-slate-600 dark:border-slate-600/50 dark:bg-slate-800/40 dark:text-slate-300">
                {t('prompts.favorites')}
                <button aria-label={t('prompts.removeFavoritesFilter')} onClick={() => setFavoriteOnly(false)} className="ml-0.5 hover:text-slate-800 dark:hover:text-slate-100">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )}
            {ui?.searchQuery && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                "{ui.searchQuery}"
                <button aria-label={t('common.clearSearch')} onClick={() => setSearchQuery('')} className="ml-0.5 hover:text-slate-900 dark:hover:text-slate-100">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )}
            <button 
              onClick={() => { setSearchQuery(''); setFavoriteOnly(false); setTagFilter(null); }}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {t('prompts.clearFilters')}
            </button>
          </div>
        )}
      </div>

      <PromptEditorDialog
        open={open}
        onOpenChange={setOpen}
        initial={null}
        onSubmit={(data) => {
          createPrompt({ ...(data as any), shortcuts: (data as any).shortcuts || [] });
        }}
      />
    </div>
  );
}

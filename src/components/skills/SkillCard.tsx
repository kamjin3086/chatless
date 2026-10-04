'use client';

import { cn } from '@/lib/utils';
import type { Skill } from '@/lib/skills/types';
import { SkillStatusBadge } from './SkillStatusBadge';
import { Sparkles, User, Tag, FolderOpen } from 'lucide-react';

interface SkillCardProps {
  skill: Skill;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

export function SkillCard({
  skill,
  onClick,
  selected = false,
  className,
}: SkillCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col text-left w-full p-3 rounded-lg border transition-colors duration-150',
        'bg-white/60 dark:bg-slate-900/40 glass-panel',
        'hover:border-slate-300/80 dark:hover:border-slate-600/60',
        'focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600',
        selected
          ? 'border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800/60'
          : 'border-slate-200/60 dark:border-slate-700/40',
        className
      )}
    >
      {/* 头部：图标、名称、版本 */}
      <div className="flex items-start gap-2.5 mb-2">
        <div
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-md',
            'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
          )}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
              {skill.name}
            </h3>
            {skill.version && (
              <span className="flex-shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                v{skill.version}
              </span>
            )}
          </div>
          {/* 来源标识 */}
          <div className="flex items-center gap-1 mt-0.5">
            <FolderOpen className="h-2.5 w-2.5 text-slate-400" />
            <span className="text-[10px] text-slate-400">本地</span>
          </div>
        </div>
      </div>

      {/* 描述 */}
      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mb-2 flex-1">
        {skill.description || '暂无描述'}
      </p>

      {/* 标签 */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <Tag className="h-2.5 w-2.5 text-slate-400" />
          {skill.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            >
              {tag}
            </span>
          ))}
          {skill.tags.length > 3 && (
            <span className="text-[10px] text-slate-400">+{skill.tags.length - 3}</span>
          )}
        </div>
      )}

      {/* 底部：作者、状态 */}
      <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-slate-100 dark:border-slate-800/60">
        {skill.author ? (
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <User className="h-2.5 w-2.5" />
            <span className="truncate max-w-[100px]">{skill.author}</span>
          </div>
        ) : (
          <div />
        )}
        <SkillStatusBadge status={skill.status} />
      </div>

      {/* 启用状态指示器 */}
      {skill.enabled && skill.status === 'installed' && (
        <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-500" />
      )}
    </button>
  );
}

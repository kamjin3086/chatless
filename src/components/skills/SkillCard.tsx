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
  // 当前产品形态：skills 以本地文件夹存在；不再展示“远程”来源（避免困惑）
  const isLocal = true;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col text-left w-full p-4 rounded-xl border transition-all duration-200',
        'bg-white dark:bg-gray-900',
        'hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
        selected
          ? 'border-blue-500 dark:border-blue-500 shadow-md ring-2 ring-blue-500/20'
          : 'border-gray-200 dark:border-gray-800',
        className
      )}
    >
      {/* 头部：图标、名称、版本 */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg',
            'bg-gradient-to-br from-violet-500 to-purple-600 text-white',
            'group-hover:scale-105 transition-transform duration-200'
          )}
        >
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {skill.name}
            </h3>
            {skill.version && (
              <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
                v{skill.version}
              </span>
            )}
          </div>
          {/* 来源标识 */}
          <div className="flex items-center gap-1 mt-0.5">
            <FolderOpen className="h-3 w-3 text-gray-400" />
            <span className="text-xs text-gray-400">本地</span>
          </div>
        </div>
      </div>

      {/* 描述 */}
      <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-3 flex-1">
        {skill.description || '暂无描述'}
      </p>

      {/* 标签 */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          <Tag className="h-3 w-3 text-gray-400" />
          {skill.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
            >
              {tag}
            </span>
          ))}
          {skill.tags.length > 3 && (
            <span className="text-xs text-gray-400">+{skill.tags.length - 3}</span>
          )}
        </div>
      )}

      {/* 底部：作者、状态 */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100 dark:border-gray-800">
        {skill.author ? (
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-500">
            <User className="h-3 w-3" />
            <span className="truncate max-w-[120px]">{skill.author}</span>
          </div>
        ) : (
          <div />
        )}
        <SkillStatusBadge status={skill.status} />
      </div>

      {/* 启用状态指示器 */}
      {skill.enabled && skill.status === 'installed' && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500" />
      )}
    </button>
  );
}


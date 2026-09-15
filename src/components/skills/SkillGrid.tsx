'use client';

import { cn } from '@/lib/utils';
import type { Skill } from '@/lib/skills/types';
import { SkillCard } from './SkillCard';
import { Sparkles, AlertCircle, Loader2 } from 'lucide-react';

interface SkillGridProps {
  skills: Skill[];
  selectedSkillId?: string | null;
  onSkillClick?: (skill: Skill) => void;
  isLoading?: boolean;
  error?: string | null;
  className?: string;
}

export function SkillGrid({
  skills,
  selectedSkillId,
  onSkillClick,
  isLoading = false,
  error = null,
  className,
}: SkillGridProps) {
  // 加载状态
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mb-2" />
        <p className="text-xs">正在加载技能...</p>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-red-500 dark:text-red-400">
        <AlertCircle className="h-5 w-5 mb-2" />
        <p className="text-xs font-medium">加载失败</p>
        <p className="text-[11px] text-slate-400 mt-1">{error}</p>
      </div>
    );
  }

  // 空状态
  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg glass-inset mb-3">
          <Sparkles className="h-5 w-5" />
        </div>
        <p className="text-xs font-medium text-slate-500">暂无技能</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          尝试刷新或添加本地技能
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid gap-3',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
        className
      )}
    >
      {skills.map((skill) => (
        <SkillCard
          key={skill.id}
          skill={skill}
          selected={skill.id === selectedSkillId}
          onClick={() => onSkillClick?.(skill)}
        />
      ))}
    </div>
  );
}

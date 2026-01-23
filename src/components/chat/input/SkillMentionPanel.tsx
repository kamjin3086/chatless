"use client";

import { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getSkillManager } from '@/lib/skills';
import type { Skill } from '@/lib/skills/types';
import { Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  panelContainerClass,
  panelHeaderClass,
  panelListClass,
  panelItemClass,
  panelItemActiveClass,
  panelFooterClass,
  calcPanelPosition,
  panelWidth,
} from './panel-styles';

interface SkillMentionPanelProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLTextAreaElement>;
  onSelect: (skill: Skill) => void;
  onClose: () => void;
  filterQuery?: string;
}

export function SkillMentionPanel({ 
  open, 
  anchorRef, 
  onSelect, 
  onClose, 
  filterQuery = '' 
}: SkillMentionPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const activeRef = useRef(0);
  const [, forceUpdate] = useState({});

  // 加载技能列表
  useEffect(() => {
    if (!open) return;
    
    const loadSkills = async () => {
      const manager = getSkillManager();
      await manager.initialize();
      setSkills(manager.getEnabledSkills());
      activeRef.current = 0;
    };
    
    loadSkills();
  }, [open]);

  // 过滤技能
  const filteredSkills = useMemo(() => {
    if (!filterQuery) return skills;
    
    const q = filterQuery.toLowerCase();
    const prefixMatches = skills.filter(s => 
      s.id.toLowerCase().startsWith(q) || 
      s.name.toLowerCase().startsWith(q)
    );
    const containsMatches = skills.filter(s => 
      !s.id.toLowerCase().startsWith(q) && 
      !s.name.toLowerCase().startsWith(q) &&
      (s.id.toLowerCase().includes(q) || 
       s.name.toLowerCase().includes(q) ||
       s.description?.toLowerCase().includes(q))
    );
    
    return [...prefixMatches, ...containsMatches];
  }, [skills, filterQuery]);

  // 位置计算和键盘导航
  useEffect(() => {
    if (!open) return;
    
    const el = anchorRef.current;
    setPos(calcPanelPosition(el, panelWidth.md));
    
    const onKey = (e: KeyboardEvent) => {
      if (!open || filteredSkills.length === 0) return;
      
      if (e.key === 'Escape') { onClose(); return; }
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeRef.current = (activeRef.current + 1) % filteredSkills.length;
        forceUpdate({});
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeRef.current = (activeRef.current - 1 + filteredSkills.length) % filteredSkills.length;
        forceUpdate({});
      }
      
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const skill = filteredSkills[activeRef.current];
        if (skill) onSelect(skill);
      }
    };
    
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filteredSkills, anchorRef, onSelect, onClose]);

  // 重置活动索引
  useEffect(() => {
    activeRef.current = 0;
  }, [filterQuery]);

  if (!open || !pos) return null;

  const panel = (
    <div
      style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, zIndex: 9999 }}
      className={panelContainerClass}
    >
      {/* 头部 */}
      <div className={panelHeaderClass}>
        <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400">
          # 技能
        </span>
        <button
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
          onMouseDown={(e) => { e.preventDefault(); window.location.assign('/settings?tab=skills'); }}
          title="管理技能"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 列表 */}
      <ul className={panelListClass}>
        {filteredSkills.map((skill, idx) => (
          <li
            key={skill.id}
            onMouseDown={(e) => { e.preventDefault(); onSelect(skill); }}
            onMouseEnter={() => { activeRef.current = idx; forceUpdate({}); }}
            className={cn(
              panelItemClass,
              idx === activeRef.current && panelItemActiveClass
            )}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-slate-700 dark:text-slate-200 truncate">
                    {skill.name}
                  </span>
                  <span className="text-xs text-violet-400 font-mono">#{skill.id}</span>
                </div>
                {skill.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {skill.description}
                  </p>
                )}
              </div>
            </div>
            
            {/* 标签 */}
            {skill.tags && skill.tags.length > 0 && idx === activeRef.current && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {skill.tags.slice(0, 3).map((tag, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
        
        {filteredSkills.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-slate-500">
            {skills.length === 0 ? '暂无已启用的技能' : '未找到匹配的技能'}
          </li>
        )}
      </ul>

      {/* 底部 */}
      <div className={panelFooterClass}>
        <span>↑↓ 导航 · Enter 选择 · Esc 关闭</span>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(panel, document.body) : panel;
}

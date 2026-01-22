"use client";

import { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getSkillManager } from '@/lib/skills';
import type { Skill } from '@/lib/skills/types';
import { Settings, Sparkles, Tag } from 'lucide-react';

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

  // 加载已启用的技能列表
  useEffect(() => {
    if (!open) return;
    
    const loadSkills = async () => {
      const manager = getSkillManager();
      await manager.initialize();
      const enabledSkills = manager.getEnabledSkills();
      setSkills(enabledSkills);
      activeRef.current = 0;
    };
    
    loadSkills();
  }, [open]);

  // 根据搜索词过滤技能
  const filteredSkills = useMemo(() => {
    if (!filterQuery) return skills;
    
    const q = filterQuery.toLowerCase();
    // 优先匹配 ID 前缀，其次匹配名称和描述
    const prefixMatches = skills.filter(s => 
      s.id.toLowerCase().startsWith(q) || 
      s.name.toLowerCase().startsWith(q)
    );
    const containsMatches = skills.filter(s => 
      !s.id.toLowerCase().startsWith(q) && 
      !s.name.toLowerCase().startsWith(q) &&
      (s.id.toLowerCase().includes(q) || 
       s.name.toLowerCase().includes(q) ||
       s.description?.toLowerCase().includes(q) ||
       s.tags?.some(t => t.toLowerCase().includes(q)))
    );
    
    return [...prefixMatches, ...containsMatches];
  }, [skills, filterQuery]);

  // 位置计算和键盘导航
  useEffect(() => {
    if (!open) return;
    
    const el = anchorRef.current;
    if (!el) return;
    
    const rect = el.getBoundingClientRect();
    setPos({ 
      left: rect.left + 56, 
      bottom: window.innerHeight - rect.top + 36, 
      width: rect.width - 72 
    });
    
    const onKey = (e: KeyboardEvent) => {
      if (!open || filteredSkills.length === 0) return;
      
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      
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
        if (skill) {
          onSelect(skill);
        }
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

  // 动态宽度：根据输入框宽度自适应
  const panelWidth = Math.min(Math.max(pos.width, 400), window.innerWidth * 0.9);

  const panel = (
    <div 
      style={{ 
        position: 'fixed', 
        left: Math.max(8, Math.min(pos.left, window.innerWidth - panelWidth - 8)), 
        bottom: pos.bottom, 
        width: panelWidth, 
        zIndex: 2147483600 
      }} 
      className="rounded-2xl border border-slate-300/60 dark:border-slate-600/50 bg-white/98 dark:bg-slate-900/98 backdrop-blur-xl shadow-2xl overflow-hidden transition-all duration-200"
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/60 dark:border-slate-700/50 bg-gradient-to-r from-slate-50/50 to-transparent dark:from-slate-800/30">
        <div className="flex items-center gap-2">
          <div className="px-2 py-1 rounded-lg bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/20 border border-violet-200/50 dark:border-violet-700/40">
            <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">技能</span>
          </div>
        </div>
        <button 
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 transition-all hover:scale-105" 
          onMouseDown={(e) => { e.preventDefault(); window.location.assign('/settings?tab=skills'); }} 
          title="技能设置"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
      
      {/* 技能列表 */}
      <ul className="max-h-80 overflow-auto py-2 px-1">
        {filteredSkills.map((skill, idx) => (
          <li 
            key={skill.id} 
            onMouseDown={(e) => { e.preventDefault(); onSelect(skill); }} 
            onMouseEnter={() => { activeRef.current = idx; forceUpdate({}); }} 
            className={`mx-1.5 px-4 py-3 rounded-xl transition-all duration-150 cursor-pointer ${
              idx === activeRef.current 
                ? 'bg-gradient-to-br from-violet-50 via-purple-50/80 to-fuchsia-50/60 dark:from-violet-900/25 dark:via-purple-900/20 dark:to-fuchsia-900/15 ring-2 ring-violet-300/60 dark:ring-violet-600/50 shadow-md border border-violet-200/50 dark:border-violet-700/40' 
                : 'hover:bg-gradient-to-r hover:from-slate-50 hover:to-gray-50/50 dark:hover:from-slate-800/50 dark:hover:to-slate-800/30 border border-transparent hover:border-slate-200/50 dark:hover:border-slate-700/40'
            }`}
          >
            <div className="flex items-center gap-3">
              {/* 技能图标 */}
              <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-violet-300/60 dark:border-violet-600/50 bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-800/40 dark:to-purple-800/30 text-violet-600 dark:text-violet-300 shadow-sm">
                <Sparkles className="w-4 h-4" />
              </span>
              
              {/* 技能信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-50 text-base truncate">
                    {skill.name}
                  </span>
                  {skill.version && (
                    <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                      v{skill.version}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {skill.description}
                  </p>
                )}
              </div>
              
              {/* 技能 ID */}
              <span className="shrink-0 text-xs text-slate-400 font-mono">
                #{skill.id}
              </span>
            </div>
            
            {/* 标签 */}
            {skill.tags && skill.tags.length > 0 && (
              <div className="mt-2 pl-11 flex flex-wrap gap-1.5">
                {skill.tags.slice(0, 4).map((tag, i) => (
                  <span 
                    key={i} 
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400"
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
                {skill.tags.length > 4 && (
                  <span className="text-[10px] text-slate-400 self-center">
                    +{skill.tags.length - 4}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
        
        {filteredSkills.length === 0 && (
          <li className="px-4 py-6 text-center">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {skills.length === 0 ? '暂无已启用的技能' : '未找到匹配的技能'}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {skills.length === 0 ? '请在技能管理页面启用技能' : '尝试其他关键词'}
            </div>
          </li>
        )}
      </ul>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(panel, document.body) : panel;
}


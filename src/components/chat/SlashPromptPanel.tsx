"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { usePromptStore } from '@/store/promptStore';
import { generateShortcutCandidates } from '@/lib/prompt/shortcut';
import { createPortal } from 'react-dom';
import { Settings } from 'lucide-react';
import {
  panelContainerClass,
  panelHeaderClass,
  panelListClass,
  panelItemClass,
  panelItemActiveClass,
  panelFooterClass,
  calcPanelPosition,
  panelWidth,
} from './input/panel-styles';

interface SlashPromptPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (promptId: string, opts?: { action?: 'apply' | 'send' | 'fill'; mode?: 'permanent' | 'oneOff' }) => void;
  anchorRef?: React.RefObject<HTMLElement>;
  queryText?: string;
}

export function SlashPromptPanel({ open, onOpenChange, onSelect, anchorRef, queryText }: SlashPromptPanelProps) {
  const prompts = usePromptStore((s) => s.prompts);
  const loadFromDatabase = usePromptStore((s) => (s as any).loadFromDatabase);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const [pendingVars, setPendingVars] = useState<Record<string, any>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);

  const activeIndexRef = useRef(0);
  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);
  
  const pendingVarsRef = useRef(pendingVars);
  useEffect(() => { pendingVarsRef.current = pendingVars; }, [pendingVars]);

  // 初始化
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      activeIndexRef.current = 0;
      setHoverId(null);
      
      if (prompts.length === 0 && typeof loadFromDatabase === 'function') {
        try { loadFromDatabase(); } catch { /* ignore */ }
      }
      
      const el = anchorRef?.current;
      setPos(calcPanelPosition(el as HTMLElement | null, panelWidth.lg));
    }
  }, [open, anchorRef, prompts.length, loadFromDatabase]);

  // 解析变量
  useEffect(() => {
    const q = (queryText || '').trim().toLowerCase();
    if (!q.startsWith('/')) { setPendingVars({}); return; }
    
    const parts = q.split(/\s+/);
    const rest = q.slice(parts[0].length).trim();
    
    const inlineVars: Record<string, string> = {};
    const varRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/gu;
    let m: RegExpExecArray | null;
    while ((m = varRe.exec(rest))) {
      inlineVars[m[1]] = (m[3] ?? m[4] ?? m[5] ?? '').toString();
    }
    
    if (Object.keys(inlineVars).length === 0 && rest) {
        const hasDelim = /[|｜]/.test(rest);
      const positional = hasDelim ? rest.split(/[|｜]/g).map(s => s.trim()).filter(Boolean) : [rest];
        setPendingVars({ __positional: positional });
    } else {
      setPendingVars(inlineVars);
    }
  }, [queryText]);

  // 过滤提示词
  const filtered = useMemo(() => {
    const q = (queryText || '').trim().toLowerCase();
    if (q === '/' || !q.startsWith('/')) return [];
    
    let tagFilter: string | null = null;
    let text = q;
    const tagMatch = q.match(/tag:([^\s]+)/);
    if (tagMatch) {
      tagFilter = tagMatch[1];
      text = q.replace(tagMatch[0], '').trim();
    }
    
      const parts = text.split(/\s+/);
    const token = parts[0].replace(/^\//, '');
    
    const list = prompts
      .filter((p) => {
        const byTag = tagFilter ? (p.tags || []).some((t) => t.toLowerCase().includes(tagFilter)) : true;
        if (!byTag) return false;
        
        const hay = `${p.name} ${(p.tags || []).join(' ')} ${p.description || ''}`.toLowerCase();
        const hasSaved = token && (p as any).shortcuts?.some((s: string) => s.toLowerCase().startsWith(token));
        const suggested = token && generateShortcutCandidates(p.name, p.tags || [], p.languages || []).some((s) => s.startsWith(token));
        
        return hay.includes(token) || hasSaved || suggested;
      })
      .slice(0, 20);
    
    return list;
  }, [prompts, queryText]);

  // 键盘导航
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      
      if (e.key === 'Escape') { onOpenChange(false); return; }
      
      const list = filtered.length > 0 ? filtered : prompts.slice(0, 20);
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(activeIndexRef.current + 1, list.length - 1);
        activeIndexRef.current = next;
        setActiveIndex(next);
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(activeIndexRef.current - 1, 0);
        activeIndexRef.current = prev;
        setActiveIndex(prev);
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        const p = list[activeIndexRef.current];
        if (!p) return;
        
        try {
          const ev = new CustomEvent('prompt-inline-vars', { detail: pendingVarsRef.current });
          window.dispatchEvent(ev);
        } catch { /* ignore */ }
        
        const useApply = e.altKey || e.metaKey;
        if (useApply) {
          onSelect(p.id, { action: 'apply', mode: e.shiftKey ? 'oneOff' : 'permanent' });
    } else {
          onSelect(p.id, { action: 'fill' });
        }
      }
    };
    
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, prompts, onSelect, onOpenChange]);

  // 重置索引
  useEffect(() => {
    setActiveIndex(0);
    activeIndexRef.current = 0;
  }, [queryText]);

  if (!open || !pos) return null;

  const displayList = filtered.length > 0 ? filtered : (queryText === '/' ? prompts.slice(0, 20) : []);
  const selectedId = displayList[activeIndex]?.id;

  // 变量值计算
  const computeVariableValues = (p: any): Record<string, string> => {
    if (!p) return {};
    const content = String(p.content || '');
    const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
    const keys: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content))) {
      const k = m[1];
      if (k && !keys.includes(k)) keys.push(k);
    }
    
    const base: Record<string, string> = {};
    const pos = (pendingVars as any).__positional;
    if (Array.isArray(pos)) {
      keys.forEach((k, idx) => { base[k] = pos[idx] ?? ''; });
    }
    return base;
  };

  // 高亮渲染
  const renderHighlighted = (template: string, values: Record<string, string>) => {
    const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    
    while ((m = pattern.exec(template))) {
      const [match, key, d1, d2, d3] = m;
      const before = template.slice(lastIndex, m.index);
      if (before) nodes.push(before);
      
      const fallback = d1 ?? d2 ?? d3?.trim() ?? '';
      const value = values[key] ?? fallback;
      nodes.push(
        <span key={m.index} className="px-1 rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200">
          {value || `{{${key}}}`}
        </span>
      );
      lastIndex = m.index + match.length;
    }
    
    if (lastIndex < template.length) nodes.push(template.slice(lastIndex));
    return nodes;
  };

  const panel = (
    <div
      style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, zIndex: 9999 }}
      className={panelContainerClass}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 头部 */}
      <div className={panelHeaderClass}>
        <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
          / 提示词
        </span>
        <button
          className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
          onMouseDown={(e) => { e.preventDefault(); window.location.assign('/prompts'); }}
          title="管理提示词"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 列表 */}
      <ul className={cn(panelListClass, "max-h-64")} onMouseLeave={() => setHoverId(null)}>
        {displayList.map((p, idx) => {
          const isActive = hoverId ? hoverId === p.id : selectedId === p.id;
          const values = computeVariableValues(p);
          
          return (
            <li
              key={p.id}
              className={cn(panelItemClass, isActive && panelItemActiveClass)}
              onMouseEnter={() => { setHoverId(p.id); setActiveIndex(idx); }}
              onMouseDown={(e) => {
                    e.preventDefault();
                try {
                    const ev = new CustomEvent('prompt-inline-vars', { detail: pendingVars });
                  window.dispatchEvent(ev);
                } catch { /* ignore */ }
                    onSelect(p.id, { action: 'fill' });
                  }}
              >
              {/* 标题行 */}
                <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-slate-700 dark:text-slate-200 truncate">
                  {p.name}
                </span>
                <span className="shrink-0 px-1.5 py-0.5 rounded-md text-xs font-mono text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50">
                  /{(p as any).shortcuts?.[0] || p.name[0]?.toLowerCase() || ''}
                  </span>
                </div>
              
              {/* 展开预览 */}
              {isActive && (
                <div className="mt-2 space-y-1.5">
                    {p.tags && p.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.tags.slice(0, 4).map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded-md text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  <div className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 whitespace-pre-wrap">
                    {renderHighlighted(p.content || '', values)}
                    </div>
                  </div>
                )}
              </li>
          );
        })}
        
        {displayList.length === 0 && queryText !== '/' && (
          <li className="px-3 py-4 text-center text-sm text-slate-500">
            没有匹配的提示词
          </li>
          )}
        </ul>

      {/* 底部 */}
      <div className={cn(panelFooterClass, "flex items-center justify-between")}>
        <span>↑↓ 导航 · Enter 代入 · Alt+Enter 设为系统</span>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(panel, document.body) : panel;
}

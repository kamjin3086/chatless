"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { usePromptStore } from '@/store/promptStore';
import { generateShortcutCandidates } from '@/lib/prompt/shortcut';
import { createPortal } from 'react-dom';
import { Settings } from 'lucide-react';

interface SlashPromptPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (promptId: string, opts?: { action?: 'apply' | 'send' | 'fill'; mode?: 'permanent' | 'oneOff' }) => void;
  anchorRef?: React.RefObject<HTMLElement>;
  // 来自主输入框的文本，用于统一过滤，避免重复输入
  queryText?: string;
}

export function SlashPromptPanel({ open, onOpenChange, onSelect, anchorRef, queryText }: SlashPromptPanelProps) {
  const prompts = usePromptStore((s) => s.prompts);
  const loadFromDatabase = usePromptStore((s)=> (s as any).loadFromDatabase);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchorRect, setAnchorRect] = useState<{left:number; width:number; top:number; bottom:number} | null>(null);
  const [pendingVars, setPendingVars] = useState<Record<string, any>>({});

  // 使用 Ref 保存最新的 activeIndex / filtered / pendingVars，避免键盘事件闭包读取到旧值
  const activeIndexRef = useRef(0);
  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);
  // filtered 的 Ref 需在其定义之后设置（见下方 useMemo）
  const pendingVarsRef = useRef(pendingVars);
  useEffect(() => { pendingVarsRef.current = pendingVars; }, [pendingVars]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 轮播提示（固定列表 + 定时切换）
  const hintList = useMemo(() => (
    [
      ['空格', '代入变量'],
      ['|', '分隔/结束参数输入'],
      ['/tag:', '过滤'],
      ['Enter', '使用'],
      ['Alt+Enter', '设为系统']
    ] as const
  ), []);
  const [hintIndex, setHintIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setHintIndex((i) => (i + 1) % hintList.length), 3500);
    return () => clearInterval(timer);
  }, [hintList.length]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      activeIndexRef.current = 0;
      // 若还未加载提示词，尝试从数据库拉取
      try { if (prompts.length === 0 && typeof loadFromDatabase === 'function') { loadFromDatabase(); } } catch { /* ignore */ }
      // 计算锚点位置
      const calc = () => {
        try {
          const el = anchorRef?.current as HTMLElement | null;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          setAnchorRect({ left: rect.left, width: rect.width, top: rect.top, bottom: rect.bottom });
        } catch { /* ignore */ }
      };
      calc();
      window.addEventListener('scroll', calc, true);
      window.addEventListener('resize', calc);
      return () => {
        window.removeEventListener('scroll', calc, true);
        window.removeEventListener('resize', calc);
      };
    }
  }, [open]);

  // 解析 queryText -> pendingVars（副作用，不要在渲染期间 setState）
  useEffect(() => {
    const q = (queryText || '').trim().toLowerCase();
    let text = q;
    const tagMatch = q.match(/tag:([^\s]+)/);
    if (tagMatch) {
      text = q.replace(tagMatch[0], '').trim();
    }
    if (!text.startsWith('/')) { setPendingVars({}); return; }
    const parts = text.split(/\s+/);
    const rest = text.slice(parts[0].length).trim();
    const inlineVars: Record<string,string> = {};
    const varRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/gu;
    let m: RegExpExecArray | null;
    while ((m = varRe.exec(rest))) { inlineVars[m[1]] = (m[3] ?? m[4] ?? m[5] ?? '').toString(); }
    if (Object.keys(inlineVars).length === 0 && rest) {
      const asciiIdx = rest.indexOf('| ');
      const fullIdx = rest.indexOf('｜ ');
      const cutIdx = [asciiIdx, fullIdx].filter(v=>v>=0).sort((a,b)=>a-b)[0];
      if (cutIdx !== undefined) {
        const before = rest.slice(0, cutIdx);
        const after = rest.slice(cutIdx + 2).trim();
        const hasDelimBefore = /[|｜]/.test(before);
        const positional = hasDelimBefore ? before.split(/[|｜]/g).map(s=>s.trim()).filter(Boolean) : [before.trim()].filter(Boolean);
        setPendingVars({ __positional: positional, __postText: after });
      } else {
        const hasDelim = /[|｜]/.test(rest);
        const positional = hasDelim ? rest.split(/[|｜]/g).map(s=>s.trim()).filter(Boolean) : [rest];
        setPendingVars({ __positional: positional });
      }
    } else {
      setPendingVars(inlineVars);
    }
  }, [queryText]);

  const filtered = useMemo(() => {
    const q = (queryText || '').trim().toLowerCase();
    if (q === '/') return [] as any[]; // 仅输入斜线：不展开任何项
    let tagFilter: string | null = null;
    let text = q;
    const tagMatch = q.match(/tag:([^\s]+)/);
    if (tagMatch) {
      tagFilter = tagMatch[1];
      text = q.replace(tagMatch[0], '').trim();
    }
    // 记忆选择（localStorage）
    let pref: Record<string,string> = {};
    try { pref = (window as any).__prompt_pref_cache__ || {}; } catch { /* ignore */ }
    // 仅用于过滤/排序的 token
    let token = '';
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      token = parts[0].replace(/^\//,'');
    } else {
      token = text || '';
    }
    const list = prompts
      .filter((p) => {
        const byTag = tagFilter ? (p.tags || []).some((t) => t.toLowerCase().includes(tagFilter)) : true;
        if (!byTag) return false;
        if (!text || text === '/') return false; // 避免空或仅斜线时误命中
        const hay = `${p.name} ${(p.tags || []).join(' ')} ${p.description || ''}`.toLowerCase();
        const hasSaved = token && (p as any).shortcuts?.some((s:string)=> s.toLowerCase().startsWith(token));
        const suggested = token && generateShortcutCandidates(p.name, p.tags || [], p.languages || []).some((s)=> s.startsWith(token));
        return hay.includes(text) || hasSaved || suggested;
      })
      .map((p) => {
        const savedShortcuts: string[] = (p as any).shortcuts || [];
        const hasExactSaved = token && savedShortcuts.some(s=>s.toLowerCase()===token);
        const hasSavedPrefix = token && savedShortcuts.some(s=>s.toLowerCase().startsWith(token));
        const isPreferred = token && pref[token] === p.id;
        const suggestedHit = token && !hasSavedPrefix && generateShortcutCandidates(p.name, p.tags || [], p.languages || []).some(s=>s.startsWith(token));
        return { p, hasExactSaved, hasSavedPrefix, isPreferred, suggestedHit };
      });
    // 返回最多 50 条匹配用于“展开集合”
    const sorted = list.sort((a,b)=>{
      const scoreA = (a.hasExactSaved?1000:0) + (a.isPreferred?500:0) + (a.hasSavedPrefix?100:0) + (a.suggestedHit?10:0);
      const scoreB = (b.hasExactSaved?1000:0) + (b.isPreferred?500:0) + (b.hasSavedPrefix?100:0) + (b.suggestedHit?10:0);
      return scoreB - scoreA;
    });
    return sorted.slice(0, 50).map(x=>({ p: x.p, note: x.suggestedHit && !x.hasSavedPrefix ? '(建议)' : '' }));
  }, [prompts, queryText]);

  // 将最新的 filtered 列表写入 Ref，供键盘事件读取
  const filteredRef = useRef<any[]>([]);
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);

  // 可导航列表：有匹配项时使用匹配集合，否则（例如仅输入'/'）使用全部提示词
  const navigableRef = useRef<any[]>([]);
  useEffect(() => {
    if ((filtered?.length || 0) > 0) {
      navigableRef.current = filtered.map((x:any)=> x.p);
    } else {
      navigableRef.current = prompts;
    }
  }, [filtered, prompts]);

  // 悬浮项 id：鼠标在面板上移动时临时生效；移出面板后恢复到选中项
  const [hoverId, setHoverId] = useState<string | null>(null);

  // 选中项：仅输入 '/' 时不选中；有匹配项时默认选中第一条
  const onlySlash = useMemo(() => {
    const q = (queryText || '').trim();
    return q === '/';
  }, [queryText]);

  useEffect(() => {
    if (onlySlash) {
      setActiveIndex(-1);
      activeIndexRef.current = -1 as any;
    } else if ((filtered?.length || 0) > 0) {
      setActiveIndex(0);
      activeIndexRef.current = 0;
    } else {
      setActiveIndex(-1);
      activeIndexRef.current = -1 as any;
    }
    // 每次查询变化时，清空悬浮，避免保留无效 hoverId 导致不展开
    setHoverId(null);
  }, [onlySlash, filtered?.length, queryText]);

  // 打开面板时也清空悬浮，避免沿用上一次的 hoverId
  useEffect(() => { if (open) setHoverId(null); }, [open]);

  // 当前选中项 id（用于同步展开项）
  const selectedId = useMemo(() => {
    if (activeIndex < 0) return null;
    if (onlySlash) {
      const list = navigableRef.current || [];
      return list[activeIndex]?.id ?? null;
    }
    return (filtered[activeIndex]?.p?.id) ?? null;
  }, [activeIndex, onlySlash, filtered]);

  // 当列表变化时，纠正 activeIndex，避免键盘高亮与提交不一致
  useEffect(() => {
    setActiveIndex((i) => Math.max(0, Math.min(i, filtered.length - 1)));
  }, [filtered.length]);


  // 从元数据或模板内容推导变量定义顺序
  const getVariableKeys = (p: any): string[] => {
    if (!p) return [];
    const metaKeys: string[] = (Array.isArray(p.variables) ? (p.variables as any[]).map(v=>v.key).filter(Boolean) : []) as string[];
    if (metaKeys.length > 0) return metaKeys;
    const content: string = String(p.content || '');
    const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
    const keys: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content))) {
      const key = m[1];
      if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
  };

  // 计算用于渲染的变量值（支持位置参数，并合并默认值）
  const computeVariableValues = (p: any): Record<string, string> => {
    if (!p) return {};
    const defs: Array<{ key: string; defaultValue?: string }> = ((p.variables || []) as any[]).filter(Boolean);
    const keys = getVariableKeys(p);
    const basePairs: Array<[string, string]> = keys.map(k => {
      const meta = defs.find(d=>d.key===k);
      return [k, meta?.defaultValue ?? ''];
    });
    const base: Record<string, string> = Object.fromEntries(basePairs);
    const pos: string[] | undefined = (pendingVars as any).__positional;
    if (Array.isArray(pos) && keys.length > 0) {
      keys.forEach((k, idx) => { base[k] = pos[idx] ?? base[k] ?? ''; });
      return base;
    }
    // key=value 模式：覆盖默认
    const provided = pendingVars as Record<string, string>;
    for (const k in provided) { if (k !== '__positional') base[k] = String(provided[k] ?? ''); }
    return base;
  };


  // 将模板渲染为高亮 React 片段（高亮变量值）
  const renderHighlighted = (template: string, values: Record<string, string>) => {
    const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(template))) {
      const [match, key, d1, d2, d3] = m as unknown as [string, string, string?, string?, string?];
      const before = template.slice(lastIndex, m.index);
      if (before) nodes.push(before);
      const fallback = d1 ?? d2 ?? (d3 ? String(d3).trim() : undefined);
      const value = (values[key] ?? fallback ?? '').toString();
      nodes.push(
        <span key={m.index} className="px-1 rounded bg-yellow-100/70 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100">
          {value}
        </span>
      );
      lastIndex = m.index + match.length;
    }
    const tail = template.slice(lastIndex);
    if (tail) nodes.push(tail);
    return nodes;
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') { onOpenChange(false); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const navList = navigableRef.current || [];
        const start = activeIndexRef.current < 0 ? 0 : activeIndexRef.current + 1;
        const next = Math.min(start, navList.length - 1);
        activeIndexRef.current = next;
        setActiveIndex(next);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const base = activeIndexRef.current < 0 ? 0 : activeIndexRef.current - 1;
        const prev = Math.max(base, 0);
        activeIndexRef.current = prev;
        setActiveIndex(prev);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const list: any[] = navigableRef.current || [];
        let idx = activeIndexRef.current;
        if (idx < 0) {
          // 无选中：优先 hover，其次第一项
          if (hoverId) idx = Math.max(0, list.findIndex((it:any)=> (it.p?.id||it.id) === hoverId));
          if (idx < 0) idx = 0;
        }
        if (idx < 0 || idx >= list.length) return;
        const id = (list[idx])?.p?.id || (list[idx])?.id;
        if (!id) return;
        try { const ev = new CustomEvent('prompt-inline-vars', { detail: pendingVarsRef.current }); window.dispatchEvent(ev); } catch { /* ignore */ }
        const useApply = (e as any).altKey || (e as any).metaKey;
        if (useApply) {
          const oneOff = (e as any).shiftKey;
          onSelect(id, { action: 'apply', mode: oneOff ? 'oneOff' : 'permanent' });
        } else {
          onSelect(id, { action: 'fill' });
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onSelect, onOpenChange, hoverId]);

  if (!open) return null;

  const rect = anchorRect || { left: 0, width: 0, top: 0, bottom: 0 };

  const panelWidth = Math.min(Math.max(rect.width || 600, 600), window.innerWidth * 0.9);
  
  // 统一的面板样式（与 ActionPanel 保持一致）
  const panelBaseStyle = cn(
    // 基础
    "fixed z-[9950] rounded-xl border overflow-hidden",
    // 背景和模糊
    "bg-white/95 dark:bg-gray-800/95 backdrop-blur-md",
    // 阴影和边框
    "shadow-lg ring-1 ring-black/5 dark:ring-white/10",
    // 动画
    "transition-all duration-200",
    open ? "opacity-100 scale-100" : "opacity-0 scale-95"
  );

  const panel = (
    <div
      ref={panelRef}
      className={panelBaseStyle}
      style={{ 
        width: panelWidth,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8)), 
        bottom: Math.max(8, window.innerHeight - rect.top + 8) 
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 顶部已去除，防止高度变化时挤压上方内容 */}
      {/* 列表区域：无滚动时最多 6 项，超出出现滚动条；当仅输入'/'时展示全部提示词的折叠项 */}
      <ScrollArea className={cn(
        (queryText || '').trim().startsWith('/') ? (prompts.length > 6 ? 'max-h-60' : '') : (filtered.length > 6 ? 'max-h-60' : '')
      )} onMouseLeave={() => setHoverId(null)}>
        <ul className="py-1">
          {(() => {
            const q = (queryText || '').trim().toLowerCase();
            const startWithSlash = q.startsWith('/');
            // 展开集合：匹配到的提示词 id 集合
            const expandedId = (hoverId ?? selectedId) || '';
            let source: any[];
            if (startWithSlash) {
              source = (q === '/' || q === '') ? prompts : filtered.map((x:any)=> x.p);
            } else {
              source = filtered.map((x:any)=> x.p);
            }
            return source.map((p:any, idx:number) => (
              <li key={p.id}
                  className={cn(
                    'mx-2 px-3 py-2.5 cursor-pointer flex flex-col rounded-lg transition-all duration-150',
                    (hoverId ? hoverId===p.id : selectedId===p.id) 
                      ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 ring-1 ring-blue-200/50 dark:ring-blue-700/50 shadow-sm' 
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                  )}
                  onMouseEnter={() => { setHoverId(p.id); setActiveIndex(idx); activeIndexRef.current = idx; }}
                  onMouseDown={(e)=>{
                    e.preventDefault();
                    setActiveIndex(idx); activeIndexRef.current = idx; setHoverId(p.id);
                    const ev = new CustomEvent('prompt-inline-vars', { detail: pendingVars });
                    try { window.dispatchEvent(ev); } catch { /* ignore */ }
                    onSelect(p.id, { action: 'fill' });
                  }}
              >
                {/* 折叠标题行 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900 dark:text-gray-50 truncate">{p.name}</span>
                  <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-mono border border-amber-200/50 dark:border-amber-700/50">
                    /{(p.shortcuts?.[0] || (p.name||'')[0]?.toLowerCase() || '')}
                  </span>
                </div>
                {/* 展开内容：标签和预览 */}
                {(expandedId === p.id) && (
                  <div className="mt-2 space-y-2">
                    {p.tags && p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {p.tags.slice(0,6).map((t:string) => (
                          <span key={t} className="px-2 py-0.5 rounded-full bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800/60 dark:to-slate-800/40 text-[11px] text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50">
                            {t}
                          </span>
                        ))}
                        {p.tags.length > 6 && (
                          <span className="text-[11px] text-slate-500">+{p.tags.length - 6}</span>
                        )}
                      </div>
                    )}
                    <div className="rounded-lg bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50 px-3 py-2 text-[13px] leading-relaxed whitespace-normal break-words line-clamp-3">
                      {renderHighlighted(p.content || '', computeVariableValues(p))}
                    </div>
                  </div>
                )}
              </li>
            ));
          })()}
          {(filtered.length === 0 && (queryText || '').trim() !== '/' ) && (
            <li className="px-3 py-2 text-[12px] text-gray-600 dark:text-gray-300">没有匹配的提示词 · 试试 <span className="font-medium">tag:写作</span></li>
          )}
        </ul>
      </ScrollArea>
      {/* 底部控制区（统一样式） */}
      <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/30 dark:bg-gray-900/30 flex items-center text-[11px] text-gray-600 dark:text-gray-400 select-none gap-3">
        <span className="px-2 py-1 rounded-md border border-amber-200/60 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/20 text-amber-700 dark:text-amber-300 text-xs font-mono font-semibold">/</span>
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <div key={hintIndex} className="flex items-center gap-2 transition-all duration-500 ease-out">
            <span className="px-2 py-1 rounded-md border border-slate-300/60 bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-800 dark:to-gray-800 dark:border-slate-600/60 font-mono text-xs font-medium">{hintList[hintIndex][0]}</span>
            <span className="text-xs">{hintList[hintIndex][1]}</span>
          </div>
        </div>
        <button 
          className="p-1.5 rounded-md hover:bg-slate-100/80 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 transition-colors" 
          onMouseDown={(e)=>{ e.preventDefault(); window.location.assign('/prompts'); }} 
          title="管理提示词"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  // Portal 到 body，避免被上层 overflow 裁剪/遮挡
  if (typeof window !== 'undefined') {
    return createPortal(panel, document.body);
  }
  return panel;
}


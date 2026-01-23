"use client";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getEnabledConfiguredServers, getConnectedServers, getGlobalEnabledServers } from '@/lib/mcp/chatIntegration';
import { Settings, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { mcpPreheater } from '@/lib/mcp/mcpPreheater';
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

interface McpMentionPanelProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLTextAreaElement>;
  onSelect: (name: string) => void;
  onClose: () => void;
  filterQuery?: string;
}

export function McpMentionPanel({ open, anchorRef, onSelect, onClose, filterQuery = '' }: McpMentionPanelProps) {
  const [items, setItems] = useState<Array<{ name: string; connected: boolean; allowed: boolean }>>([]);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const activeRef = useRef(0);
  const [, forceUpdate] = useState({});
  const [toolsPreview, setToolsPreview] = useState<Record<string, string[]>>({});

  // 预热服务器
  const preheatServer = async (name: string) => {
    try {
      const { serverManager } = await import('@/lib/mcp/ServerManager');
      if (serverManager.isServerConnected(name)) return;
      
      toast.info(`正在连接 ${name}…`, { duration: 1200 });
      const { getAllConfiguredServersWithStatus } = await import('@/lib/mcp/chatIntegration');
      const list = await getAllConfiguredServersWithStatus();
      const item = list.find(s => s.name === name);
      if (!item) return;
      
      try {
        await Promise.race([
          serverManager.startServer(name, (item as any).config),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
        ]);
      } catch {
        toast.error(`连接 ${name} 失败`, { duration: 2000 });
      }
    } catch {
      toast.error(`连接失败`, { duration: 2000 });
    }
  };

  // 加载服务器列表
  useEffect(() => {
    if (!open) return;
    (async () => {
      const all = await getEnabledConfiguredServers();
      const connected = new Set(await getConnectedServers());
      const globallyEnabled = new Set(await getGlobalEnabledServers());
      
      const q = (filterQuery || '').toLowerCase();
      let list = all.map(n => ({ name: n, connected: connected.has(n), allowed: globallyEnabled.has(n) }));
      
      if (q) {
        const prefix = list.filter(it => it.name.toLowerCase().startsWith(q));
        const contains = list.filter(it => it.name.toLowerCase().includes(q) && !it.name.toLowerCase().startsWith(q));
        list = [...prefix, ...contains];
      }
      
      setItems(list);
      const firstIdx = list.findIndex((it) => it.allowed);
      activeRef.current = firstIdx >= 0 ? firstIdx : 0;
    })();
  }, [open, filterQuery]);

  // 位置计算和键盘导航
  useEffect(() => {
    if (!open) return;
    
    const el = anchorRef.current;
    setPos(calcPanelPosition(el, panelWidth.md));
    
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      
      if (e.key === 'Escape') { onClose(); return; }
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        let i = activeRef.current;
        for (let step = 0; step < items.length; step++) {
          i = (i + 1) % items.length;
          if (items[i]?.allowed) { activeRef.current = i; break; }
        }
        forceUpdate({});
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        let i = activeRef.current;
        for (let step = 0; step < items.length; step++) {
          i = (i - 1 + items.length) % items.length;
          if (items[i]?.allowed) { activeRef.current = i; break; }
        }
        forceUpdate({});
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[activeRef.current];
        if (it?.allowed) {
          preheatServer(it.name);
          onSelect(it.name);
        }
      }
    };
    
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, anchorRef, onSelect, onClose]);

  // 预取工具列表
  useEffect(() => {
    if (!open) return;
    
    const fetchTools = async () => {
      for (const it of items) {
        if (!it.allowed || !it.connected || toolsPreview[it.name]) continue;
        
        try {
          const { serverManager } = await import('@/lib/mcp/ServerManager');
          const tools: any[] | null = await Promise.race([
            serverManager.listTools(it.name),
            new Promise<null>(resolve => setTimeout(() => resolve(null), 800))
          ]) as any;
          
          if (tools) {
            setToolsPreview(prev => ({
              ...prev,
              [it.name]: tools.slice(0, 4).map((t: any) => t?.name || 'tool')
            }));
          }
        } catch { /* ignore */ }
      }
    };
    
    fetchTools();
  }, [open, items]);

  if (!open || !pos) return null;

  const panel = (
    <div
      style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, zIndex: 9999 }}
      className={panelContainerClass}
    >
      {/* 头部 */}
      <div className={panelHeaderClass}>
        <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
          @ MCP 服务器
        </span>
        <button
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
          onMouseDown={(e) => { e.preventDefault(); window.location.assign('/settings?tab=mcpServers'); }}
          title="管理 MCP"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 列表 */}
      <ul className={panelListClass}>
        {items.map((it, idx) => (
          <li
            key={it.name}
            onMouseDown={(e) => {
              e.preventDefault();
              if (it.allowed) {
                preheatServer(it.name);
                onSelect(it.name);
              }
            }}
            onMouseEnter={() => {
              if (it.allowed) {
                activeRef.current = idx;
                forceUpdate({});
              }
            }}
            className={cn(
              panelItemClass,
              idx === activeRef.current && panelItemActiveClass,
              !it.allowed && "opacity-40 cursor-not-allowed"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-500">@</span>
              <span className="flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                {it.name}
              </span>
              {!it.connected && it.allowed && (
                <span className="text-[10px] text-slate-400">未连接</span>
              )}
              {!it.allowed && (
                <span className="text-[10px] text-slate-400">未启用</span>
              )}
            </div>
            
            {/* 工具预览 */}
            {toolsPreview[it.name] && toolsPreview[it.name].length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {toolsPreview[it.name].map((tool, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
        
        {items.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-slate-500">
            暂无已启用的 MCP 服务器
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

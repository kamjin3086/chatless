"use client";

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, FileText, Folder, Settings } from 'lucide-react';
import { getConnectedServers, getEnabledConfiguredServers, getGlobalEnabledServers } from '@/lib/mcp/chatIntegration';
import { withOneShotGrant } from '@/lib/filesystemAllowlist/oneShotGrant';
import { listDirectory, type FsEntry } from '@/lib/tauri/filesystemCommands';
import { useLocaleStore } from '@/store/localeStore';
import { cn } from '@/lib/utils';
import {
  calcPanelPosition,
  panelContainerClass,
  panelHeaderClass,
  panelItemActiveClass,
  panelItemClass,
  panelListClass,
  panelWidth,
} from './panel-styles';

interface McpMentionPanelProps {
  anchorRef: React.RefObject<HTMLTextAreaElement | null>;
  workspaceDirectory?: string;
  onSelect: (name: string) => void;
  onSelectFile: (path: string) => void;
  onBrowse: () => void;
  onClose: () => void;
  filterQuery?: string;
}

type MentionItem =
  | { kind: 'server'; name: string; allowed: boolean; connected: boolean }
  | { kind: 'entry'; entry: FsEntry };

export function McpMentionPanel({ anchorRef, workspaceDirectory, onSelect, onSelectFile, onBrowse, onClose, filterQuery = '' }: McpMentionPanelProps) {
  const t = useLocaleStore((s) => s.t);
  useLocaleStore((s) => s.locale);
  const [servers, setServers] = useState<Extract<MentionItem, { kind: 'server' }>[]>([]);
  const [folders, setFolders] = useState<FsEntry[]>([]);
  const [listing, setListing] = useState<{ path: string; entries: FsEntry[]; truncated?: boolean; failed?: boolean } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<ReturnType<typeof calcPanelPosition>>(null);
  const currentFolder = folders.at(-1);
  const path = currentFolder?.path ?? workspaceDirectory;

  useEffect(() => {
    let stale = false;
    setPos(calcPanelPosition(anchorRef.current, panelWidth.md));
    Promise.all([getEnabledConfiguredServers(), getConnectedServers(), getGlobalEnabledServers()])
      .then(([configured, connected, enabled]) => {
        if (!stale) setServers(configured.map((name) => ({ kind: 'server', name, connected: connected.includes(name), allowed: enabled.includes(name) })));
      })
      .catch(() => { if (!stale) setServers([]); });
    return () => { stale = true; };
  }, [anchorRef]);

  useEffect(() => {
    if (!workspaceDirectory || !path) return;
    let stale = false;
    setListing(null);
    void withOneShotGrant({ path: workspaceDirectory, scope: 'composer-directory', read: true },
      (scope) => listDirectory({ ...scope, path }),
    ).then(({ entries, truncated }) => {
      if (!stale) setListing({ path, entries: entries.filter((entry) => entry.isFile || entry.isDirectory), truncated });
    }).catch(() => {
      if (!stale) setListing({ path, entries: [], failed: true });
    });
    return () => { stale = true; };
  }, [path, workspaceDirectory]);

  const visibleListing = listing?.path === path ? listing : null;
  const items = useMemo<MentionItem[]>(() => {
    const q = filterQuery.toLowerCase();
    const matches = (name: string) => name.toLowerCase().includes(q);
    return [
      ...servers.filter(({ name }) => matches(name)),
      ...(visibleListing?.entries ?? [])
        .filter(({ name }) => matches(name))
        .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
        .map((entry) => ({ kind: 'entry' as const, entry })),
    ];
  }, [servers, visibleListing, filterQuery]);
  const isSelectable = (item: MentionItem) => item.kind === 'entry' || item.allowed;
  useEffect(() => {
    const firstFile = currentFolder ? items.findIndex((item) => item.kind === 'entry') : -1;
    setActiveIndex(firstFile >= 0 ? firstFile : Math.max(0, items.findIndex(isSelectable)));
  }, [items, currentFolder]);

  const select = (item: MentionItem) => {
    if (item.kind === 'entry') {
      if (item.entry.isDirectory) {
        setFolders((previous) => [...previous, item.entry]);
        onBrowse();
      } else {
        onSelectFile(item.entry.path);
      }
    } else if (item.allowed) {
      if (!item.connected) {
        void (async () => {
          const { getAllConfiguredServersWithStatus } = await import('@/lib/mcp/chatIntegration');
          const { serverManager } = await import('@/lib/mcp/ServerManager');
          const server = (await getAllConfiguredServersWithStatus()).find(({ name }) => name === item.name);
          if (server && !serverManager.isServerConnected(item.name)) await serverManager.startServer(item.name, server.config);
        })().catch(() => {});
      }
      onSelect(item.name);
    }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target !== anchorRef.current || e.isComposing) return;
      if (e.key === 'Escape') { if (!e.defaultPrevented) { e.preventDefault(); onClose(); } return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) select(item);
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.key === 'ArrowUp' ? -1 : 1;
        for (let i = 1; i <= items.length; i++) {
          const next = (activeIndex + step * i + items.length) % items.length;
          if (isSelectable(items[next])) {
            setActiveIndex(next);
            break;
          }
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  if (!pos) return null;

  const renderRow = (item: MentionItem, index: number) => {
    const name = item.kind === 'server' ? item.name : item.entry.name;
    const Icon = item.kind === 'entry' ? (item.entry.isDirectory ? Folder : FileText) : null;
    return (
      <li key={item.kind === 'entry' ? item.entry.path : `server:${name}`}>
        <button
          type="button"
          disabled={!isSelectable(item)}
          className={cn(panelItemClass, 'flex w-full items-center gap-2 text-left disabled:opacity-50', index === activeIndex && panelItemActiveClass)}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => { if (isSelectable(item)) setActiveIndex(index); }}
          onClick={() => select(item)}
          title={name}
        >
          {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <span className="font-mono text-emerald-600" aria-hidden>@</span>}
          <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
          {item.kind === 'server' && (!item.allowed || !item.connected) && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t(item.allowed ? 'chatComposer.mcpDisconnected' : 'chatComposer.mcpDisabled')}
            </span>
          )}
        </button>
      </li>
    );
  };

  const sectionLabel = 'px-2.5 py-1 text-xs font-medium text-muted-foreground';
  const message = 'px-2.5 py-2 text-xs text-muted-foreground';
  const serverRows = items.map((item, index) => item.kind === 'server' ? renderRow(item, index) : null).filter(Boolean);
  const fileRows = items.map((item, index) => item.kind === 'entry' ? renderRow(item, index) : null).filter(Boolean);
  return createPortal(
    <div style={{ position: 'fixed', ...pos, zIndex: 9999 }} className={panelContainerClass} aria-label={t('chatComposer.mentions')}>
      <div className={panelHeaderClass}>
        <span className="text-xs font-medium text-foreground">@ {t('chatComposer.mentions')}</span>
        <button type="button" aria-label={t('chatComposer.manageMcp')} className="rounded p-1 hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => window.location.assign('/settings?tab=mcpServers')}>
          <Settings className="size-3.5" />
        </button>
      </div>
      <div className={panelListClass}>
        <div className={sectionLabel}>MCP</div>
        {serverRows.length ? <ul>{serverRows}</ul> : <div className={message}>{t('chatComposer.noMcp')}</div>}
        <div className={cn(sectionLabel, 'mt-1 flex items-center gap-1 border-t border-border')}>
          {currentFolder && (
            <button type="button" aria-label={t('chatComposer.parentFolder')} className="rounded p-0.5 hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => { setFolders((previous) => previous.slice(0, -1)); onBrowse(); }}>
              <ArrowLeft className="size-3.5" />
            </button>
          )}
          <span className="truncate">{currentFolder?.name ?? t('chatComposer.workspaceFiles')}</span>
        </div>
        {!workspaceDirectory ? <div className={message}>{t('chatComposer.noWorkspace')}</div>
          : !visibleListing ? <div className={message}>{t('chatComposer.loadingFiles')}</div>
          : visibleListing.failed ? <div className={message}>{t('chatComposer.filesUnavailable')}</div>
          : fileRows.length ? <ul>{fileRows}</ul>
          : <div className={message}>{t('chatComposer.noFiles')}</div>}
        {visibleListing?.truncated && <div className={message}>{t('chatComposer.filesTruncated')}</div>}
      </div>
      {workspaceDirectory && <p className={cn(message, 'shrink-0 border-t border-border')}>{t('chatComposer.filePermissionNote')}</p>}
    </div>,
    document.body,
  );
}

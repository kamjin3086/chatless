'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, File, Folder, RefreshCw } from 'lucide-react';

type NodeKind = 'dir' | 'file';

interface TreeNode {
  kind: NodeKind;
  name: string;
  path: string;
  children?: TreeNode[];
}

function norm(p: string): string {
  return String(p || '').replace(/\\/g, '/');
}

function basename(p: string): string {
  const n = norm(p);
  const parts = n.split('/').filter(Boolean);
  return parts[parts.length - 1] || n;
}

function shouldIgnore(name: string): boolean {
  const n = String(name || '');
  return (
    n === '.git' ||
    n === 'node_modules' ||
    n === '.venv' ||
    n === '__pycache__' ||
    n === '.DS_Store'
  );
}

function buildTreeFromEntries(root: string, entries: any[]): TreeNode {
  const rootNode: TreeNode = { kind: 'dir', name: basename(root), path: root, children: [] };
  const byPath = new Map<string, TreeNode>();
  byPath.set(norm(root), rootNode);

  const ensureDir = (dirPath: string): TreeNode => {
    const key = norm(dirPath);
    const existing = byPath.get(key);
    if (existing) return existing;
    const node: TreeNode = { kind: 'dir', name: basename(dirPath), path: dirPath, children: [] };
    byPath.set(key, node);
    return node;
  };

  const attach = (parent: TreeNode, child: TreeNode) => {
    parent.children = parent.children || [];
    if (!parent.children.some((c) => norm(c.path) === norm(child.path))) parent.children.push(child);
  };

  const rootKey = norm(root);
  for (const e of entries || []) {
    const p = String(e?.path || '');
    if (!p) continue;
    const key = norm(p);
    if (!key.startsWith(rootKey)) continue;

    const rel = key.slice(rootKey.length).replace(/^\/+/, '');
    const parts = rel.split('/').filter(Boolean);
    if (parts.some(shouldIgnore)) continue;

    let cur = rootNode;
    let curPath = rootKey;
    for (let i = 0; i < parts.length; i++) {
      curPath = curPath + '/' + parts[i];
      const isLast = i === parts.length - 1;
      const isDir =
        !isLast
          ? true
          : !!e?.isDirectory || !!e?.isDir || e?.kind === 'dir' || !!e?.children;
      if (isLast && !isDir) {
        const f: TreeNode = { kind: 'file', name: parts[i], path: p };
        attach(cur, f);
      } else {
        const d = ensureDir(curPath);
        attach(cur, d);
        cur = d;
      }
    }
  }

  const sortRec = (node: TreeNode) => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sortRec(c);
  };
  sortRec(rootNode);

  return rootNode;
}

interface SkillFileTreeProps {
  rootPath: string;
  onRefresh?: () => void;
}

export function SkillFileTree({ rootPath }: SkillFileTreeProps) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadTree = useCallback(async () => {
    const root = String(rootPath || '').trim();
    if (!root) return;
    setLoading(true);
    try {
      const { readDir } = await import('@tauri-apps/plugin-fs');

      const flat: any[] = [];
      const seen = new Set<string>();
      const queue: string[] = [root];

      while (queue.length > 0) {
        const dir = queue.shift()!;
        const dk = norm(dir);
        if (seen.has(dk)) continue;
        seen.add(dk);
        let list: any[] = [];
        try {
          list = (await readDir(dir)) as any[];
        } catch {
          list = [];
        }
        for (const e of list || []) {
          const p = String((e as any)?.path || '');
          if (!p) continue;
          flat.push(e);
          if ((e as any)?.isDirectory) {
            const name = String((e as any)?.name || '');
            if (shouldIgnore(name)) continue;
            queue.push(p);
          }
        }
      }

      const t = buildTreeFromEntries(root, flat as any[]);
      setTree(t);
      // 默认展开根节点
      setExpanded({ [norm(root)]: true });
    } catch {
      setTree(null);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    loadTree();
  }, [loadTree, refreshKey]);

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  const toggle = (p: string) => {
    const k = norm(p);
    setExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const k = norm(node.path);
    const isDir = node.kind === 'dir';
    const open = !!expanded[k];
    const pad = { paddingLeft: `${Math.min(depth, 10) * 12}px` };

    return (
      <div key={k}>
        <button
          type="button"
          onClick={() => {
            if (isDir) toggle(node.path);
          }}
          className={cn(
            'w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-800/50',
            isDir && 'cursor-pointer',
            !isDir && 'cursor-default'
          )}
          style={pad}
        >
          {isDir ? (
            <ChevronRight className={cn('h-3 w-3 text-slate-400 transition-transform flex-shrink-0', open && 'rotate-90')} />
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          {isDir ? (
            <Folder className="h-3.5 w-3.5 text-amber-500/80 flex-shrink-0" />
          ) : (
            <File className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
          )}
          <span className="truncate text-slate-600 dark:text-slate-300">{node.name}</span>
        </button>
        {isDir && open && node.children?.length ? (
          <div>
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      {/* 头部：刷新按钮 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-200/60 dark:border-slate-700/40">
        <span className="text-[10px] text-slate-400">
          {tree?.children?.length || 0} 项
        </span>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>
      
      {/* 文件列表 */}
      <div className="py-1">
        {loading ? (
          <div className="text-xs text-slate-400 py-3 text-center">读取中…</div>
        ) : !tree ? (
          <div className="text-xs text-slate-400 py-3 text-center">无法读取目录</div>
        ) : tree.children && tree.children.length > 0 ? (
          tree.children.map((c) => renderNode(c, 0))
        ) : (
          <div className="text-xs text-slate-400 py-3 text-center">空目录</div>
        )}
      </div>
    </div>
  );
}

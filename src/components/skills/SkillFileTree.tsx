'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, File, Folder, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MemoizedMarkdown } from '@/components/chat/MemoizedMarkdown';

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

    // create intermediate dirs
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

function isTextFile(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return (
    n.endsWith('.md') ||
    n.endsWith('.markdown') ||
    n.endsWith('.txt') ||
    n.endsWith('.json') ||
    n.endsWith('.yaml') ||
    n.endsWith('.yml') ||
    n.endsWith('.ts') ||
    n.endsWith('.tsx') ||
    n.endsWith('.js') ||
    n.endsWith('.jsx') ||
    n.endsWith('.rs') ||
    n.endsWith('.py') ||
    n.endsWith('.toml')
  );
}

export function SkillFileTree({ rootPath }: { rootPath: string }) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<TreeNode | null>(null);
  const [preview, setPreview] = useState<{ ok: boolean; content?: string; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const root = String(rootPath || '').trim();
      if (!root) return;
      setLoading(true);
      try {
        const { readDir } = await import('@tauri-apps/plugin-fs');

        // plugin-fs 的 readDir 类型不支持 recursive，这里手动递归遍历（并做简单忽略规则）
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
        if (!disposed) {
          setTree(t);
          setExpanded({ [norm(root)]: false });
        }
      } catch {
        if (!disposed) setTree(null);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [rootPath]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      if (!selectedFile || selectedFile.kind !== 'file') return;
      const p = selectedFile.path;
      setPreview(null);
      try {
        const { readTextFile, readFile } = await import('@tauri-apps/plugin-fs');
        if (!isTextFile(selectedFile.name)) {
          // binary-ish: just show size
          const buf = await readFile(p);
          if (!disposed) setPreview({ ok: true, content: `（非文本文件，大小：${(buf?.byteLength ?? 0)} bytes）` });
          return;
        }
        const txt = await readTextFile(p);
        const limited = txt.length > 60_000 ? txt.slice(0, 60_000) + '\n\n...（已截断）' : txt;
        if (!disposed) setPreview({ ok: true, content: limited });
      } catch (e) {
        if (!disposed) setPreview({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [selectedFile]);

  const rootKey = useMemo(() => norm(rootPath), [rootPath]);

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
            else setSelectedFile(node);
          }}
          className={cn(
            'w-full flex items-center gap-2 rounded-md px-2 py-1 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800',
            !isDir && selectedFile && norm(selectedFile.path) === k && 'bg-gray-100 dark:bg-gray-800'
          )}
          style={pad}
        >
          {isDir ? (
            <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open && 'rotate-90')} />
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
          {isDir ? <Folder className="h-3.5 w-3.5 text-gray-400" /> : <File className="h-3.5 w-3.5 text-gray-400" />}
          <span className="truncate">{node.name}</span>
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-gray-500">文件树</div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => {
            setExpanded((prev) => ({ ...prev, [rootKey]: !prev[rootKey] }));
          }}
          disabled={!tree || loading}
        >
          {expanded[rootKey] ? '折叠' : '展开'}
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="max-h-[240px] overflow-auto p-2">
          {loading ? (
            <div className="text-xs text-gray-400 px-2 py-4">读取中…</div>
          ) : !tree ? (
            <div className="text-xs text-gray-400 px-2 py-4">无法读取文件树</div>
          ) : (
            <div className="space-y-0.5">
              {renderNode(tree, 0)}
            </div>
          )}
        </div>
        <div className="border-t p-3">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
            <FileText className="h-3.5 w-3.5" />
            <span className="truncate">{selectedFile?.name ? `预览：${selectedFile.name}` : '选择一个文件以预览'}</span>
          </div>
          {preview?.ok && typeof preview.content === 'string' ? (
            <MemoizedMarkdown content={`\`\`\`\n${preview.content}\n\`\`\``} sizeOverride="small" className="max-w-none" />
          ) : preview?.ok === false ? (
            <div className="text-xs text-red-500">{preview.error || '预览失败'}</div>
          ) : (
            <div className="text-xs text-gray-400">—</div>
          )}
        </div>
      </div>
    </div>
  );
}


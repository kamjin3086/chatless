"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { PromptItem, PromptVariableDefinition, PromptHistory } from '@/types/prompt';
import { X, History, Star, Copy, Trash2, RotateCcw } from 'lucide-react';
import { usePromptStore } from '@/store/promptStore';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

interface PromptEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<PromptItem> | null;
  onSubmit: (data: Omit<PromptItem, 'id' | 'createdAt' | 'updatedAt' | 'stats'> & { id?: string }) => void;
  onDelete?: () => void;
  onToggleFavorite?: () => void;
}

export function PromptEditorDialog({ open, onOpenChange, initial, onSubmit, onDelete, onToggleFavorite }: PromptEditorDialogProps) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [content, setContent] = useState(initial?.content || '');
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [tags, setTags] = useState<string[]>(initial?.tags || []);
  const [shortcuts, setShortcuts] = useState<string[]>(initial?.shortcuts || []);
  const [showHistory, setShowHistory] = useState(false);
  
  const getHistory = usePromptStore((s) => s.getHistory);
  
  const promptId = (initial as any)?.id;
  const isEditing = !!promptId;
  const history = useMemo(() => promptId ? getHistory(promptId) : [], [promptId, getHistory]);

  useEffect(() => {
    if (open) {
      setName(initial?.name || '');
      setDescription(initial?.description || '');
      setContent(initial?.content || '');
      setTags(initial?.tags || []);
      setShortcuts(initial?.shortcuts || []);
      setShowHistory(false);
    }
  }, [open, initial]);

  // Token 估算
  const tokenEstimate = useMemo(() => {
    const plain = content || '';
    if (!plain) return 0;
    const chineseChars = plain.replace(/[\x00-\x7F]/g, '').length;
    const englishChars = plain.length - chineseChars;
    return Math.round(chineseChars + englishChars / 4);
  }, [content]);

  // 从内容中提取变量
  const deriveVariables = (text: string): PromptVariableDefinition[] => {
    const re = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
    const map = new Map<string, PromptVariableDefinition>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const key = m[1];
      const d1 = m[2]; const d2 = m[3]; const d3 = m[4];
      const def = (d1 ?? d2 ?? (d3 ? String(d3).trim() : ''));
      if (key && !map.has(key)) {
        map.set(key, { key, type: 'string', defaultValue: def });
      }
    }
    return Array.from(map.values());
  };

  const handleSubmit = () => {
    if (!name.trim() || !content.trim()) return;
    const autoVariables = deriveVariables(content);
    onSubmit({
      id: promptId,
      name: name.trim(),
      description: description.trim(),
      content: content,
      tags,
      languages: [],
      modelHints: [],
      variables: autoVariables,
      favorite: initial?.favorite || false,
      shortcuts,
    });
    onOpenChange(false);
  };

  // 变量高亮渲染
  const highlighted = useMemo(() => {
    const re = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
    const esc = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    let last = 0; let out = '';
    const src = content || '';
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      const raw = esc(m[0]);
      out += `<span class="rounded-sm bg-amber-100/70 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">${raw}</span>`;
      last = m.index + m[0].length;
    }
    out += esc(src.slice(last));
    return out.replace(/\n/g, '<br/>');
  }, [content]);

  const syncScroll = () => {
    if (!contentRef.current || !previewRef.current) return;
    previewRef.current.scrollTop = contentRef.current.scrollTop;
  };

  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));
  const removeShortcut = (s: string) => setShortcuts(prev => prev.filter(x => x !== s));

  const handleTagInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement;
    if (e.key === 'Enter' && target.value.trim()) {
      e.preventDefault();
      setTags((prev) => Array.from(new Set([...prev, target.value.trim()])));
      target.value = '';
    }
  };

  const handleShortcutInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const target = e.currentTarget;
    if (e.key === 'Enter' && target.value.trim()) {
      e.preventDefault();
      const val = target.value.trim().replace(/^\//,'').toLowerCase();
      setShortcuts((prev) => Array.from(new Set([...prev, val])));
      target.value = '';
    }
  };

  const handleCopyContent = () => {
    navigator.clipboard.writeText(content);
    toast.success('已复制内容');
  };

  const handleRestoreHistory = (h: PromptHistory) => {
    setName(h.name);
    setContent(h.content);
    setDescription(h.description || '');
    setTags(h.tags || []);
    setShortcuts(h.shortcuts || []);
    setShowHistory(false);
    toast.success('已恢复历史版本');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 max-h-[85vh] flex flex-col overflow-hidden [&>button]:hidden">
        {/* 头部 */}
        <div className="flex-shrink-0 p-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {isEditing ? '编辑提示词' : '新建提示词'}
            </h2>
            <div className="flex items-center gap-1">
              {/* 历史按钮 - 仅编辑模式 */}
              {isEditing && history.length > 0 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={cn(
                    "w-7 h-7 rounded flex items-center justify-center transition-colors",
                    showHistory 
                      ? "text-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                      : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  )}
                  title={`查看历史 (${history.length})`}
                >
                  <History className="w-4 h-4" />
                </button>
              )}
              {/* 关闭 */}
              <button
                onClick={() => onOpenChange(false)}
                className="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 历史面板 */}
        {showHistory && history.length > 0 && (
          <div className="flex-shrink-0 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3 max-h-48 overflow-y-auto">
            <div className="text-[10px] text-slate-400 mb-2">修改历史 (最近 {history.length} 次)</div>
            <div className="space-y-1.5">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between p-2 rounded bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/40">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{h.name}</div>
                    <div className="text-[10px] text-slate-400">
                      {new Date(h.savedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestoreHistory(h)}
                    className="h-6 px-2 text-[10px] text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    恢复
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 名称 */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-600 dark:text-slate-400">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="提示词名称"
              className="w-full h-8 px-3 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>

          {/* 描述 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-600 dark:text-slate-400">描述</label>
              <span className="text-[10px] text-slate-400">可选</span>
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要说明用途"
              className="w-full h-8 px-3 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>

          {/* 内容 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-600 dark:text-slate-400">内容</label>
              <span className="text-[10px] text-slate-400">≈ {tokenEstimate} tokens · 用 {'{{变量}}'} 定义变量</span>
            </div>
            <div className="relative rounded-lg border border-slate-200/60 dark:border-slate-700/40 bg-white/80 dark:bg-slate-800/60 min-h-[180px]">
              <div
                ref={previewRef}
                className="absolute inset-0 overflow-auto p-3 text-xs leading-5 whitespace-pre-wrap pointer-events-none select-none text-slate-700 dark:text-slate-200 font-mono"
                dangerouslySetInnerHTML={{ __html: highlighted || '<span class="text-slate-400">输入提示词内容...</span>' }}
              />
              <textarea
                ref={contentRef as any}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onScroll={syncScroll}
                className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none p-3 text-xs leading-5 text-transparent selection:bg-blue-500/20 caret-blue-500 font-mono min-h-[180px]"
              />
            </div>
          </div>

          {/* 标签和快捷指令 - 两列布局 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 标签 */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-600 dark:text-slate-400">标签</label>
              <input
                onKeyDown={handleTagInput}
                placeholder="回车添加"
                className="w-full h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                      {t}
                      <button onClick={() => removeTag(t)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 快捷指令 */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-600 dark:text-slate-400">快捷指令</label>
              <input
                onKeyDown={handleShortcutInput}
                placeholder="/指令名"
                className="w-full h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
              />
              {shortcuts.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {shortcuts.map((s) => (
                    <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-mono">
                      /{s}
                      <button onClick={() => removeShortcut(s)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="flex-shrink-0 p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center justify-between">
            {/* 左侧操作 */}
            <div className="flex items-center gap-1">
              {isEditing && (
                <>
                  {/* 收藏 */}
                  {onToggleFavorite && (
                    <button
                      onClick={onToggleFavorite}
                      className={cn(
                        "h-7 px-2 text-xs rounded flex items-center gap-1 transition-colors",
                        initial?.favorite 
                          ? "text-amber-500" 
                          : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      )}
                      title={initial?.favorite ? '取消收藏' : '收藏'}
                    >
                      <Star className={cn("w-3.5 h-3.5", initial?.favorite && "fill-current")} />
                    </button>
                  )}
                  {/* 复制 */}
                  <button
                    onClick={handleCopyContent}
                    className="h-7 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded flex items-center gap-1 transition-colors"
                    title="复制内容"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {/* 删除 */}
                  {onDelete && (
                    <button
                      onClick={onDelete}
                      className="h-7 px-2 text-xs text-slate-400 hover:text-red-500 rounded flex items-center gap-1 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
            
            {/* 右侧按钮 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenChange(false)}
                className="h-7 px-3 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!name.trim() || !content.trim()}
                className="h-7 px-4 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

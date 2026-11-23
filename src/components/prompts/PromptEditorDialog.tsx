"use client";

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { PromptItem, PromptVariableDefinition, PromptHistory } from '@/types/prompt';
import { X, History, Star, Copy, Trash2, RotateCcw } from 'lucide-react';
import { usePromptStore } from '@/store/promptStore';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { getHtmlLang } from '@/i18n';
import { useTranslation } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/store/localeStore';

interface PromptEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<PromptItem> | null;
  onSubmit: (data: Omit<PromptItem, 'id' | 'createdAt' | 'updatedAt' | 'stats'> & { id?: string }) => void;
  onDelete?: () => void;
  onToggleFavorite?: () => void;
}

export function PromptEditorDialog({ open, onOpenChange, initial, onSubmit, onDelete, onToggleFavorite }: PromptEditorDialogProps) {
  const t = useTranslation();
  const language = getHtmlLang(useLocaleStore((state) => state.locale));
  const fieldId = useId();
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
  const historyCount = history.length.toLocaleString(language);

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
      out += `<span class="rounded-sm bg-slate-200/60 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200">${raw}</span>`;
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
      const val = target.value.trim().replace(/^[#/]/,'').toLowerCase();
      setShortcuts((prev) => Array.from(new Set([...prev, val])));
      target.value = '';
    }
  };

  const handleCopyContent = () => {
    navigator.clipboard.writeText(content);
    toast.success(t('prompts.editor.copied'));
  };

  const handleRestoreHistory = (h: PromptHistory) => {
    setName(h.name);
    setContent(h.content);
    setDescription(h.description || '');
    setTags(h.tags || []);
    setShortcuts(h.shortcuts || []);
    setShowHistory(false);
    toast.success(t('prompts.editor.restored'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        closeLabel={t('common.close')}
        className="max-w-xl p-0 max-h-[85vh] flex flex-col overflow-hidden [&>button]:hidden"
      >
        {/* 头部 */}
        <div className="flex-shrink-0 p-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {t(isEditing ? 'prompts.editor.editTitle' : 'prompts.editor.createTitle')}
            </DialogTitle>
            <div className="flex items-center gap-1">
              {/* 历史按钮 - 仅编辑模式 */}
              {isEditing && history.length > 0 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={cn(
                    "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
                    showHistory 
                      ? "text-slate-700 bg-slate-200/50 dark:text-slate-200 dark:bg-slate-700/50" 
                      : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/60"
                  )}
                  title={t('prompts.editor.viewHistory').replace('{0}', historyCount)}
                >
                  <History className="w-4 h-4" />
                </button>
              )}
              {/* 关闭 */}
              <button
                aria-label={t('prompts.editor.close')}
                onClick={() => onOpenChange(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 历史面板 */}
        {showHistory && history.length > 0 && (
          <div className="flex-shrink-0 border-b border-slate-200/40 dark:border-slate-700/40 glass-inset p-3 max-h-48 overflow-y-auto">
            <div className="text-[10px] text-slate-400 mb-2">
              {t(history.length === 1 ? 'prompts.editor.history.one' : 'prompts.editor.history.other')
                .replace('{0}', historyCount)}
            </div>
            <div className="space-y-1.5">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between p-2 rounded-lg glass-inset border border-slate-200/40 dark:border-slate-700/40">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{h.name}</div>
                    <div className="text-[10px] text-slate-400">
                      {new Date(h.savedAt).toLocaleString(language)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestoreHistory(h)}
                    className="h-6 px-2 text-[10px] text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-700/50 rounded-md flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {t('prompts.editor.restore')}
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
            <label htmlFor={`${fieldId}-name`} className="text-xs text-slate-600 dark:text-slate-400">{t('prompts.name')}</label>
            <input
              id={`${fieldId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('prompts.editor.namePlaceholder')}
              className="glass-field w-full h-8 px-3 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400/30"
            />
          </div>

          {/* 描述 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={`${fieldId}-description`} className="text-xs text-slate-600 dark:text-slate-400">{t('prompts.editor.description')}</label>
              <span className="text-[10px] text-slate-400">{t('prompts.editor.optional')}</span>
            </div>
            <input
              id={`${fieldId}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('prompts.editor.descriptionPlaceholder')}
              className="glass-field w-full h-8 px-3 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400/30"
            />
          </div>

          {/* 内容 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={`${fieldId}-content`} className="text-xs text-slate-600 dark:text-slate-400">{t('prompts.editor.content')}</label>
              <span className="text-[10px] text-slate-400">
                {t('prompts.editor.tokenEstimate').replace('{0}', tokenEstimate.toLocaleString(language))}
              </span>
            </div>
            <div className="relative rounded-lg border border-slate-200/50 dark:border-slate-700/40 glass-field min-h-[180px]">
              <div
                ref={previewRef}
                className="absolute inset-0 overflow-auto p-3 text-xs leading-5 whitespace-pre-wrap pointer-events-none select-none text-slate-700 dark:text-slate-200 font-mono"
                dangerouslySetInnerHTML={highlighted ? { __html: highlighted } : undefined}
              >
                {highlighted ? null : <span className="text-slate-400">{t('prompts.editor.contentPlaceholder')}</span>}
              </div>
              <textarea
                id={`${fieldId}-content`}
                ref={contentRef as any}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onScroll={syncScroll}
                className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none p-3 text-xs leading-5 text-transparent selection:bg-slate-400/25 caret-slate-600 dark:caret-slate-300 font-mono min-h-[180px]"
              />
            </div>
          </div>

          {/* 标签和快捷指令 - 两列布局 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 标签 */}
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-tags`} className="text-xs text-slate-600 dark:text-slate-400">{t('prompts.editor.tags')}</label>
              <input
                id={`${fieldId}-tags`}
                onKeyDown={handleTagInput}
                placeholder={t('prompts.editor.tagPlaceholder')}
                className="glass-field w-full h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400/30"
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-md border border-slate-200/60 bg-slate-100/60 dark:border-slate-600/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300">
                      {tag}
                      <button aria-label={t('prompts.editor.removeTag')} onClick={() => removeTag(tag)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 快捷指令 */}
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-shortcuts`} className="text-xs text-slate-600 dark:text-slate-400">{t('prompts.editor.shortcuts')}</label>
              <input
                id={`${fieldId}-shortcuts`}
                onKeyDown={handleShortcutInput}
                placeholder={t('prompts.editor.shortcutPlaceholder')}
                className="glass-field w-full h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400/30"
              />
              {shortcuts.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {shortcuts.map((s) => (
                    <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-md border border-slate-200/70 bg-slate-100/70 text-slate-600 dark:border-slate-600/50 dark:bg-slate-800/40 dark:text-slate-300 font-mono">
                      #{s}
                      <button aria-label={t('prompts.editor.removeShortcut')} onClick={() => removeShortcut(s)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="flex-shrink-0 p-3 border-t border-slate-200/40 dark:border-slate-700/40 glass-dialog-footer">
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
                        "h-7 px-2 text-xs rounded-md flex items-center gap-1 transition-colors",
                        initial?.favorite 
                          ? "text-slate-600 dark:text-slate-300" 
                          : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      )}
                      title={t(initial?.favorite ? 'prompts.removeFavorite' : 'prompts.addFavorite')}
                    >
                      <Star className={cn("w-3.5 h-3.5", initial?.favorite && "fill-current")} />
                    </button>
                  )}
                  {/* 复制 */}
                  <button
                    onClick={handleCopyContent}
                    className="h-7 px-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md flex items-center gap-1 transition-colors"
                    title={t('prompts.editor.copyContent')}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {/* 删除 */}
                  {onDelete && (
                    <button
                      onClick={onDelete}
                      className="h-7 px-2 text-xs text-slate-400 hover:text-red-500 rounded-md flex items-center gap-1 transition-colors"
                      title={t('common.delete')}
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
                className="h-7 px-3 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!name.trim() || !content.trim()}
                className="h-7 px-4 text-xs bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('prompts.editor.save')}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

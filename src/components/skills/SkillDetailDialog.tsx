'use client';

import { useState, useEffect } from 'react';
import type { Skill } from '@/lib/skills/types';
import { SkillStatusBadge } from './SkillStatusBadge';
import { SkillMdRenderer } from './SkillMdRenderer';
import { SkillFileTree } from './SkillFileTree';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Trash2,
  FolderOpen,
  ExternalLink,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { getSkillManager } from '@/lib/skills';
import { FileOpener } from '@/lib/utils/fileOpener';
import { cn } from '@/lib/utils';

interface SkillDetailDialogProps {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUninstall?: (skill: Skill) => void;
  onToggleEnabled?: (skill: Skill, enabled: boolean) => void;
  onOpenFolder?: (skill: Skill) => void;
}

export function SkillDetailDialog({
  skill,
  open,
  onOpenChange,
  onUninstall,
  onToggleEnabled,
  onOpenFolder,
}: SkillDetailDialogProps) {
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showFileTree, setShowFileTree] = useState(false);

  const isInstalled = skill?.status === 'installed' || skill?.status === 'needs_update';
  const isLocal = skill?.source === 'local';

  // 检测是否为 Git 仓库
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        if (!open || !isLocal || !skill?.path) return;
        const { exists } = await import('@tauri-apps/plugin-fs');
        const { join } = await import('@tauri-apps/api/path');
        const p = await join(skill.path, '.git');
        const ok = await exists(p);
        if (!disposed) setIsGitRepo(!!ok);
      } catch {
        if (!disposed) setIsGitRepo(false);
      }
    })();
    return () => { disposed = true; };
  }, [open, isLocal, skill?.path]);

  // 提前返回放在所有 Hooks 之后
  if (!skill) return null;

  const handleUninstall = () => {
    onUninstall?.(skill);
    onOpenChange(false);
  };

  const handleToggleEnabled = (checked: boolean) => {
    onToggleEnabled?.(skill, checked);
  };

  const handleOpenFolder = () => {
    try {
      if (skill.path) {
        void FileOpener.openDirectory(skill.path);
      } else {
        onOpenFolder?.(skill);
      }
    } catch {
      onOpenFolder?.(skill);
    }
  };

  const handleOpenRepo = () => {
    if (skill.repoUrl) {
      window.open(skill.repoUrl, '_blank');
    }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(skill.id);
    toast.success('已复制技能 ID');
  };

  const handleCheckUpdate = async () => {
    if (!isLocal || !skill.path) return;
    setIsUpdating(true);
    try {
      const manager = getSkillManager();
      const r = await manager.updateSkillFromGit(skill.id);
      if (r.ok) toast.success('更新完成');
      else toast.error('更新失败', { description: r.message });
    } catch (e) {
      toast.error('更新失败', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReinstallFromZip = async () => {
    if (!isLocal) return;
    setIsUpdating(true);
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await openDialog({
        title: `选择 ZIP 文件覆盖安装`,
        filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      const manager = getSkillManager();
      const r = await manager.reinstallSkillFromZip(skill.id, selected);
      if (r.ok) toast.success('覆盖安装完成');
      else toast.error('覆盖安装失败', { description: r.message });
    } catch (e) {
      toast.error('覆盖安装失败', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 max-h-[85vh] flex flex-col overflow-hidden [&>button]:hidden">
        {/* 头部 - 固定 */}
        <div className="flex-shrink-0 p-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-start gap-3">
            {/* 图标 */}
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-5 w-5 text-violet-500 dark:text-violet-400" />
            </div>
            
            {/* 标题和版本 */}
            <div className="flex-1 min-w-0 pt-0.5">
              <h2 className="text-base font-medium text-slate-800 dark:text-slate-100 truncate">
                {skill.name}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                {skill.version && (
                  <span className="text-[11px] text-slate-400 font-mono">v{skill.version}</span>
                )}
                <SkillStatusBadge status={skill.status} />
              </div>
            </div>
            
            {/* 关闭按钮 */}
            <button
              onClick={() => onOpenChange(false)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          {/* 描述 */}
          {skill.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">{skill.description}</p>
          )}
        </div>

        {/* 内容区域 - 可滚动 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 文件树 - 可折叠 */}
          {isLocal && skill.path && (
            <div className="border border-slate-200/60 dark:border-slate-700/40 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowFileTree(!showFileTree)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                  <span>文件结构</span>
                </span>
                {showFileTree ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {showFileTree && (
                <div className="border-t border-slate-200/60 dark:border-slate-700/40 max-h-56 overflow-y-auto bg-slate-50/50 dark:bg-slate-800/30">
                  <SkillFileTree rootPath={skill.path} />
                </div>
              )}
            </div>
          )}

          {/* 文档内容 */}
          {skill.skillMdContent ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <SkillMdRenderer content={skill.skillMdContent} />
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-slate-400 bg-slate-50/50 dark:bg-slate-800/30 rounded-lg">
              暂无文档内容
            </div>
          )}

          {/* 元信息 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 bg-slate-50/80 dark:bg-slate-800/40 rounded-lg text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">ID</span>
              <span className="font-mono text-slate-600 dark:text-slate-300 truncate max-w-[120px]" title={skill.id}>{skill.id}</span>
            </div>
            {skill.author && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">作者</span>
                <span className="text-slate-600 dark:text-slate-300">{skill.author}</span>
              </div>
            )}
            {skill.installedAt && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">安装时间</span>
                <span className="text-slate-600 dark:text-slate-300">{new Date(skill.installedAt).toLocaleDateString()}</span>
              </div>
            )}
            {skill.source && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">来源</span>
                <span className="text-slate-600 dark:text-slate-300">{skill.source === 'local' ? '本地' : '在线'}</span>
              </div>
            )}
          </div>
        </div>

        {/* 底部操作区 - 固定 */}
        <div className="flex-shrink-0 p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center justify-between">
            {/* 左侧：启用开关 */}
            <div className="flex items-center gap-3">
              {isInstalled && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={handleToggleEnabled}
                    className="scale-90"
                  />
                  <span className="text-xs text-slate-500">{skill.enabled ? '已启用' : '已禁用'}</span>
                </label>
              )}
            </div>
            
            {/* 右侧：操作按钮 */}
            <div className="flex items-center gap-1.5">
              {/* 复制 ID */}
              <button
                onClick={handleCopyId}
                className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded flex items-center gap-1.5 transition-colors"
                title="复制 ID"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              
              {/* 打开文件夹 */}
              {isLocal && skill.path && (
                <button
                  onClick={handleOpenFolder}
                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded flex items-center gap-1.5 transition-colors"
                  title="打开文件夹"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              )}
              
              {/* 仓库链接 */}
              {skill.repoUrl && (
                <button
                  onClick={handleOpenRepo}
                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded flex items-center gap-1.5 transition-colors"
                  title="查看仓库"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
              
              {/* 更新按钮 */}
              {isLocal && skill.path && (
                <button
                  onClick={isGitRepo ? handleCheckUpdate : handleReinstallFromZip}
                  disabled={isUpdating}
                  className="h-7 px-2.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", isUpdating && "animate-spin")} />
                  <span>{isGitRepo ? '更新' : '重新导入'}</span>
                </button>
              )}
              
              {/* 卸载按钮 */}
              {isInstalled && (
                <button
                  onClick={handleUninstall}
                  className="h-7 px-2.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>卸载</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

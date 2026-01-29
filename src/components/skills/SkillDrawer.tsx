'use client';

import React, { useState, useEffect } from 'react';
import type { Skill } from '@/lib/skills/types';
import { SkillStatusBadge } from './SkillStatusBadge';
import { SkillMdRenderer } from './SkillMdRenderer';
import { SkillFileTree } from './SkillFileTree';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Trash2,
  FolderOpen,
  ExternalLink,
  MoreVertical,
  Copy,
  RefreshCw,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { getSkillManager } from '@/lib/skills';
import { FileOpener } from '@/lib/utils/fileOpener';

interface SkillDrawerProps {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall?: (skill: Skill) => void;
  onUninstall?: (skill: Skill) => void;
  onToggleEnabled?: (skill: Skill, enabled: boolean) => void;
  onOpenFolder?: (skill: Skill) => void;
  isInstalling?: boolean;
}

export function SkillDrawer({
  skill,
  open,
  onOpenChange,
  onInstall: _onInstall,
  onUninstall,
  onToggleEnabled,
  onOpenFolder,
  isInstalling: _isInstalling = false,
}: SkillDrawerProps) {
  if (!skill) {
    return null;
  }

  const isInstalled = skill.status === 'installed' || skill.status === 'needs_update';
  const isLocal = skill.source === 'local';
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // 判断该技能是否为 Git 安装（是否存在 .git）
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        if (!open || !isLocal || !skill.path) return;
        const { exists } = await import('@tauri-apps/plugin-fs');
        const { join } = await import('@tauri-apps/api/path');
        const p = await join(skill.path, '.git');
        const ok = await exists(p);
        if (!disposed) setIsGitRepo(!!ok);
      } catch {
        if (!disposed) setIsGitRepo(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [open, isLocal, skill.path]);

  const handleUninstall = () => {
    onUninstall?.(skill);
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
    toast.success('已复制技能 ID', { description: skill.id });
  };

  const handleCheckUpdate = async () => {
    if (!isLocal || !skill.path) return;
    setIsUpdating(true);
    try {
      const manager = getSkillManager();
      const r = await manager.updateSkillFromGit(skill.id);
      if (r.ok) toast.success('更新完成', { description: skill.name });
      else toast.error('更新失败', { description: r.message || skill.name });
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
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        title: `选择 ZIP 文件以覆盖安装：${skill.name}`,
        filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      const manager = getSkillManager();
      const r = await manager.reinstallSkillFromZip(skill.id, selected);
      if (r.ok) toast.success('覆盖安装完成', { description: skill.name });
      else toast.error('覆盖安装失败', { description: r.message || skill.name });
    } catch (e) {
      toast.error('覆盖安装失败', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideCloseButton className="w-full sm:max-w-lg flex flex-col">
        {/* 头部 */}
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-start gap-4">
            {/* 标题和版本 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <SheetTitle className="truncate">{skill.name}</SheetTitle>
                {skill.version && (
                  <span className="flex-shrink-0 text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                    v{skill.version}
                  </span>
                )}
              </div>
              <SheetDescription className="mt-1">
                {skill.description || '暂无描述'}
              </SheetDescription>
            </div>

            {/* 右上角下拉菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="flex-shrink-0 h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">操作菜单</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {isLocal && skill.path && (
                  <DropdownMenuItem onClick={handleOpenFolder}>
                    <FolderOpen className="h-4 w-4 mr-2" />
                    打开文件夹
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleCopyId}>
                  <Copy className="h-4 w-4 mr-2" />
                  复制技能 ID
                </DropdownMenuItem>
                {(isLocal && skill.path) ? (
                  <>
                    <DropdownMenuSeparator />
                    {isGitRepo ? (
                      <DropdownMenuItem onClick={handleCheckUpdate} disabled={isUpdating}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        更新（git pull）
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={handleReinstallFromZip} disabled={isUpdating}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        重新导入覆盖
                      </DropdownMenuItem>
                    )}
                    {skill.repoUrl && (
                      <DropdownMenuItem onClick={handleOpenRepo}>
                        <ExternalLink className="h-4 w-4 mr-2" />
                        查看仓库
                      </DropdownMenuItem>
                    )}
                  </>
                ) : null}
                {isInstalled && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={handleUninstall}
                      className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      卸载技能
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 状态和启用开关 */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <SkillStatusBadge status={skill.status} />
            
            {isInstalled && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">启用</span>
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={handleToggleEnabled}
                />
              </div>
            )}
          </div>
        </SheetHeader>

        {/* 内容 */}
        <SheetBody className="flex-1 overflow-y-auto">
          {/* 文件树（默认折叠，支持预览） */}
          {isLocal && skill.path && (
            <details className="mb-6">
              <summary className="cursor-pointer select-none text-xs font-medium text-gray-500">
                文件树（点击展开）
              </summary>
              <div className="mt-3">
                <SkillFileTree rootPath={skill.path} />
              </div>
            </details>
          )}

          {/* 文档（标准 Markdown 渲染，自动剥离 frontmatter） */}
          {skill.skillMdContent ? (
            <SkillMdRenderer content={skill.skillMdContent} />
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">
              暂无文档内容
            </div>
          )}

          {/* 小号信息：放在文档下方，避免抢占注意力 */}
          <div className="mt-6 text-[11px] text-gray-500 space-y-1">
            <div>技能 ID：{skill.id}</div>
            {skill.installedAt ? <div>安装时间：{new Date(skill.installedAt).toLocaleString()}</div> : null}
            {skill.path ? <div className="truncate" title={skill.path}>路径：{skill.path}</div> : null}
          </div>
        </SheetBody>

        {/* 底部操作 */}
        <SheetFooter className="flex-shrink-0">
          {/* 交互收敛：操作统一放到右上角三点菜单 */}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}


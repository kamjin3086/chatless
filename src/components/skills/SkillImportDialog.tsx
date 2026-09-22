'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getSkillManager } from '@/lib/skills';
import { ensureAllowlistedDirectory } from '@/lib/filesystemAllowlist';
import { linkOpener } from '@/lib/utils/linkOpener';
import {
  FileArchive,
  GitBranch,
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

interface SkillImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'zip' | 'git';
  onModeChange: (mode: 'zip' | 'git') => void;
  onSuccess: () => void;
}

export function SkillImportDialog({
  open,
  onOpenChange,
  mode,
  onModeChange,
  onSuccess,
}: SkillImportDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // ZIP 导入状态
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  // Git 克隆状态
  const [gitUrl, setGitUrl] = useState('');
  const [gitStatus, setGitStatus] = useState<{ ok: boolean; reason?: string; detail?: string; versionText?: string } | null>(null);

  // 重置状态
  const resetState = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setSelectedFile(null);
    setFileName(null);
    setGitUrl('');
  }, []);

  // 对话框打开时检查 Git 可用性
  useEffect(() => {
    if (open && mode === 'git') {
      checkGitAvailability();
    }
  }, [open, mode]);

  // 对话框关闭时重置状态
  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const checkGitAvailability = async () => {
    try {
      const manager = getSkillManager();
      const r = await manager.checkGitStatus();
      setGitStatus({ ok: r.ok, reason: r.reason, detail: r.detail, versionText: r.versionText });
    } catch (e) {
      setGitStatus({ ok: false, reason: 'not_found', detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const openGitInstallGuide = async () => {
    try {
      // 按你的要求：打开浏览器搜索 "git install"
      await linkOpener.openLink('https://www.google.com/search?q=git+install');
    } catch (e) {
      console.error('Failed to open browser:', e);
    }
  };

  // 选择 ZIP 文件
  const handleSelectZip = async () => {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await openDialog({
        title: '选择技能 ZIP 文件',
        filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
        multiple: false,
      });
      
      if (selected && typeof selected === 'string') {
        setSelectedFile(selected);
        // 提取文件名
        const name = selected.split(/[/\\]/).pop() || selected;
        setFileName(name);
        setError(null);

        // 自动授权“附件所在目录”（你选择了 attachments_dir 自动加入白名单）
        try {
          const normalized = selected.replace(/\\/g, '/');
          const idx = normalized.lastIndexOf('/');
          const parent = idx > 0 ? normalized.slice(0, idx) : normalized;
          void ensureAllowlistedDirectory({
            path: parent,
            source: 'attachment',
            permissions: { read: true, write: false, create: false, delete: false },
          });
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
      setError('打开文件选择对话框失败');
    }
  };

  // 从 ZIP 导入
  const handleImportZip = async () => {
    if (!selectedFile) {
      setError('请先选择 ZIP 文件');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const manager = getSkillManager();
      await manager.importFromZip(selectedFile);
      onSuccess();
    } catch (err) {
      console.error('Failed to import from ZIP:', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // 从 Git 克隆
  const handleCloneGit = async () => {
    if (!gitUrl.trim()) {
      setError('请输入 Git 仓库地址');
      return;
    }

    // 简单的 URL 验证
    if (!gitUrl.includes('github.com') && !gitUrl.includes('gitlab.com') && !gitUrl.includes('gitee.com') && !gitUrl.startsWith('git@')) {
      setError('请输入有效的 Git 仓库地址');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const manager = getSkillManager();
      await manager.cloneFromGit(gitUrl.trim());
      onSuccess();
    } catch (err) {
      console.error('Failed to clone from Git:', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入技能</DialogTitle>
          <DialogDescription>
            选择一种方式导入新的技能到本地
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => onModeChange(v as 'zip' | 'git')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="zip" className="text-sm">
              <FileArchive className="w-4 h-4 mr-1.5" />
              从 ZIP 导入
            </TabsTrigger>
            <TabsTrigger value="git" className="text-sm">
              <GitBranch className="w-4 h-4 mr-1.5" />
              从 Git 克隆
            </TabsTrigger>
          </TabsList>

          {/* ZIP 导入 */}
          <TabsContent value="zip" className="mt-4 space-y-4">
            <div
              onClick={handleSelectZip}
              className={cn(
                "flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
                selectedFile
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20"
                  : "border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600"
              )}
            >
              {selectedFile ? (
                <>
                  <CheckCircle className="w-8 h-8 text-emerald-500 mb-2" />
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {fileName}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">点击更换文件</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    点击选择 ZIP 文件
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    支持包含 SKILL.md 的技能压缩包
                  </p>
                </>
              )}
            </div>
          </TabsContent>

          {/* Git 克隆 */}
          <TabsContent value="git" className="mt-4 space-y-4">
            {gitStatus && gitStatus.ok === false && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    {gitStatus.reason === 'shell_plugin_missing' ? '无法使用 Git 克隆' : '未检测到 Git'}
                  </p>
                  <p className="text-amber-600 dark:text-amber-400 text-xs mt-0.5">
                    {gitStatus.reason === 'shell_plugin_missing'
                      ? '当前环境未启用 Shell 功能，无法执行 git 命令。'
                      : '请确保已安装 Git；如已安装但仍提示，点击“重新检测”。'}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={checkGitAvailability}
                      type="button"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                      重新检测
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={openGitInstallGuide}
                      type="button"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      安装 Git
                    </Button>
                  </div>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="git-url">仓库地址</Label>
              <Input
                id="git-url"
                placeholder="https://github.com/user/skill-repo.git"
                value={gitUrl}
                onChange={(e) => {
                  setGitUrl(e.target.value);
                  setError(null);
                }}
                disabled={isLoading || (gitStatus?.reason === 'shell_plugin_missing')}
              />
              <p className="text-xs text-gray-500">
                支持 GitHub、GitLab、Gitee 等 Git 仓库
              </p>
              {gitStatus?.ok && gitStatus.versionText && (
                <p className="text-[11px] text-gray-400">
                  检测到：{gitStatus.versionText}
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg text-sm">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            取消
          </Button>
          <Button
            onClick={mode === 'zip' ? handleImportZip : handleCloneGit}
            disabled={
              isLoading ||
              (mode === 'zip' && !selectedFile) ||
              (mode === 'git' && (!gitUrl.trim() || (gitStatus?.ok === false)))
            }
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                {mode === 'zip' ? '导入中...' : '克隆中...'}
              </>
            ) : (
              <>
                {mode === 'zip' ? '导入' : '克隆'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


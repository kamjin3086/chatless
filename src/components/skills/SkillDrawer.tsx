'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Skill } from '@/lib/skills/types';
import { SkillStatusBadge } from './SkillStatusBadge';
import { SkillMdRenderer } from './SkillMdRenderer';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sparkles,
  Download,
  Trash2,
  FolderOpen,
  ExternalLink,
  CheckCircle,
  XCircle,
  User,
  Tag,
  Clock,
  FileText,
  Terminal,
  AlertCircle,
  Info,
  AlertTriangle,
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
import { getSkillExecutor, type ExecutionLogEntry } from '@/lib/skills';

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

/**
 * 日志级别图标映射
 */
const LOG_LEVEL_CONFIG: Record<ExecutionLogEntry['level'], {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}> = {
  info: {
    icon: Info,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  warn: {
    icon: AlertTriangle,
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
  },
  success: {
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
};

/**
 * 执行日志条目组件
 */
const LogEntry: React.FC<{ entry: ExecutionLogEntry }> = ({ entry }) => {
  const config = LOG_LEVEL_CONFIG[entry.level];
  const Icon = config.icon;
  const time = new Date(entry.timestamp).toLocaleTimeString();
  
  return (
    <div className={cn("flex items-start gap-2 p-2 rounded-lg text-xs", config.bgColor)}>
      <Icon className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", config.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">{time}</span>
          <span className="text-gray-700 dark:text-gray-300">{entry.message}</span>
        </div>
        {entry.data && (
          <pre className="mt-1 text-[10px] text-gray-500 overflow-x-auto">
            {JSON.stringify(entry.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

/**
 * 执行日志面板组件
 */
const ExecutionLogsPanel: React.FC<{ skillId: string }> = ({ skillId }) => {
  const [logs, setLogs] = useState<ExecutionLogEntry[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  
  // 定期刷新日志
  useEffect(() => {
    const executor = getSkillExecutor();
    
    const updateLogs = () => {
      const allLogs = executor.getExecutionLogs();
      // 过滤当前技能的日志（通过 executionId 前缀）
      const filteredLogs = allLogs.filter(log => {
        // 日志是全局的，这里简单展示所有日志
        // 在实际实现中可能需要更精确的过滤
        return true;
      });
      setLogs(filteredLogs);
    };
    
    updateLogs();
    
    // 如果有活跃的执行，开启轮询
    const activeExecutions = executor.getActiveExecutions();
    if (activeExecutions.some(e => e.id.startsWith(skillId))) {
      setIsPolling(true);
      const interval = setInterval(updateLogs, 500);
      return () => clearInterval(interval);
    }
  }, [skillId]);
  
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Terminal className="w-8 h-8 mb-3 opacity-50" />
        <p className="text-sm">暂无执行日志</p>
        <p className="text-xs mt-1">技能执行时会在此显示日志</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-1.5">
      {logs.map((log, index) => (
        <LogEntry key={`${log.timestamp}-${index}`} entry={log} />
      ))}
    </div>
  );
};

export function SkillDrawer({
  skill,
  open,
  onOpenChange,
  onInstall,
  onUninstall,
  onToggleEnabled,
  onOpenFolder,
  isInstalling = false,
}: SkillDrawerProps) {
  if (!skill) {
    return null;
  }

  const isInstalled = skill.status === 'installed' || skill.status === 'needs_update';
  const isLocal = skill.source === 'local';

  const handleInstall = () => {
    onInstall?.(skill);
  };

  const handleUninstall = () => {
    onUninstall?.(skill);
  };

  const handleToggleEnabled = (checked: boolean) => {
    onToggleEnabled?.(skill, checked);
  };

  const handleOpenFolder = () => {
    onOpenFolder?.(skill);
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
    toast.info('正在检查更新...', { description: skill.name });
    // TODO: 实现 Git pull 检查更新
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
        {/* 头部 */}
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-start gap-4">
            {/* 图标 */}
            <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
              <Sparkles className="h-6 w-6" />
            </div>
            
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
                {skill.repoUrl && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleOpenRepo}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      查看仓库
                    </DropdownMenuItem>
                    {isLocal && (
                      <DropdownMenuItem onClick={handleCheckUpdate}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        检查更新
                      </DropdownMenuItem>
                    )}
                  </>
                )}
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
          {/* 元信息 */}
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            {skill.author && (
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <User className="h-4 w-4 text-gray-400" />
                <span>{skill.author}</span>
              </div>
            )}
            {skill.installedAt && (
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <Clock className="h-4 w-4 text-gray-400" />
                <span>{new Date(skill.installedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/* 标签 */}
          {skill.tags && skill.tags.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-1 mb-2 text-xs font-medium text-gray-500 uppercase">
                <Tag className="h-3 w-3" />
                <span>标签</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 依赖项 */}
          {skill.dependencies && skill.dependencies.length > 0 && (
            <div className="mb-6">
              <div className="text-xs font-medium text-gray-500 uppercase mb-2">
                依赖项
              </div>
              <div className="space-y-2">
                {skill.dependencies.map((dep, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {dep.name}
                      </span>
                      {dep.version && (
                        <span className="text-xs text-gray-400">
                          {dep.version}
                        </span>
                      )}
                    </div>
                    {dep.installed ? (
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 标签页：文档 / 执行日志 */}
          <Tabs defaultValue="docs" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="docs" className="text-xs">
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                文档
              </TabsTrigger>
              <TabsTrigger value="logs" className="text-xs">
                <Terminal className="w-3.5 h-3.5 mr-1.5" />
                执行日志
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="docs" className="mt-4">
              {skill.skillMdContent ? (
                <SkillMdRenderer content={skill.skillMdContent} />
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无文档内容</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="logs" className="mt-4">
              <ExecutionLogsPanel skillId={skill.id} />
            </TabsContent>
          </Tabs>
        </SheetBody>

        {/* 底部操作 */}
        <SheetFooter className="flex-shrink-0">
          <div className="flex items-center justify-between w-full gap-2">
            {/* 左侧操作 */}
            <div className="flex items-center gap-2">
              {isLocal && skill.path && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenFolder}
                >
                  <FolderOpen className="h-4 w-4 mr-1" />
                  打开目录
                </Button>
              )}
              {skill.repoUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenRepo}
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  查看仓库
                </Button>
              )}
            </div>

            {/* 右侧操作 */}
            <div className="flex items-center gap-2">
              {isInstalled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUninstall}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  卸载
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={isInstalling}
                >
                  {isInstalling ? (
                    <>安装中...</>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-1" />
                      安装
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}


'use client';

import { useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { useSkillStore } from '@/store/skillStore';
import { getSkillManager } from '@/lib/skills';
import type { Skill } from '@/lib/skills/types';
import { SkillGrid } from './SkillGrid';
import { SkillDrawer } from './SkillDrawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw,
  Search,
  Filter,
  Sparkles,
  FolderOpen,
  Plus,
  ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SkillImportDialog } from './SkillImportDialog';
import { toast } from '@/components/ui/sonner';

interface SkillsPageProps {
  className?: string;
}

export function SkillsPage({ className }: SkillsPageProps) {
  const {
    skills,
    isLoading,
    error,
    filterOptions,
    selectedSkillId,
    drawerOpen,
    setFilterOptions,
    openDrawer,
    closeDrawer,
    getFilteredSkills,
  } = useSkillStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<'zip' | 'git'>('zip');

  // 初始化
  useEffect(() => {
    const manager = getSkillManager();
    manager.initialize();
  }, []);

  // 刷新技能列表
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const manager = getSkillManager();
      await manager.refresh();
    } catch (err) {
      console.error('Failed to refresh skills:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // 点击技能卡片
  const handleSkillClick = useCallback((skill: Skill) => {
    openDrawer(skill.id);
  }, [openDrawer]);

  // 安装技能
  const handleInstall = useCallback(async (skill: Skill) => {
    setIsInstalling(true);
    try {
      const manager = getSkillManager();
      await manager.installSkill(skill.id);
    } catch (err) {
      console.error('Failed to install skill:', err);
    } finally {
      setIsInstalling(false);
    }
  }, []);

  // 卸载技能
  const handleUninstall = useCallback(async (skill: Skill) => {
    try {
      const manager = getSkillManager();
      await manager.uninstallSkill(skill.id);
      closeDrawer();
    } catch (err) {
      console.error('Failed to uninstall skill:', err);
    }
  }, [closeDrawer]);

  // 切换启用状态
  const handleToggleEnabled = useCallback((skill: Skill, enabled: boolean) => {
    const manager = getSkillManager();
    if (enabled) {
      manager.enableSkill(skill.id);
    } else {
      manager.disableSkill(skill.id);
    }
  }, []);

  // 打开技能目录
  const handleOpenFolder = useCallback(async (skill: Skill) => {
    if (!skill.path) return;
    try {
      const { open } = await import('@tauri-apps/plugin-opener');
      await open(skill.path);
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, []);

  // 打开技能文件夹（基础目录）
  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const manager = getSkillManager();
      await manager.openSkillsFolder();
    } catch (err) {
      console.error('Failed to open skills folder:', err);
      toast.error('打开文件夹失败', { description: String(err) });
    }
  }, []);

  // 导入技能
  const handleImport = useCallback((mode: 'zip' | 'git') => {
    setImportMode(mode);
    setImportDialogOpen(true);
  }, []);

  // 导入成功后刷新
  const handleImportSuccess = useCallback(async () => {
    setImportDialogOpen(false);
    await handleRefresh();
    toast.success('技能导入成功');
  }, [handleRefresh]);

  // 搜索处理
  const handleSearchChange = useCallback((value: string) => {
    setFilterOptions({ search: value });
  }, [setFilterOptions]);

  // 来源过滤
  const handleSourceChange = useCallback((value: string) => {
    setFilterOptions({ source: value as 'all' | 'local' | 'remote' });
  }, [setFilterOptions]);

  // 状态过滤
  const handleStatusChange = useCallback((value: string) => {
    setFilterOptions({ status: value as any });
  }, [setFilterOptions]);

  // 获取选中的技能
  const selectedSkill = skills.find(s => s.id === selectedSkillId) || null;

  // 获取筛选后的技能列表
  const filteredSkills = getFilteredSkills();

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 页面头部 */}
      <header className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                技能管理
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                管理和配置 AI 技能插件
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenSkillsFolder}
            >
              <FolderOpen className="h-4 w-4 mr-1" />
              打开文件夹
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  导入技能
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleImport('zip')}>
                  从 ZIP 导入
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleImport('git')}>
                  从 Git 克隆
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
            >
              <RefreshCw className={cn('h-4 w-4 mr-1', isRefreshing && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>

        {/* 搜索和筛选 */}
        <div className="flex items-center gap-4">
          {/* 搜索框 */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="搜索技能..."
              value={filterOptions.search || ''}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* 来源筛选 */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <Select
              value={filterOptions.source || 'all'}
              onValueChange={handleSourceChange}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                <SelectItem value="local">本地</SelectItem>
                <SelectItem value="remote">远程</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 状态筛选 */}
          <Select
            value={(filterOptions.status as string) || 'all'}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="installed">已安装</SelectItem>
              <SelectItem value="not_installed">未安装</SelectItem>
              <SelectItem value="needs_update">有更新</SelectItem>
              <SelectItem value="missing_deps">缺少依赖</SelectItem>
            </SelectContent>
          </Select>

          {/* 统计信息 */}
          <div className="text-sm text-gray-500 dark:text-gray-400">
            共 {filteredSkills.length} 个技能
            {skills.filter(s => s.enabled).length > 0 && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                • {skills.filter(s => s.enabled).length} 已启用
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 技能网格 */}
      <main className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-950">
        <SkillGrid
          skills={filteredSkills}
          selectedSkillId={selectedSkillId}
          onSkillClick={handleSkillClick}
          isLoading={isLoading}
          error={error}
        />
      </main>

      {/* 技能详情抽屉 */}
      <SkillDrawer
        skill={selectedSkill}
        open={drawerOpen}
        onOpenChange={(open) => !open && closeDrawer()}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        onToggleEnabled={handleToggleEnabled}
        onOpenFolder={handleOpenFolder}
        isInstalling={isInstalling}
      />

      {/* 导入对话框 */}
      <SkillImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        mode={importMode}
        onModeChange={setImportMode}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}


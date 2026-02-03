'use client';

import { useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { useSkillStore } from '@/store/skillStore';
import { getSkillManager } from '@/lib/skills';
import type { Skill } from '@/lib/skills/types';
import { SkillGrid } from './SkillGrid';
import { SkillDrawer } from './SkillDrawer';
import {
  RefreshCw,
  Search,
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
      {/* 紧凑工具栏 */}
      <header className="flex-shrink-0 h-10 px-3 border-b border-slate-200/50 dark:border-slate-700/30 flex items-center justify-between bg-white/90 dark:bg-slate-900/90">
        {/* 左侧：搜索 */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="搜索技能..."
            value={filterOptions.search || ''}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full h-7 pl-7 pr-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600"
          />
        </div>
        
        {/* 右侧：筛选 + 操作 */}
        <div className="flex items-center gap-1.5">
          {/* 来源筛选 */}
          <select
            value={filterOptions.source || 'all'}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none"
          >
            <option value="all">全部来源</option>
            <option value="local">本地</option>
          </select>

          {/* 状态筛选 */}
          <select
            value={(filterOptions.status as string) || 'all'}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none"
          >
            <option value="all">全部状态</option>
            <option value="installed">已安装</option>
            <option value="needs_update">有更新</option>
            <option value="missing_deps">缺少依赖</option>
          </select>

          {/* 统计 */}
          <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-1">
            {filteredSkills.length} 个
            {skills.filter(s => s.enabled).length > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400 ml-1">
                · {skills.filter(s => s.enabled).length} 启用
              </span>
            )}
          </span>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          {/* 打开文件夹 */}
          <button
            onClick={handleOpenSkillsFolder}
            className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded transition-colors flex items-center gap-1"
            title="打开技能文件夹"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          
          {/* 导入 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded transition-colors flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                <span>导入</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => handleImport('zip')} className="text-xs">
                从 ZIP 导入
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleImport('git')} className="text-xs">
                从 Git 克隆
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* 刷新 */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded transition-colors flex items-center gap-1 disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
          </button>
        </div>
      </header>

      {/* 技能网格 */}
      <main className="flex-1 overflow-y-auto p-4 bg-slate-50/80 dark:bg-slate-900/60">
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

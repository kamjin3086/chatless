'use client';

import { useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { useSkillStore } from '@/store/skillStore';
import { useLocaleStore } from '@/store/localeStore';
import { getSkillManager } from '@/lib/skills';
import type { Skill } from '@/lib/skills/types';
import { SkillGrid } from './SkillGrid';
import { SkillDetailDialog } from './SkillDetailDialog';
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
  const { t } = useLocaleStore();
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
      const opener = await import('@tauri-apps/plugin-opener');
      await opener.openPath(skill.path);
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
      toast.error(t('skills.openFolderFailed'), { description: String(err) });
    }
  }, [t]);

  // 导入技能
  const handleImport = useCallback((mode: 'zip' | 'git') => {
    setImportMode(mode);
    setImportDialogOpen(true);
  }, []);

  // 导入成功后刷新
  const handleImportSuccess = useCallback(async () => {
    setImportDialogOpen(false);
    await handleRefresh();
    toast.success(t('skills.import.done'));
  }, [handleRefresh, t]);

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
  const enabledCount = skills.filter((skill) => skill.enabled).length;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 紧凑工具栏 */}
      <header className="flex-shrink-0 h-10 px-3 border-b border-slate-200/50 dark:border-slate-700/30 flex items-center justify-between glass-surface">
        {/* 左侧：搜索 */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder={t('skills.search')}
            value={filterOptions.search || ''}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="glass-field w-full h-7 pl-7 pr-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400/30"
          />
        </div>
        
        {/* 右侧：筛选 + 操作 */}
        <div className="flex items-center gap-1.5">
          {/* 来源筛选 */}
          <select
            value={filterOptions.source || 'all'}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="glass-field h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400/30"
          >
            <option value="all">{t('skills.allSources')}</option>
            <option value="local">{t('skills.local')}</option>
          </select>

          {/* 状态筛选 */}
          <select
            value={(filterOptions.status as string) || 'all'}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="glass-field h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400/30"
          >
            <option value="all">{t('skills.allStatuses')}</option>
            <option value="installed">{t('skills.status.installed')}</option>
            <option value="needs_update">{t('skills.status.needsUpdate')}</option>
            <option value="missing_deps">{t('skills.status.missingDeps')}</option>
          </select>

          {/* 统计 */}
          <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-1">
            {t('skills.shownCount').replace('{0}', String(filteredSkills.length))}
            {enabledCount > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400 ml-1">
                · {t('skills.enabledCount').replace('{0}', String(enabledCount))}
              </span>
            )}
          </span>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          {/* 打开文件夹 */}
          <button
            onClick={handleOpenSkillsFolder}
            className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded-md transition-colors flex items-center gap-1"
            title={t('skills.openSkillsFolder')}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          
          {/* 导入 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded-md transition-colors flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                <span>{t('skills.import.action')}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => handleImport('zip')} className="text-xs">
                {t('skills.import.fromZip')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleImport('git')} className="text-xs">
                {t('skills.import.fromGit')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* 刷新 */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="h-7 px-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50"
            title={t('skills.refresh')}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
          </button>
        </div>
      </header>

      {/* 技能网格 */}
      <main className="flex-1 overflow-y-auto p-4 glass-surface">
        <SkillGrid
          skills={filteredSkills}
          selectedSkillId={selectedSkillId}
          onSkillClick={handleSkillClick}
          isLoading={isLoading}
          error={error}
        />
      </main>

      {/* 技能详情对话框 */}
      <SkillDetailDialog
        skill={selectedSkill}
        open={drawerOpen}
        onOpenChange={(open) => !open && closeDrawer()}
        onUninstall={handleUninstall}
        onToggleEnabled={handleToggleEnabled}
        onOpenFolder={handleOpenFolder}
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

"use client";

import { useState, useEffect } from "react";
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { NetworkSettings } from "./NetworkSettings";
import { ToggleSwitch } from "./ToggleSwitch";
import { startupMonitor } from "@/lib/utils/startupPerformanceMonitor";
import { downloadService } from "@/lib/utils/downloadService";
import { detectTauriEnvironment } from "@/lib/utils/environment";
import { toast } from "@/components/ui/sonner";
import { LogsIcon, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useTranslation } from "@/i18n/useTranslation";

export function AdvancedSettings() {
  const t = useTranslation();
  const [logLevel, setLogLevelState] = useState<'none'|'error'|'warn'|'info'|'debug'>('info');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 显示持久化的级别，避免界面显示“信息”而实际级别是调试。
    try {
      setLogLevelState(logger.getLogLevel() as 'none'|'error'|'warn'|'info'|'debug');
    } catch {
      /* 默认 info */
    }
  }, []);

  const handleLevelChange = async (val: string) => {
    const lvl = val as 'none'|'error'|'warn'|'info'|'debug';
    setLogLevelState(lvl);

    try {
      // 调试级别同时打开 LLM 请求体的 dump（见 @/lib/llm/debugLog）。
      await logger.setLogLevel(lvl);
      const isTauri = await detectTauriEnvironment();
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_log_level', { level: lvl });
        toast.success(`${t('settings.advanced.logLevelChanged')}: ${t(`settings.advanced.logLevel.${lvl}`)}`);
      }
    } catch (e) {
      console.warn('设置日志级别失败:', e);
    }
  };

  const exportLogs = async () => {
    setLoading(true);
    try {
      const isTauri = await detectTauriEnvironment();

      if (isTauri) {
        const { readDir, readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');

        const collectLogFiles = async (dir: string): Promise<string[]> => {
          const files: string[] = [];
          const list = await readDir(dir, { baseDir: BaseDirectory.AppLog });
          for (const entry of list) {
            const name = entry.name as string | undefined;
            if (!name) continue;
            if ((entry as any).isDirectory) {
              const subDir = dir ? `${dir}/${name}` : name;
              const subFiles = await collectLogFiles(subDir);
              files.push(...subFiles);
            } else {
              if (name.endsWith('.log') || name.endsWith('.txt') || !name.includes('.')) {
                const fullPath = dir ? `${dir}/${name}` : name;
                files.push(fullPath);
              }
            }
          }
          return files;
        };

        const logFilePaths = await collectLogFiles('');
        if (!logFilePaths || logFilePaths.length === 0) {
          toast.error(t('settings.advanced.logsNotFound'));
          return;
        }

        logFilePaths.sort((a, b) => b.localeCompare(a));

        let combined = '';
        for (const relPath of logFilePaths) {
          try {
            const content = await readTextFile(relPath, { baseDir: BaseDirectory.AppLog });
            combined += `\n===== ${relPath} =====\n${content}\n`;
          } catch (e) {
            console.warn('读取日志文件失败:', relPath, e);
          }
        }

        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const success = await downloadService.downloadText(`chatless-logs-${timestamp}.txt`, combined);
        if (success) toast.success(t('settings.advanced.logsExported'));
      }
    } catch (error) {
      console.error('导出日志失败:', error);
      toast.error(t('settings.advanced.exportFailed'));
    } finally {
      setLoading(false);
    }
  };

  const exportPerformanceReport = async () => {
    try {
      const report = startupMonitor.exportReport();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const success = await downloadService.downloadText(`performance-${timestamp}.txt`, report);
      if (success) toast.success(t('settings.advanced.reportExported'));
    } catch {
      toast.error(t('settings.advanced.exportFailed'));
    }
  };

  return (
    <div className="space-y-4">
      <SettingsPageHeader 
        title={t('settings.advanced.title')}
        description={t('settings.advanced.description')}
      />

      {/* 网络设置 */}
      <NetworkSettings />

      {/* 日志系统 */}
      <SettingsCard>
        <SettingsSectionHeader icon={LogsIcon} title={t('settings.advanced.logs')} />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-700 dark:text-slate-300">{t('settings.advanced.logLevel')}</span>
            <select
              value={logLevel}
              onChange={(e) => handleLevelChange(e.target.value)}
              className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="none">{t('settings.advanced.logLevel.none')}</option>
              <option value="error">{t('settings.advanced.logLevel.error')}</option>
              <option value="warn">{t('settings.advanced.logLevel.warn')}</option>
              <option value="info">{t('settings.advanced.logLevel.info')}</option>
              <option value="debug">{t('settings.advanced.logLevel.debug')}</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={exportLogs}
              disabled={loading}
              className={cn(
                "h-7 px-2 text-xs rounded-md flex items-center gap-1",
                "border border-slate-200/60 dark:border-slate-700/40",
                "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800",
                loading && "opacity-60"
              )}
            >
              <Download className="h-3 w-3" />
              {t('settings.advanced.exportLogs')}
            </button>
            <button
              onClick={exportPerformanceReport}
              className="h-7 px-2 text-xs rounded-md flex items-center gap-1 border border-slate-200/60 dark:border-slate-700/40 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="h-3 w-3" />
              {t('settings.advanced.performanceReport')}
            </button>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

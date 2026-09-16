"use client";

import { useState, useEffect } from "react";
import { SettingsCard, SettingsPageHeader } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { NetworkSettings } from "./NetworkSettings";
import { ToggleSwitch } from "./ToggleSwitch";
import { startupMonitor } from "@/lib/utils/startupPerformanceMonitor";
import { downloadService } from "@/lib/utils/downloadService";
import { detectTauriEnvironment } from "@/lib/utils/environment";
import { isCodingPackEnabled, setCodingPackEnabled } from "@/lib/codingPack/config";
import { toast } from "@/components/ui/sonner";
import { LogsIcon, Download, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

export function AdvancedSettings() {
  const [logLevel, setLogLevelState] = useState<'none'|'error'|'warn'|'info'|'debug'>('info');
  const [loading, setLoading] = useState(false);
  const [codingPackEnabled, setCodingPackEnabledState] = useState(false);
  const [labsLoading, setLabsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const enabled = await isCodingPackEnabled();
        setCodingPackEnabledState(enabled);
      } finally {
        setLabsLoading(false);
      }
    })();
  }, []);

  const handleCodingPackToggle = async (checked: boolean) => {
    setCodingPackEnabledState(checked);
    try {
      await setCodingPackEnabled(checked);
      toast.success(checked ? 'Coding Pack 已开启' : 'Coding Pack 已关闭');
    } catch (e) {
      setCodingPackEnabledState(!checked);
      toast.error('保存 Labs 设置失败');
      console.warn(e);
    }
  };

  const handleLevelChange = async (val: string) => {
    const lvl = val as 'none'|'error'|'warn'|'info'|'debug';
    setLogLevelState(lvl);

    try {
      const isTauri = await detectTauriEnvironment();
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_log_level', { level: lvl });
        toast.success(`日志级别: ${lvl}`);
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
          toast.error('未找到日志文件');
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
        if (success) toast.success('日志已导出');
      }
    } catch (error) {
      console.error('导出日志失败:', error);
      toast.error('导出失败');
    } finally {
      setLoading(false);
    }
  };

  const exportPerformanceReport = async () => {
    try {
      const report = startupMonitor.exportReport();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const success = await downloadService.downloadText(`performance-${timestamp}.txt`, report);
      if (success) toast.success('性能报告已导出');
    } catch {
      toast.error('导出失败');
    }
  };

  return (
    <div className="space-y-4">
      <SettingsPageHeader 
        title="高级设置" 
        description="网络代理、日志系统等高级选项。"
      />

      {/* 网络设置 */}
      <NetworkSettings />

      {/* Labs 实验功能 */}
      <SettingsCard>
        <SettingsSectionHeader icon={FlaskConical} title="Labs（实验功能）" />
        <div className="space-y-3">
          {!labsLoading && (
            <ToggleSwitch
              label="Coding Pack"
              description="默认关闭。开启后可使用项目挂载、glob/grep、patch 预览与受控 git/诊断；需会话挂载目录，写入走审批。"
              checked={codingPackEnabled}
              onChange={(checked) => void handleCodingPackToggle(checked)}
            />
          )}
          {labsLoading && (
            <p className="text-xs text-slate-500">加载 Labs 设置...</p>
          )}
        </div>
      </SettingsCard>

      {/* 日志系统 */}
      <SettingsCard>
        <SettingsSectionHeader icon={LogsIcon} title="日志系统" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-700 dark:text-slate-300">日志级别</span>
            <select
              value={logLevel}
              onChange={(e) => handleLevelChange(e.target.value)}
              className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="none">无</option>
              <option value="error">错误</option>
              <option value="warn">警告</option>
              <option value="info">信息</option>
              <option value="debug">调试</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={exportLogs}
              disabled={loading}
              className={cn(
                "h-7 px-2 text-xs rounded flex items-center gap-1",
                "border border-slate-200/60 dark:border-slate-700/40",
                "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800",
                loading && "opacity-60"
              )}
            >
              <Download className="h-3 w-3" />
              导出日志
            </button>
            <button
              onClick={exportPerformanceReport}
              className="h-7 px-2 text-xs rounded flex items-center gap-1 border border-slate-200/60 dark:border-slate-700/40 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="h-3 w-3" />
              性能报告
            </button>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

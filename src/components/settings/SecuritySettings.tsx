"use client";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { ShieldCheck } from 'lucide-react';
import { WorkspaceSettings } from "./WorkspaceSettings";
import { FileSystemAuthSettings } from "./FileSystemAuthSettings";
import { NativeToolAuthSettings } from "./NativeToolAuthSettings";
import { ShellAuthSettings } from "./ShellAuthSettings";

export function SecuritySettings() {
  return (
    <div className="space-y-6">
      <SettingsCard>
        <SettingsSectionHeader icon={ShieldCheck} title="安全设置" iconBgColor="from-amber-500 to-yellow-500" />
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          这里集中管理与“工具调用安全边界”相关的配置。重点包括：filesystem 白名单目录、shell 等高风险工具的人工确认等。
        </p>
      </SettingsCard>

      <NativeToolAuthSettings />
      <ShellAuthSettings />
      <WorkspaceSettings />
      <FileSystemAuthSettings />
    </div>
  );
} 
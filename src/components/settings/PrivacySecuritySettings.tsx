"use client";

import { SettingsPageHeader } from "./SettingsCard";
import { PrivacySettings } from "./PrivacySettings";
import { SecuritySettings } from "./SecuritySettings";

export function PrivacySecuritySettings() {
  return (
    <div className="space-y-4">
      <SettingsPageHeader 
        title="隐私安全" 
        description="数据保护、文件访问控制、命令执行授权等安全设置。"
      />
      <PrivacySettings />
      <SecuritySettings />
    </div>
  );
}

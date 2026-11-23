"use client";

import { SettingsPageHeader } from "./SettingsCard";
import { PrivacySettings } from "./PrivacySettings";
import { SecuritySettings } from "./SecuritySettings";
import { useTranslation } from "@/i18n/useTranslation";

export function PrivacySecuritySettings() {
  const t = useTranslation();
  return (
    <div className="space-y-4">
      <SettingsPageHeader 
        title={t('settings.privacySecurity.title')}
        description={t('settings.privacySecurity.description')}
      />
      <PrivacySettings />
      <SecuritySettings />
    </div>
  );
}

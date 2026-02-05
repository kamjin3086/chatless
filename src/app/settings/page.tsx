"use client";

import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { AiModelSettings } from "@/components/settings/AiModelSettings";
import { KnowledgeBaseSettings } from "@/components/settings/KnowledgeBaseSettings";
import { PrivacySecuritySettings } from "@/components/settings/PrivacySecuritySettings";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
import { AboutSupportSettings } from "@/components/settings/AboutSupportSettings";
import { WebSearchSettings } from "@/components/settings/WebSearchSettings";
import { WebDavSyncSettings } from "@/components/settings/WebDavSyncSettings";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
// 已移除 recordAboutViewed 存储，蓝点逻辑已简化为“存在可更新且未忽略”

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>("general");

  // 从URL参数中读取tab参数
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const renderContent = () => {
    switch (activeTab) {
      case "localModels":
        return <AiModelSettings />;
      case "knowledgeBase":
        return <KnowledgeBaseSettings />;
      case "general":
        return <GeneralSettings />;
      case "sync":
        return <WebDavSyncSettings />;
      case "webSearch":
        return <WebSearchSettings />;
      case "privacySecurity":
        return <PrivacySecuritySettings />;
      case "advanced":
        return <AdvancedSettings />;
      case "aboutSupport":
        return <AboutSupportSettings />;
      default:
        return <GeneralSettings />;
    }
  };

  return (
    <SettingsLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderContent()}
    </SettingsLayout>
  );
} 

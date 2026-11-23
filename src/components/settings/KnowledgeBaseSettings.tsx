"use client";

import { useState, useEffect } from 'react';
import { SettingsCard } from "./SettingsCard";
import { CollapsibleCard } from "./CollapsibleCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { ToggleSwitch } from "./ToggleSwitch";
import { InputField } from "./InputField";
import { toast } from "@/components/ui/sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { UniversalModelManager } from "./UniversalModelManager";
import { EmbeddingServiceStatus } from "./EmbeddingServiceStatus";
import { FileText, Brain, HardDrive } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { 
  KnowledgeBaseConfig, 
  getKnowledgeBaseConfigManager, 
  loadKnowledgeBaseConfig, 
  DEFAULT_KNOWLEDGE_BASE_CONFIG 
} from "@/lib/knowledgeBaseConfig";

export function KnowledgeBaseSettings() {
  const t = useTranslation();
  const [settings, setSettings] = useState<KnowledgeBaseConfig>(DEFAULT_KNOWLEDGE_BASE_CONFIG);
  const [isLoading, setIsLoading] = useState(true);

  // 加载设置
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const config = await loadKnowledgeBaseConfig();
        // 直接使用配置管理器中的最新配置
        setSettings(config);
      } catch (error) {
        console.warn('Failed to load knowledge base config:', error);
        setSettings(DEFAULT_KNOWLEDGE_BASE_CONFIG);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const updateSettings = (section: keyof KnowledgeBaseConfig, key: string, value: any) => {
    setSettings((prev: KnowledgeBaseConfig) => {
      const updated = {
        ...prev,
        [section]: {
          ...prev[section],
          [key]: value,
        },
      } as KnowledgeBaseConfig;

      // 即时保存到配置管理器
      getKnowledgeBaseConfigManager()
        .updateConfig(section, { [key]: value } as any)
        .catch((err) => console.error('实时保存配置失败:', err));

      return updated;
    });
  };

  // 重置为默认配置
  const resetToDefault = async () => {
    try {
      await getKnowledgeBaseConfigManager().resetToDefault();
      setSettings({ ...DEFAULT_KNOWLEDGE_BASE_CONFIG });
      toast.success(t('settings.knowledge.resetSuccess'));
    } catch (error) {
      console.error("Reset config failed", error);
      toast.error(t('settings.knowledge.resetFailed'), { description: (error as any)?.message || t('settings.knowledge.resetFailedRetry') });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">{t('settings.knowledge.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 页面标题 */}
      <div className="mb-4">
        <h2 className="text-base font-medium text-slate-800 dark:text-slate-100 mb-2">{t('settings.knowledge.title')}</h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {t('settings.knowledge.description')}
        </p>
      </div>
      {/* 嵌入模型管理 */}
      <SettingsCard>
        <SettingsSectionHeader icon={Brain} title={t('settings.knowledge.embeddingSection')} />
        <UniversalModelManager />
        <div className="mt-4 border-t border-slate-200/60 dark:border-slate-700/40 pt-4">
          <EmbeddingServiceStatus />
        </div>
      </SettingsCard>

      {/* 文档处理设置 */}
      <CollapsibleCard title={t('settings.knowledge.documentProcessing')} icon={FileText}>
        <div className="space-y-6">
          <InputField
            label={t('settings.knowledge.maxFileSize')}
            type="number"
            value={settings.documentProcessing.maxFileSize.toString()}
            onChange={(e) => updateSettings('documentProcessing', 'maxFileSize', parseInt(e.target.value) || 50)}
            description={t('settings.knowledge.maxFileSizeHelp')}
            min="1"
            max="500"
          />

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('settings.knowledge.supportedFileTypes')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {['pdf', 'docx', 'txt', 'md', 'html', 'csv'].map(fileType => (
                <ToggleSwitch
                  key={fileType}
                  label={fileType.toUpperCase()}
                  checked={settings.documentProcessing.supportedFileTypes.includes(fileType)}
                  onChange={(checked) => {
                    const newTypes = checked
                      ? [...settings.documentProcessing.supportedFileTypes, fileType]
                      : settings.documentProcessing.supportedFileTypes.filter(t => t !== fileType);
                    updateSettings('documentProcessing', 'supportedFileTypes', newTypes);
                  }}
                />
              ))}
            </div>
          </div>

          {/* —— 新增：文档解析/拼接策略 —— */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-2" />
          <SettingsSectionHeader title={t('settings.knowledge.documentSettings')} />

          <ToggleSwitch
            label={t('settings.knowledge.autoAttachPreview')}
            description={t('settings.knowledge.autoAttachPreviewHelp')}
            checked={settings.documentProcessing.autoAttachDocumentPreview}
            onChange={(checked) => updateSettings('documentProcessing', 'autoAttachDocumentPreview', checked)}
          />

          <InputField
            label={t('settings.knowledge.previewTokenLimit')}
            type="number"
            value={settings.documentProcessing.previewTokenLimit.toString()}
            onChange={(e) => updateSettings('documentProcessing', 'previewTokenLimit', parseInt(e.target.value) || 4000)}
            description={t('settings.knowledge.previewTokenLimitHelp')}
            min="1000"
            max="16000"
          />

          <InputField
            label={t('settings.knowledge.previewKeepTailRatio')}
            type="number"
            step="0.05"
            value={settings.documentProcessing.previewKeepTailRatio.toString()}
            onChange={(e) => updateSettings('documentProcessing', 'previewKeepTailRatio', Math.max(0, Math.min(0.5, parseFloat(e.target.value) || 0.2)))}
            description={t('settings.knowledge.previewKeepTailRatioHelp')}
            min="0"
            max="0.5"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              label={t('settings.knowledge.bigFileSizeMb')}
              type="number"
              value={settings.documentProcessing.bigFileSizeMb.toString()}
              onChange={(e) => updateSettings('documentProcessing', 'bigFileSizeMb', Math.max(1, parseInt(e.target.value) || 5))}
              description={t('settings.knowledge.bigFileSizeMbHelp')}/>
            <InputField
              label={t('settings.knowledge.bigTokenThreshold')}
              type="number"
              value={settings.documentProcessing.bigTokenThreshold.toString()}
              onChange={(e) => updateSettings('documentProcessing', 'bigTokenThreshold', Math.max(1000, parseInt(e.target.value) || 8000))}
              description={t('settings.knowledge.bigTokenThresholdHelp')}/>
          </div>
        </div>
      </CollapsibleCard>

      {/* 存储管理 */}
      <CollapsibleCard title={t('settings.knowledge.storage')} icon={HardDrive}>
        <div className="space-y-6">
          <ToggleSwitch
            label={t('settings.knowledge.enableAutoCleanup')}
            description={t('settings.knowledge.enableAutoCleanupHelp')}
            checked={settings.storage.enableAutoCleanup}
            onChange={(checked) => updateSettings('storage', 'enableAutoCleanup', checked)}
          />

          {settings.storage.enableAutoCleanup && (
            <InputField
              label={t('settings.knowledge.cleanupInterval')}
              type="number"
              value={settings.storage.cleanupInterval.toString()}
              onChange={(e) => updateSettings('storage', 'cleanupInterval', parseInt(e.target.value) || 30)}
              description={t('settings.knowledge.cleanupIntervalHelp')}
              min="1"
              max="365"
            />
          )}

          <ToggleSwitch
            label={t('settings.knowledge.enableBackup')}
            description={t('settings.knowledge.enableBackupHelp')}
            checked={settings.storage.enableBackup}
            onChange={(checked) => updateSettings('storage', 'enableBackup', checked)}
          />

          {settings.storage.enableBackup && (
            <InputField
              label={t('settings.knowledge.backupInterval')}
              type="number"
              value={settings.storage.backupInterval.toString()}
              onChange={(e) => updateSettings('storage', 'backupInterval', parseInt(e.target.value) || 24)}
              description={t('settings.knowledge.backupIntervalHelp')}
              min="1"
              max="168"
            />
          )}
        </div>
      </CollapsibleCard>

      {/* 重置按钮 */}
      <div className="flex justify-end pt-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="h-7 px-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md">
              {t('settings.knowledge.reset')}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('settings.knowledge.resetTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('settings.knowledge.resetDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={resetToDefault}>
                {t('common.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

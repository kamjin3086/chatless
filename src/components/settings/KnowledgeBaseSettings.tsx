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
import { 
  KnowledgeBaseConfig, 
  getKnowledgeBaseConfigManager, 
  loadKnowledgeBaseConfig, 
  DEFAULT_KNOWLEDGE_BASE_CONFIG 
} from "@/lib/knowledgeBaseConfig";

export function KnowledgeBaseSettings() {
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
      toast.success("已恢复默认配置");
    } catch (error) {
      console.error("Reset config failed", error);
      toast.error("恢复默认配置失败", { description: (error as any)?.message || "请重试" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载配置中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 页面标题 */}
      <div className="mb-4">
        <h2 className="text-base font-medium text-slate-800 dark:text-slate-100 mb-2">知识库管理</h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          添加/编辑知识库配置，聊天中可选择已连接知识库。
        </p>
      </div>
      {/* 嵌入模型管理 */}
      <SettingsCard>
        <SettingsSectionHeader icon={Brain} title="嵌入模型管理" />
        <UniversalModelManager />
        <div className="mt-4 border-t border-slate-200/60 dark:border-slate-700/40 pt-4">
          <EmbeddingServiceStatus />
        </div>
      </SettingsCard>

      {/* 文档处理设置 */}
      <CollapsibleCard title="文档处理设置" icon={FileText}>
        <div className="space-y-6">
          <InputField
            label="最大文件大小"
            type="number"
            value={settings.documentProcessing.maxFileSize.toString()}
            onChange={(e) => updateSettings('documentProcessing', 'maxFileSize', parseInt(e.target.value) || 50)}
            description="单个文档文件的最大大小限制(MB)"
            min="1"
            max="500"
          />

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              支持的文件类型
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
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-2" />
          <SettingsSectionHeader title="文档设置" />

          <ToggleSwitch
            label="自动将文档预览拼接到消息"
            description="发送消息时，自动把解析后的文档预览（受 token 限制）附加到提示词末尾。默认关闭，推荐使用知识库/RAG。"
            checked={settings.documentProcessing.autoAttachDocumentPreview}
            onChange={(checked) => updateSettings('documentProcessing', 'autoAttachDocumentPreview', checked)}
          />

          <InputField
            label="预览 token 上限"
            type="number"
            value={settings.documentProcessing.previewTokenLimit.toString()}
            onChange={(e) => updateSettings('documentProcessing', 'previewTokenLimit', parseInt(e.target.value) || 4000)}
            description="当自动拼接开启时，用于控制预览的最大 token 数，超出将按句子裁剪。"
            min="1000"
            max="16000"
          />

          <InputField
            label="预览尾部保留比例"
            type="number"
            step="0.05"
            value={settings.documentProcessing.previewKeepTailRatio.toString()}
            onChange={(e) => updateSettings('documentProcessing', 'previewKeepTailRatio', Math.max(0, Math.min(0.5, parseFloat(e.target.value) || 0.2)))}
            description="在截断时除保留开头内容外，按比例保留一部分结尾内容，范围 0 ~ 0.5。"
            min="0"
            max="0.5"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              label="大文档文件大小阈值 (MB)"
              type="number"
              value={settings.documentProcessing.bigFileSizeMb.toString()}
              onChange={(e) => updateSettings('documentProcessing', 'bigFileSizeMb', Math.max(1, parseInt(e.target.value) || 5))}
              description="超过此大小将提示“转入知识库并引用”。"/>
            <InputField
              label="大文档 token 阈值"
              type="number"
              value={settings.documentProcessing.bigTokenThreshold.toString()}
              onChange={(e) => updateSettings('documentProcessing', 'bigTokenThreshold', Math.max(1000, parseInt(e.target.value) || 8000))}
              description="估算 token 超过此值将提示“转入知识库并引用”。"/>
          </div>
        </div>
      </CollapsibleCard>

      {/* 存储管理 */}
      <CollapsibleCard title="存储管理" icon={HardDrive}>
        <div className="space-y-6">
          <ToggleSwitch
            label="启用自动清理"
            description="定期清理过期的索引缓存和临时文件"
            checked={settings.storage.enableAutoCleanup}
            onChange={(checked) => updateSettings('storage', 'enableAutoCleanup', checked)}
          />

          {settings.storage.enableAutoCleanup && (
            <InputField
              label="清理间隔(天)"
              type="number"
              value={settings.storage.cleanupInterval.toString()}
              onChange={(e) => updateSettings('storage', 'cleanupInterval', parseInt(e.target.value) || 30)}
              description="自动清理的执行间隔"
              min="1"
              max="365"
            />
          )}

          <ToggleSwitch
            label="启用自动备份"
            description="定期备份知识库数据，防止数据丢失"
            checked={settings.storage.enableBackup}
            onChange={(checked) => updateSettings('storage', 'enableBackup', checked)}
          />

          {settings.storage.enableBackup && (
            <InputField
              label="备份间隔(小时)"
              type="number"
              value={settings.storage.backupInterval.toString()}
              onChange={(e) => updateSettings('storage', 'backupInterval', parseInt(e.target.value) || 24)}
              description="自动备份的执行间隔"
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
            <button className="h-7 px-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
              恢复默认
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>恢复默认设置</AlertDialogTitle>
              <AlertDialogDescription>
                所有知识库相关配置将被重置为默认值，且无法撤销，确定继续？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={resetToDefault}>
                确认
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

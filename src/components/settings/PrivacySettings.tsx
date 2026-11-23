"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { Shield, Trash2, HardDrive, Settings2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Book } from "lucide-react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { DatabaseService } from "@/lib/database/services/DatabaseService";
import { downloadService } from "@/lib/utils/downloadService";
import { toast } from "@/components/ui/sonner";
import { OnnxModelDownloader } from "@/lib/embedding/OnnxModelDownloader";
import { tauriFetch } from "@/lib/request";
import modelsConfig from "@/lib/models.json";
import { StorageUtil } from "@/lib/storage";
import { Download as DownloadIcon } from "lucide-react";
import { Upload } from "lucide-react";
import React from "react";
import { useTranslation } from "@/i18n/useTranslation";

// 浏览器端导出无需文件系统插件

export function PrivacySettings() {
  const [clearing, setClearing] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [confirmKbInput, setConfirmKbInput] = useState("");
  const allowDelete = confirmInput.trim().toUpperCase() === "DELETE";
  const allowKbDelete = confirmKbInput.trim().toUpperCase() === "CLEAR KB";
  const [clearingKb, setClearingKb] = useState(false);
  const [confirmModelInput, setConfirmModelInput] = useState("");
  const allowModelDelete = confirmModelInput.trim().toUpperCase() === "CLEAR MODEL";
  const [clearingModel, setClearingModel] = useState(false);
  const [confirmResetInput, setConfirmResetInput] = useState("");
  const allowReset = confirmResetInput.trim().toUpperCase() === "RESET APP";
  const [resetting, setResetting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const t = useTranslation();

  const clearChats = async () => {
    setClearing(true);
    try {
      const dbService = DatabaseService.getInstance();
      await dbService.initialize();
      await dbService.clearAllConversations();
      toast.success(t("settings.privacy.chatsCleared"));
    } catch (e: any) {
      toast.error(
        t("settings.privacy.clearChatsFailed").replace(
          "{0}",
          e?.message || t("settings.privacy.unknownError"),
        ),
      );
    } finally {
      setClearing(false);
    }
  };

  const clearKnowledgeData = async () => {
    setClearingKb(true);
    try {
      const dbService = DatabaseService.getInstance();
      await dbService.initialize();
      await dbService.clearKnowledgeData();

      toast.success(t("settings.privacy.knowledgeCleared"));
    } catch (e: any) {
      toast.error(
        t("settings.privacy.clearKnowledgeFailed").replace(
          "{0}",
          e?.message || t("settings.privacy.unknownError"),
        ),
      );
    } finally {
      setClearingKb(false);
    }
  };

  const clearModelCache = async () => {
    setClearingModel(true);
    try {
      // 1. 清理 ONNX 模型
      const downloader = new OnnxModelDownloader();
      await downloader.waitUntilReady();
      await downloader.deleteAllModels();

      // 2. 清理 Ollama 中与嵌入相关的模型（不会删除用户自行下载的聊天模型）
      try {
        const { OllamaConfigService } = await import("@/lib/config/OllamaConfigService");
        const ollamaUrl = await OllamaConfigService.getOllamaUrl();

        // 嵌入模型列表
        const embedIds = modelsConfig.filter(m => m.strategy === "ollama").map(m => m.id);

        const resp = await tauriFetch(`${ollamaUrl}/api/tags`, { method: 'GET', rawResponse: true, danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true }, fallbackToBrowserOnError: true, verboseDebug: true, debugTag: 'ModelList' });
        if (resp.ok) {
          const data = await resp.json() as { models?: any[] };
          const names = data.models?.map(m => m.name) || [];
          for (const n of names) {
            const base = n.split(":"    )[0];
            if (!embedIds.includes(base)) continue; // 仅删除配置里列出的嵌入模型
            try {
              await fetch(`${ollamaUrl}/api/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) });
            } catch {}
          }
        }
      } catch {}

      toast.success(t("settings.privacy.modelCacheCleared"));
    } catch (e: any) {
      toast.error(
        t("settings.privacy.clearModelCacheFailed").replace(
          "{0}",
          e?.message || t("settings.privacy.unknownError"),
        ),
      );
    } finally {
      setClearingModel(false);
    }
  };

  const factoryReset = async () => {
    setResetting(true);
    try {
            // 使用统一初始化器执行完整重置（包括数据库文件删除、清空存储等）
      const { SampleDataInitializer } = await import('@/lib/sampleDataInitializer');
      await SampleDataInitializer.fullReset();

      // 清空 Provider/模型 的用户覆盖配置
      // 注意：saveUserOverrides 函数不存在，已移除相关代码

      // 重置知识库配置
      try {
        const { getKnowledgeBaseConfigManager } = await import("@/lib/knowledgeBaseConfig");
        await getKnowledgeBaseConfigManager().resetToDefault();
      } catch {}

      toast.success(t("settings.privacy.factoryResetDone"));
      setTimeout(() => {
        location.reload();
      }, 1500);
    } catch (e: any) {
      toast.error(
        t("settings.privacy.factoryResetFailed").replace(
          "{0}",
          e?.message || t("settings.privacy.unknownError"),
        ),
      );
    } finally {
      setResetting(false);
    }
  };

  const exportChats = async () => {
    setExporting(true);
    try {
      const db = DatabaseService.getInstance();
      await db.initialize();
      const convs = await db.getAllConversations();
      const full: any[] = [];
      for (const c of convs) {
        const detailed = await db.getConversationWithMessages(c.id);
        full.push(detailed);
      }

      const exportObj = {
        exportedAt: new Date().toISOString(),
        conversationCount: full.length,
        conversations: full,
      };

      const fileName = `chat-backup-${Date.now()}.json`;
      const success = await downloadService.downloadJson(fileName, exportObj);
      
      if (success) {
        toast.success(t("settings.privacy.chatsExported"));
      }
    } catch (e: any) {
      console.error('导出聊天记录失败', e);
      const msg = e?.message || JSON.stringify(e);
      toast.error(t("settings.privacy.exportFailed").replace("{0}", msg));
    } finally {
      setExporting(false);
    }
  };

  const triggerImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 验证文件类型
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      toast.error(t("settings.privacy.importInvalidType"));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.conversations)) {
        toast.error(t("settings.privacy.importInvalidFormat"));
        return;
      }

      const db = DatabaseService.getInstance();
      await db.initialize();

      for (const conv of data.conversations) {
        // 导入时保持原有的收藏状态，如果没有则默认为 false
        const newConv = await db.createConversation(
          conv.title || t("settings.privacy.importDefaultTitle"), 
          conv.model_id || 'unknown',
          {
            is_favorite: conv.is_favorite || false
          }
        );
        if (conv.messages && Array.isArray(conv.messages)) {
          for (const msg of conv.messages) {
            await db.createMessage(newConv.id, msg.role, msg.content);
          }
        }
      }
      
      // 导入成功后刷新聊天列表
      const { useChatStore } = await import('@/store/chatStore');
      await useChatStore.getState().loadConversations();
      
      toast.success(
        t("settings.privacy.importDone").replace(
          "{0}",
          String(data.conversationCount || data.conversations.length),
        ),
      );
    } catch (err:any) {
      toast.error(
        t("settings.privacy.importFailed").replace(
          "{0}",
          err?.message || t("settings.privacy.unknownError"),
        ),
      );
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <SettingsCard>
      <SettingsSectionHeader
        icon={Shield}
        title={t("settings.privacy.dataAndBackup")}
      />

      <div className="flex flex-wrap gap-2">
        <input type="file" accept="application/json" hidden ref={fileInputRef} onChange={handleFileChange} />
        <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={triggerImport} disabled={importing}>
          <Upload className={`w-3.5 h-3.5 ${importing ? "animate-spin" : ""}`} />
          {importing ? t("settings.privacy.importing") : t("settings.privacy.importBackup")}
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={exportChats} disabled={exporting}>
          <DownloadIcon className={`w-3.5 h-3.5 ${exporting ? "animate-spin" : ""}`} />
          {exporting ? t("settings.privacy.exporting") : t("settings.privacy.exportRecords")}
        </Button>
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 h-7 px-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 data-[state=open]:[&_svg]:rotate-180"
          >
            <ChevronDown className="w-3.5 h-3.5 transition-transform" />
            {t("settings.privacy.dangerZone")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 justify-start text-rose-600 border-rose-200/80 hover:bg-rose-50/80 dark:text-rose-400 dark:border-rose-500/25 dark:hover:bg-rose-500/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t("settings.privacy.clearChats")}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t("settings.privacy.clearChatsTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">{t("settings.privacy.clearChatsWarning")}<strong>{t("settings.privacy.irreversible")}</strong>{t("settings.privacy.warningColon")}</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <li>{t("settings.privacy.clearChatsItemConversations")}</li>
                  <li>{t("settings.privacy.clearChatsItemMessages")}</li>
                  <li>{t("settings.privacy.clearChatsItemStats")}</li>
                </ul>
                <p className="mt-3">{t("settings.privacy.clearChatsConfirmPrefix")}<span className="font-mono bg-slate-100 px-1 py-0.5 rounded-md">DELETE</span>{t("settings.privacy.clearChatsConfirmSuffix")}</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={t("settings.privacy.clearChatsPlaceholder")}
              className="w-full mt-3 px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-slate-800 dark:border-slate-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>{t("settings.privacy.cancel")}</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  disabled={clearing || !allowDelete}
                  onClick={clearChats}
                >
                  {clearing ? t("settings.privacy.clearing") : t("settings.privacy.confirmDelete")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* 清空知识库数据 */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 justify-start text-rose-600 border-rose-200/80 hover:bg-rose-50/80 dark:text-rose-400 dark:border-rose-500/25 dark:hover:bg-rose-500/10"
            >
              <Book className="w-3.5 h-3.5" />
              <span>{t("settings.privacy.clearKnowledge")}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t("settings.privacy.clearKnowledgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">{t("settings.privacy.clearKnowledgeWarning")}<strong>{t("settings.privacy.unrecoverable")}</strong>{t("settings.privacy.warningColon")}</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <li>{t("settings.privacy.clearKnowledgeItemDocs")}</li>
                  <li>{t("settings.privacy.clearKnowledgeItemIndex")}</li>
                  <li>{t("settings.privacy.clearKnowledgeItemConfig")}</li>
                </ul>
                <p className="mt-3">{t("settings.privacy.clearKnowledgeConfirmPrefix")}<span className="font-mono bg-slate-100 px-1 py-0.5 rounded-md">CLEAR KB</span>{t("settings.privacy.clearKnowledgeConfirmSuffix")}</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmKbInput}
              onChange={(e) => setConfirmKbInput(e.target.value)}
              placeholder={t("settings.privacy.clearKnowledgePlaceholder")}
              className="w-full mt-3 px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-slate-800 dark:border-slate-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>{t("settings.privacy.cancel")}</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  disabled={clearingKb || !allowKbDelete}
                  onClick={clearKnowledgeData}
                >
                  {clearingKb ? t("settings.privacy.clearing") : t("settings.privacy.confirmDelete")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* 清空模型缓存 */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2.5 justify-start text-rose-600 border-rose-200/80 hover:bg-rose-50/80 dark:text-rose-400 dark:border-rose-500/25 dark:hover:bg-rose-500/10">
              <HardDrive className="w-3.5 h-3.5" />
              <span>{t("settings.privacy.clearModelCache")}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t("settings.privacy.clearModelCacheTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">{t("settings.privacy.clearModelCacheWarning")}</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <li>{t("settings.privacy.clearModelCacheItemDownloaded")}</li>
                  <li>{t("settings.privacy.clearModelCacheItemProgress")}</li>
                </ul>
                <p className="mt-3">{t("settings.privacy.clearModelCacheConfirmPrefix")}<span className="font-mono bg-slate-100 px-1 py-0.5 rounded-md">CLEAR MODEL</span>{t("settings.privacy.clearModelCacheConfirmSuffix")}</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmModelInput}
              onChange={(e) => setConfirmModelInput(e.target.value)}
              placeholder={t("settings.privacy.clearModelCachePlaceholder")}
              className="w-full mt-3 px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-slate-800 dark:border-slate-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>{t("settings.privacy.cancel")}</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  disabled={clearingModel || !allowModelDelete}
                  onClick={clearModelCache}
                >
                  {clearingModel ? t("settings.privacy.clearing") : t("settings.privacy.confirmDelete")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* 恢复出厂设置 */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2.5 justify-start text-rose-600 border-rose-200/80 hover:bg-rose-50/80 dark:text-rose-400 dark:border-rose-500/25 dark:hover:bg-rose-500/10">
              <Settings2 className="w-3.5 h-3.5" />
              <span>{t("settings.privacy.factoryReset")}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>{t("settings.privacy.factoryResetTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">{t("settings.privacy.factoryResetWarning")}<strong>{t("settings.privacy.irreversible")}</strong>{t("settings.privacy.warningColon")}</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <li>{t("settings.privacy.factoryResetDeletePrefix")}<b className="text-red-500">{t("settings.privacy.factoryResetItemChats")}</b></li>
                  <li>{t("settings.privacy.factoryResetDeletePrefix")}<b className="text-red-500">{t("settings.privacy.factoryResetItemKnowledge")}</b></li>
                  <li>{t("settings.privacy.factoryResetDeletePrefix")}<b className="text-red-500">{t("settings.privacy.factoryResetItemModels")}</b></li>
                  <li>{t("settings.privacy.factoryResetItemSettingsPrefix")}<b className="text-red-500">{t("settings.privacy.factoryResetItemSettingsEmphasis")}</b></li>
                  <li>{t("settings.privacy.factoryResetItemCache")}</li>
                  <li>{t("settings.privacy.factoryResetItemRestart")}</li>
                </ul>
                <p className="mt-3">{t("settings.privacy.factoryResetConfirmPrefix")}<span className="font-mono bg-slate-100 px-1 py-0.5 rounded-md">RESET APP</span>{t("settings.privacy.factoryResetConfirmSuffix")}</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmResetInput}
              onChange={(e) => setConfirmResetInput(e.target.value)}
              placeholder={t("settings.privacy.factoryResetPlaceholder")}
              className="w-full mt-3 px-2 py-1 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-slate-800 dark:border-slate-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>{t("settings.privacy.cancel")}</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" disabled={resetting || !allowReset} onClick={factoryReset}>
                  {resetting ? t("settings.privacy.resetting") : t("settings.privacy.confirmReset")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
        </CollapsibleContent>
      </Collapsible>
    </SettingsCard>
  );
}

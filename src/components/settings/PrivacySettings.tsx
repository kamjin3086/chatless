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

  const clearChats = async () => {
    setClearing(true);
    try {
      const dbService = DatabaseService.getInstance();
      await dbService.initialize();
      await dbService.clearAllConversations();
      toast.success("已清空全部聊天记录");
    } catch (e: any) {
      toast.error(`清空失败: ${e?.message || "未知错误"}`);
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

      toast.success("已清空知识库文档与索引");
    } catch (e: any) {
      toast.error(`清理失败: ${e?.message || "未知错误"}`);
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

      toast.success("已清空本地模型缓存");
    } catch (e: any) {
      toast.error(`清理失败: ${e?.message || "未知错误"}`);
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

      toast.success("已恢复出厂设置，应用将重新加载");
      setTimeout(() => {
        location.reload();
      }, 1500);
    } catch (e: any) {
      toast.error(`恢复失败: ${e?.message || "未知错误"}`);
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
        toast.success("聊天记录已导出");
      }
    } catch (e: any) {
      console.error('导出聊天记录失败', e);
      const msg = e?.message || JSON.stringify(e);
      toast.error(`导出失败: ${msg}`);
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
      toast.error('请选择JSON格式的文件');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.conversations)) {
        throw new Error('文件格式不正确，请确保是chatless导出的聊天备份文件');
      }

      const db = DatabaseService.getInstance();
      await db.initialize();

      for (const conv of data.conversations) {
        // 导入时保持原有的重要和收藏状态，如果没有则默认为false
        const newConv = await db.createConversation(
          conv.title || '导入对话', 
          conv.model_id || 'unknown',
          {
            is_important: conv.is_important || false,
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
      
      toast.success(`已导入 ${data.conversationCount || data.conversations.length} 个对话`);
    } catch (err:any) {
      toast.error(`导入失败: ${err?.message || '未知错误'}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <SettingsCard>
      <SettingsSectionHeader
        icon={Shield}
        title="数据与备份"
      />

      <div className="flex flex-wrap gap-2">
        <input type="file" accept="application/json" hidden ref={fileInputRef} onChange={handleFileChange} />
        <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={triggerImport} disabled={importing}>
          <Upload className={`w-3.5 h-3.5 ${importing ? "animate-spin" : ""}`} />
          {importing ? "导入中..." : "导入备份"}
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={exportChats} disabled={exporting}>
          <DownloadIcon className={`w-3.5 h-3.5 ${exporting ? "animate-spin" : ""}`} />
          {exporting ? "导出中..." : "导出记录"}
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
            危险操作
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
              <span>清空聊天记录</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>确认清空全部聊天记录？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">将执行以下操作并<strong>无法撤销</strong>：</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  <li>删除所有会话（Conversation）记录</li>
                  <li>删除每条聊天消息内容</li>
                  <li>重置最近聊天模型统计</li>
                </ul>
                <p className="mt-3">请输入 <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">DELETE</span> 以继续。</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="请输入 DELETE 以确认"
              className="w-full mt-3 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-gray-800 dark:border-gray-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  disabled={clearing || !allowDelete}
                  onClick={clearChats}
                >
                  {clearing ? "清理中..." : "确认删除"}
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
              <span>清空知识库数据</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>确认清空所有知识库数据？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">此操作将删除以下内容并<strong>无法恢复</strong>：</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  <li>已上传 / 抓取的文档文件</li>
                  <li>删除知识库索引和缓存</li>
                  <li>知识库配置项</li>
                </ul>
                <p className="mt-3">若确认，请输入 <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">CLEAR KB</span> 继续。</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmKbInput}
              onChange={(e) => setConfirmKbInput(e.target.value)}
              placeholder="请输入 CLEAR KB 以确认"
              className="w-full mt-3 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-gray-800 dark:border-gray-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  disabled={clearingKb || !allowKbDelete}
                  onClick={clearKnowledgeData}
                >
                  {clearingKb ? "清理中..." : "确认删除"}
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
              <span>清空模型缓存</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>确认清空所有本地模型缓存？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">将删除以下内容：</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  <li>通过应用下载的模型文件</li>
                  <li>模型下载进度与缓存记录</li>
                </ul>
                <p className="mt-3">不会影响你手动放置的模型文件。请输入 <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">CLEAR MODEL</span> 继续。</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmModelInput}
              onChange={(e) => setConfirmModelInput(e.target.value)}
              placeholder="请输入 CLEAR MODEL"
              className="w-full mt-3 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-gray-800 dark:border-gray-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  disabled={clearingModel || !allowModelDelete}
                  onClick={clearModelCache}
                >
                  {clearingModel ? "清理中..." : "确认删除"}
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
              <span>恢复出厂设置</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>确认恢复出厂设置？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2 text-sm text-red-600 font-semibold">此操作极其危险，将执行以下步骤并<strong>无法撤销</strong>：</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  <li>删除 <b className="text-red-500">全部聊天记录</b></li>
                  <li>删除 <b className="text-red-500">全部知识库文档与索引</b></li>
                  <li>删除 <b className="text-red-500">本地模型缓存</b></li>
                  <li>清除 所有 API Key、界面偏好等 <b className="text-red-500">个人设置</b></li>
                  <li>清空 所有应用缓存文件</li>
                  <li>应用随后自动重启为初始状态</li>
                </ul>
                <p className="mt-3">若确认无误，请输入 <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">RESET APP</span> 继续。</p>
              </div>
            </AlertDialogDescription>
            <input
              type="text"
              value={confirmResetInput}
              onChange={(e) => setConfirmResetInput(e.target.value)}
              placeholder="请输入 RESET APP"
              className="w-full mt-3 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-gray-800 dark:border-gray-700"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" disabled={resetting || !allowReset} onClick={factoryReset}>
                  {resetting ? "处理中..." : "确认恢复"}
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

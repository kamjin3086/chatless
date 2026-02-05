"use client";

import { useMemo, useState } from "react";
import { Cloud, RefreshCw, Link2, Folder, User, KeyRound } from "lucide-react";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { InputField } from "./InputField";
import { ToggleSwitch } from "./ToggleSwitch";
import { SettingsCard } from "./SettingsCard";
import { Button } from "@/components/ui/button";
import { useWebDavSyncStore } from "@/store/webDavSyncStore";
import { syncPromptsWithWebDav } from "@/lib/sync/prompts/webdavPromptSync";
import { usePromptStore } from "@/store/promptStore";

export function WebDavSyncSettings() {
  const cfg = useWebDavSyncStore();
  const loadPrompts = usePromptStore((s) => s.loadFromDatabase);

  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const canRun = useMemo(() => {
    if (!cfg.enabled) return false;
    if (!cfg.url.trim()) return false;
    if (!cfg.username.trim()) return false;
    if (!cfg.password.trim()) return false;
    return true;
  }, [cfg.enabled, cfg.url, cfg.username, cfg.password]);

  const onTest = async () => {
    setTesting(true);
    cfg.setLastError(undefined);
    try {
      const { WebDavClient } = await import("@/lib/sync/webdav/WebDavClient");
      const client = new WebDavClient({
        url: cfg.url,
        basePath: cfg.basePath,
        auth: { username: cfg.username, password: cfg.password },
        timeoutMs: 12_000,
      });
      await client.ensureCollections(["prompts", "prompts/data"]);
      await client.propfind("prompts", "0");
      cfg.setLastSync({ at: Date.now(), summary: "连接测试成功（已确保 prompts 目录存在）" });
    } catch (e: any) {
      const msg = e?.message || String(e);
      cfg.setLastError(msg);
    } finally {
      setTesting(false);
    }
  };

  const onSync = async () => {
    if (!canRun) return;
    setSyncing(true);
    cfg.setLastError(undefined);
    try {
      const res = await syncPromptsWithWebDav({
        url: cfg.url,
        basePath: cfg.basePath,
        username: cfg.username,
        password: cfg.password,
      });
      await loadPrompts();
      const summary =
        `同步完成：推送 ${res.pushed}，拉取 ${res.pulled}，跳过 ${res.skipped}` + (res.remoteCreated ? "（远端 metadata 初始化）" : "");
      cfg.setLastSync({ at: Date.now(), summary });
    } catch (e: any) {
      const msg = e?.message || String(e);
      cfg.setLastError(msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3">同步设置</h2>
        <div className="rounded-xl border border-slate-200/70 bg-gradient-to-br from-slate-50/50 to-blue-50/30 dark:from-slate-800/30 dark:to-blue-900/10 p-4 dark:border-slate-700/60 shadow-sm">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            使用 WebDAV 在多设备之间同步「提示词（Prompts）」数据。采用 JSON-Chunk 策略：每个 prompt 一个 JSON 文件 + metadata 索引文件。
          </p>
        </div>
      </div>

      <SettingsCard className="border border-slate-200/70 dark:border-slate-700/60 rounded-xl p-6 bg-white/70 dark:bg-slate-900/40 shadow-sm backdrop-blur-sm mb-0">
        <SettingsSectionHeader icon={Cloud} title="WebDAV 同步（Prompts）" />

        <ToggleSwitch
          label="启用 WebDAV 同步"
          checked={cfg.enabled}
          onChange={(v) => cfg.setConfig({ enabled: v })}
          tooltip="启用后可手动同步。当前版本不会自动后台同步。"
        />

        <div className="pt-3 border-t border-slate-100/80 dark:border-slate-800/60" />

        <InputField
          label="WebDAV URL"
          value={cfg.url}
          onChange={(e) => cfg.setConfig({ url: e.target.value })}
          placeholder="https://example.com/remote.php/dav/files/username/"
          icon={<Link2 className="w-4 h-4 text-gray-400" />}
          description="指向 WebDAV 根目录的 URL（建议以 / 结尾）。"
        />

        <InputField
          label="远端目录"
          value={cfg.basePath}
          onChange={(e) => cfg.setConfig({ basePath: e.target.value })}
          placeholder="chatless"
          icon={<Folder className="w-4 h-4 text-gray-400" />}
          description="应用在远端根目录下的子目录。最终路径示例：{basePath}/prompts/data/metadata.json"
        />

        <InputField
          label="用户名"
          value={cfg.username}
          onChange={(e) => cfg.setConfig({ username: e.target.value })}
          placeholder="username"
          icon={<User className="w-4 h-4 text-gray-400" />}
        />

        <InputField
          label="密码"
          type="password"
          value={cfg.password}
          onChange={(e) => cfg.setConfig({ password: e.target.value })}
          placeholder="password"
          icon={<KeyRound className="w-4 h-4 text-gray-400" />}
          description="当前项目未集成系统钥匙串，本字段可选择是否本机保存。"
        />

        <ToggleSwitch
          label="本机保存密码"
          checked={cfg.storePassword}
          onChange={(v) => cfg.setConfig({ storePassword: v })}
          tooltip="关闭后不会写入本地存储（重启需要重新输入）。"
        />

        <div className="flex items-center gap-3 pt-4">
          <Button
            variant="secondary"
            disabled={!cfg.enabled || !cfg.url.trim() || !cfg.username.trim() || !cfg.password.trim() || testing}
            onClick={onTest}
          >
            <RefreshCw className={testing ? "w-4 h-4 mr-2 animate-spin" : "w-4 h-4 mr-2"} />
            测试连接
          </Button>
          <Button disabled={!canRun || syncing} onClick={onSync}>
            <RefreshCw className={syncing ? "w-4 h-4 mr-2 animate-spin" : "w-4 h-4 mr-2"} />
            立即同步
          </Button>
        </div>

        {(cfg.lastSyncAt || cfg.lastError) && (
          <div className="mt-4 rounded-lg border border-slate-200/70 dark:border-slate-700/60 p-3 bg-white/60 dark:bg-slate-900/30">
            {cfg.lastSyncAt && (
              <div className="text-xs text-slate-600 dark:text-slate-300">
                上次结果：{cfg.lastSyncSummary || "完成"}（{new Date(cfg.lastSyncAt).toLocaleString()}）
              </div>
            )}
            {cfg.lastError && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-2 whitespace-pre-wrap">错误：{cfg.lastError}</div>
            )}
          </div>
        )}
      </SettingsCard>
    </div>
  );
}


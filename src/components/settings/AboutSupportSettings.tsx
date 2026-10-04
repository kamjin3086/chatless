"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { APP_INFO, getVersionInfo } from "@/config/app-info";
import { getUpdateAvailability, UPDATE_AVAILABILITY_EVENT, checkForUpdatesSilently } from "@/lib/update/update-notifier";
import StorageUtil from "@/lib/storage";
import { linkOpener } from "@/lib/utils/linkOpener";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const aboutCardClass =
  "glass-panel rounded-xl border border-slate-200/50 dark:border-slate-700/50 p-4";
const aboutLinkClass =
  "text-xs text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 hover:underline";

export function AboutSupportSettings() {
  const [showCopied, setShowCopied] = useState(false);
  const [versionInfo, setVersionInfo] = useState(getVersionInfo());
  const [onlyCheckDev, setOnlyCheckDev] = useState(false);
  const [notLatest, setNotLatest] = useState<{version: string}|null>(null);

  // 读取实际版本信息，并订阅更新可用性事件
  useEffect(() => {
    // 尝试从Tauri获取应用版本信息
    const getTauriVersion = async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).__TAURI__) {
          let tauriVersion = 'dev';
          try {
            const { getVersion } = await import('@tauri-apps/api/app');
            tauriVersion = await getVersion();
          } catch {
            tauriVersion = "unknown"
          }
          setVersionInfo(prev => ({
            ...prev,
            version: tauriVersion
          }));
        }
      } catch (error) {
        // 无法获取 Tauri 版本信息时忽略
      }
    };

    getTauriVersion();

    // 读取是否存在新版本（用于显示“当前不是最新版本”），并在事件触发时同步
    let mounted = true;
    const refreshAvailability = async () => {
      const info = await getUpdateAvailability();
      if (!mounted) return;
      try {
        const { isVersionIgnored } = await import('@/lib/update/update-notifier');
        if (info.available && info.version && !(await isVersionIgnored(info.version))) {
          setNotLatest({ version: info.version });
        } else {
          setNotLatest(null);
        }
      } catch {
        if (info.available && info.version) setNotLatest({ version: info.version });
        else setNotLatest(null);
      }
    };
    refreshAvailability();

    // 进入页面时触发一次静默检查，确保状态最新
    checkForUpdatesSilently().finally(() => {});

    if (typeof window !== 'undefined') {
      const handler = () => { refreshAvailability().catch(() => {}); };
      window.addEventListener(UPDATE_AVAILABILITY_EVENT, handler as EventListener);
      return () => {
        mounted = false;
        window.removeEventListener(UPDATE_AVAILABILITY_EVENT, handler as EventListener);
      };
    }

    // 同步“仅检查不安装”偏好（生产与开发环境均可用）
    (async () => {
      try {
        const saved = await StorageUtil.getItem<boolean>('only_check_update', false, 'user-preferences.json');
        setOnlyCheckDev(!!saved);
        if (typeof window !== 'undefined') {
          (window as any).__CHATLESS_ONLY_CHECK_UPDATE__ = !!saved;
        }
      } catch { /* noop */ }
    })();
  }, []);

  const handleOpenLink = async (url: string) => {
    try {
      const success = await linkOpener.openLink(url);
      if (!success) {
        toast.error('无法打开链接，请稍后重试');
      }
    } catch (error) {
      console.error('打开链接失败:', error);
      toast.error('打开链接失败');
    }
  };

  const handleCheckUpdate = async () => {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: 30_000 });

      if (!update || !('available' in update) || !update.available) {
        toast.success('已是最新版本');
        setNotLatest(null);
        return;
      }

      const version = (update as any).version ?? '新版本';

      const onlyCheck = typeof window !== 'undefined'
        && (window as any).__CHATLESS_ONLY_CHECK_UPDATE__;

      toast.message(`检测到更新：${version}`, {
        description: onlyCheck ? '如需安装，请取消仅检查更新。' : '正在下载并安装，请稍候…'
      });

      // 若可用，一步到位：下载并安装
      if (!onlyCheck && 'downloadAndInstall' in update && typeof (update as any).downloadAndInstall === 'function') {
        await (update as any).downloadAndInstall();
        setNotLatest(null);
        // Windows 会在安装前自动退出应用（由系统安装器决定）
        toast.success('更新已安装，将重启应用');
        const { relaunch } = await import('@tauri-apps/plugin-process');
        relaunch();

      } else if (!onlyCheck){
        // 兼容性兜底：仅提示用户前往发布页
        await handleOpenLink(APP_INFO.releases);
      }
    } catch (error) {
      console.error('检查更新失败:', error);
      toast.error('检查或安装更新失败');
    }
  };

  return (
    <div className="about-support space-y-4">
      {/* 页面标题 */}
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">关于与支持</h2>
        <div className={cn(aboutCardClass, "p-4")}>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            在此查看关于与支持相关信息，包括版本信息、更新检查、帮助中心等。
          </p>
        </div>
      </div>
      {/* 应用信息卡片 */}
      <section className={cn(aboutCardClass, "p-6")}>
        <div className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-6">
          {/* 左侧：Logo和艺术字 */}
          <div className="flex flex-col items-center text-center md:text-left md:items-start">
            {/* 应用Logo */}
            <div className="w-14 h-14 rounded-xl border border-slate-200/50 dark:border-slate-700/50 flex items-center justify-center mb-3 bg-white/60 dark:bg-white/5">
              <img className="p-1.5" src="/logo.svg" alt="logo" width={56} height={56} />
            </div>
            
            {/* CHATLESS 艺术字 */}
            <div className="mb-2">
              <img 
                src="/chatless-text.svg" 
                alt="CHATLESS" 
                className="w-40 h-auto drop-shadow-sm"
              />
            </div>
            
          
          </div>
          
          {/* 右侧：应用信息 */}
          <div className="flex-1 text-center md:text-left">
            <h2 className="italic text-lg text-slate-900 dark:text-slate-100 mb-1">
              {APP_INFO.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              v{versionInfo.version} · Build {versionInfo.build}
              {notLatest && (
                <span className="ml-2 inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
                  当前不是最新版本（可用：{notLatest.version}）
                  <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-200/70 text-slate-600 dark:bg-white/10 dark:text-slate-300 text-[10px] font-semibold align-middle">NEW</span>
                </span>
              )}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              {APP_INFO.description}
            </p>
            {/* 操作区：按钮 + 勾选框 */}
            <div className="flex items-center flex-wrap gap-4 mt-3">
              <Button 
                onClick={handleCheckUpdate}
                variant="outline"
                size="sm"
                className="bg-white/60 dark:bg-white/5 border-slate-300/70 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-white/10"
              >
                检查更新
              </Button>

              <Label htmlFor="only-check-update" className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500 select-none cursor-pointer">
                <Checkbox
                  id="only-check-update"
                  checked={onlyCheckDev}
                  onCheckedChange={async (next) => {
                    const checked = Boolean(next);
                    setOnlyCheckDev(checked);
                    if (typeof window !== 'undefined') {
                      (window as any).__CHATLESS_ONLY_CHECK_UPDATE__ = checked;
                    }
                    try {
                      await StorageUtil.setItem<boolean>('only_check_update', checked, 'user-preferences.json');
                    } catch {}
                  }}
                />
                仅检查更新，不自动安装
              </Label>
            </div>
          </div>
        </div>
      </section>

      {/* 支持与链接 */}
      <section>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 帮助中心 */}
          <div className={cn(aboutCardClass, "rounded-lg hover:bg-white/20 dark:hover:bg-white/[0.07] transition-colors")}>
            <h3 className="font-medium text-slate-800 dark:text-slate-200 text-sm">帮助中心</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">
              查找使用教程和常见问题
            </p>
            <button
              onClick={() => handleOpenLink(APP_INFO.helpCenter)}
              className={aboutLinkClass}
            >
              查看帮助 →
            </button>
          </div>

          {/* 提交反馈 */}
          <div className={cn(aboutCardClass, "rounded-lg hover:bg-white/20 dark:hover:bg-white/[0.07] transition-colors")}>
            <h3 className="font-medium text-slate-800 dark:text-slate-200 text-sm">意见反馈</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">
              分享使用体验，报告问题或提出建议
            </p>
            <button
              onClick={() => handleOpenLink(APP_INFO.feedback)}
              className={aboutLinkClass}
            >
              提交反馈 →
            </button>
          </div>

          {/* 官方网站 */}
          <div className={cn(aboutCardClass, "rounded-lg hover:bg-white/20 dark:hover:bg-white/[0.07] transition-colors")}>
            <h3 className="font-medium text-slate-800 dark:text-slate-200 text-sm">官方网站</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">
              了解更多产品信息和最新动态
            </p>
            <button
              onClick={() => handleOpenLink(APP_INFO.website)}
              className={aboutLinkClass}
            >
              访问官网 →
            </button>
          </div>

          {/* 加入社区 */}
          <div className={cn(aboutCardClass, "rounded-lg hover:bg-white/20 dark:hover:bg-white/[0.07] transition-colors")}>
            <h3 className="font-medium text-slate-800 dark:text-slate-200 text-sm">用户社区</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">
              与其他用户交流使用心得和技巧
            </p>
            <button
              onClick={() => handleOpenLink(APP_INFO.community)}
              className={aboutLinkClass}
            >
              加入社区 →
            </button>
          </div>
        </div>
      </section>

      {/* 法律信息 */}
      <footer className="pt-4 mt-20 text-center text-xs text-slate-400 dark:text-slate-500">
        <div className="space-x-3">
          <button
            onClick={() => handleOpenLink(APP_INFO.terms)}
            className="hover:text-slate-600 dark:hover:text-slate-300 hover:underline"
          >
            服务条款
          </button>
          <span>&middot;</span>
          <button
            onClick={() => handleOpenLink(APP_INFO.privacy)}
            className="hover:text-slate-600 dark:hover:text-slate-300 hover:underline"
          >
            隐私政策
          </button>
        </div>
        <p className="mt-1">© 2025 {APP_INFO.name}. All rights reserved.</p>
      </footer>
    </div>
  );
} 
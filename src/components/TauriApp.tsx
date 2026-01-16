"use client";

import { useEffect, useRef } from 'react';
import { performEnvironmentCheck, logEnvironmentInfo, type EnvironmentDetection } from '../lib/utils/environment';
import { useChatStore } from "@/store/chatStore";
import { initDatabaseService } from '@/lib/db';
import { Sidebar } from './Sidebar';
import { startupMonitor } from '@/lib/utils/startupPerformanceMonitor';
import { ThemeInitializer } from './theme/ThemeInitializer';
import { attachConsole } from '@tauri-apps/plugin-log';
import { initializeSampleDataIfNeeded } from '@/lib/sampleDataInitializer';
import { appCleanupService } from '@/lib/services/appCleanup';
import { scheduleBackgroundUpdateChecks } from '@/lib/update/update-notifier';
import { serverManager } from '@/lib/mcp/ServerManager';
import StorageUtil from '@/lib/storage';
import { StartupUpdateToast } from '@/components/update/StartupUpdateToast';

interface TauriAppProps {
  children: React.ReactNode;
}

export function TauriApp({ children }: TauriAppProps) {
  const loadConversations = useChatStore((state) => state.loadConversations);
  // 使用 ref 来防止重复初始化
  const hasInitializedRef = useRef(false);
  const initializationPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      // 防止重复初始化
      if (hasInitializedRef.current) {
        console.log('🔄 [TauriApp] 应用已初始化，跳过重复初始化');
        return;
      }

      // 如果正在初始化中，等待现有初始化完成
      if (initializationPromiseRef.current) {
        console.log('🔄 [TauriApp] 等待现有初始化完成...');
        await initializationPromiseRef.current;
        return;
      }

      // 创建新的初始化Promise
      initializationPromiseRef.current = performInitialization();
      
      try {
        await initializationPromiseRef.current;
        hasInitializedRef.current = true;
        
        // 应用初始化完成后，设置窗口关闭事件监听
        appCleanupService.setupWindowCloseListener().catch(error => {
          console.warn('⚠️ 设置窗口关闭事件监听器失败:', error);
        });
      } catch (error) {
        console.error('❌ [TauriApp] 应用初始化失败:', error);
        // 重置状态，允许重试
        hasInitializedRef.current = false;
        initializationPromiseRef.current = null;
      }
    };

    const performInitialization = async (): Promise<void> => {
      try {
        // 先确保将浏览器控制台日志转发到 Tauri 日志系统（避免初始化阶段日志丢失）
        if (typeof window !== 'undefined' && (window as any).__TAURI__) {
          try {
            await attachConsole();
          } catch {
            // 忽略 attach 失败
          }
        }

        // 测试Tauri日志系统
        console.log('🚀 [TauriApp] 应用启动中...');
        console.info('📋 [TauriApp] 初始化...');

        // 检查Tauri环境
        if (typeof window !== 'undefined' && window.__TAURI__) {
          console.log('✅ [TauriApp] 环境检测成功');
        } else {
          console.warn('⚠️ [TauriApp] 非PC应用环境，日志转发可能不可用');
        }

        // 初始化数据库连接
        startupMonitor.startPhase('数据库初始化');
        await initDatabaseService();
        startupMonitor.endPhase('数据库初始化');

        // 初始化示例数据（如果需要）
        startupMonitor.startPhase('示例数据初始化');
        // 异步执行示例数据初始化，不阻塞主流程
        setTimeout(async () => {
          try {
            // 使用数据完整性检查来决定是否需要初始化示例数据
            const { SampleDataInitializer } = await import('@/lib/sampleDataInitializer');
            
            // 检查示例数据是否完整
            const validation = await SampleDataInitializer.validateData();
            
            if (validation.isValid) {
              console.log('📋 [TauriApp] 示例数据已完整，跳过初始化');
              console.log(`   - 知识库数量: ${validation.summary.knowledgeBases}`);
              console.log(`   - 文档数量: ${validation.summary.documents}`);
            } else {
              console.log('📋 [TauriApp] 检测到示例数据不完整，开始初始化...');
              console.log('发现的问题:', validation.issues);
              
              const { initializeSampleDataIfNeeded } = await import('@/lib/sampleDataInitializer');
              
              await initializeSampleDataIfNeeded((step, progress) => {
                console.log(`[示例数据初始化] ${step}: ${progress}%`);
              });
              console.log('✅ [TauriApp] 示例数据初始化完成');
            }
          } catch (sampleDataError) {
            console.warn('⚠️ [TauriApp] 示例数据初始化失败，但不影响应用启动:', sampleDataError);
          }
        }, 1000); // 延迟1秒执行，确保数据库初始化完成
        startupMonitor.endPhase('示例数据初始化');

        // 延迟执行环境检查
        setTimeout(async () => {
          try {
            startupMonitor.startPhase('环境检查');
            await performEnvironmentCheck();
            startupMonitor.endPhase('环境检查');
          } catch (error) {
            console.error('❌ [TauriApp] 环境检查失败:', error);
          }
        }, 200);

        // 启用后台更新检查（无弹窗，仅记录状态）
        try {
          scheduleBackgroundUpdateChecks();
        } catch {}

        // 加载会话数据
        startupMonitor.startPhase('会话加载');
        await loadConversations();
        startupMonitor.endPhase('会话加载');

        // MCP 服务器初始化：极低优先级，确保不影响页面渲染
        // 策略：等待页面完全稳定后（多次空闲检测 + 最小延迟）才开始启动
        try {
          const startMcpInBackground = async () => {
            console.log('[TauriApp] 页面稳定，开始后台启动MCP服务...');
            
            try {
              await serverManager.init();
              console.log('[TauriApp] MCP服务启动完成');
            } catch (error) {
              console.warn('[TauriApp] MCP服务启动失败:', error);
            }
            
            // 初始化MCP持久化缓存
            try {
              const { persistentCache } = await import('@/lib/mcp/persistentCache');
              await persistentCache.init();
              console.log('[TauriApp] MCP持久化缓存已初始化');
            } catch (error) {
              console.warn('[TauriApp] MCP持久化缓存初始化失败:', error);
            }
          };
          
          // 智能延迟启动MCP：确保页面真正稳定后才启动
          // 1. 等待 document 完全加载
          // 2. 再等待多次 requestIdleCallback 确认浏览器真正空闲
          // 3. 最少延迟 3 秒，避免与页面编译争抢资源
          const waitForPageStable = () => {
            const MIN_DELAY_MS = 3000; // 最少等待3秒
            const startTime = Date.now();
            
            const scheduleWhenIdle = (idleCount: number) => {
              // 需要连续 3 次空闲检测才启动（确保真正空闲）
              if (idleCount >= 3) {
                // 确保至少等待了 MIN_DELAY_MS
                const elapsed = Date.now() - startTime;
                if (elapsed < MIN_DELAY_MS) {
                  setTimeout(() => startMcpInBackground(), MIN_DELAY_MS - elapsed);
                } else {
                  startMcpInBackground();
                }
                return;
              }
              
              if ('requestIdleCallback' in window) {
                (window as any).requestIdleCallback(
                  (deadline: { didTimeout: boolean; timeRemaining: () => number }) => {
                    // 只有在有足够空闲时间时才计数
                    if (deadline.timeRemaining() > 10 || deadline.didTimeout) {
                      scheduleWhenIdle(idleCount + 1);
                    } else {
                      // 空闲时间不够，重新等待
                      scheduleWhenIdle(idleCount);
                    }
                  },
                  { timeout: 5000 }
                );
              } else {
                // 回退：简单的 setTimeout
                setTimeout(() => scheduleWhenIdle(idleCount + 1), 1000);
              }
            };
            
            // 开始等待空闲
            scheduleWhenIdle(0);
          };
          
          // 等待 document 完成加载后再开始
          if (document.readyState === 'complete') {
            waitForPageStable();
          } else {
            window.addEventListener('load', waitForPageStable, { once: true });
          }
        } catch { /* noop */ }

        console.log('✅ [TauriApp] 应用初始化完成');
      } catch (error) {
        console.error('❌ [TauriApp] 应用初始化失败:', error);
        throw error;
      }
    };

    initializeApp();
  }, [loadConversations]);

  return (
    <div className="flex h-full">
      {/* 主题初始化组件 - 在客户端渲染时立即应用主题 */}
      <ThemeInitializer />
      {/* 启动更新提示（右下角通知） */}
      <StartupUpdateToast />
      
      <Sidebar />
      <div
        className="flex-1 relative overflow-x-hidden"
        style={{ marginLeft: 'var(--sidebar-width, 4.5rem)' }}
      >
        {children}
      </div>
    </div>
  );
}

// 默认导出以保持向后兼容
export default TauriApp; 
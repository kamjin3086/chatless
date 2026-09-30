/**
 * 基于Tauri日志插件的简洁日志工具
 * 自动转发控制台日志，支持直接使用console.log
 */

import { warn, debug, trace, info, error, attachConsole } from '@tauri-apps/plugin-log';
import { StorageUtil } from './storage';

type LogLevel = 'none' | 'debug' | 'info' | 'warn' | 'error';

/**
 * 自动转发控制台日志到Tauri日志系统
 */
function forwardConsole(fnName: 'log' | 'debug' | 'info' | 'warn' | 'error', logger: (message: string) => Promise<void>) {
  const original = console[fnName];
  console[fnName] = (message: any, ...args: any[]) => {
    // 调用原始console方法
    original(message, ...args);
    // 转发到Tauri日志系统
    const fullMessage = args.length > 0 ? `${message} ${args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ')}` : String(message);
    logger(fullMessage).catch(err => {
      // 如果Tauri日志失败，只记录到原始console
      original('Tauri日志转发失败:', err);
    });
  };
}

/**
 * 简洁的Logger类
 * 主要提供日志级别控制和Tauri日志系统初始化
 */
class Logger {
  private logLevel: LogLevel = 'info';
  private isInitialized = false;
  
  // 环境控制
  private readonly isDevelopment = process.env.NODE_ENV === 'development' || process.env.FORCE_LOGS === 'true';
  private readonly shouldOutput = this.isDevelopment;

  constructor() {
    this.initializeSettings();
  }

  /**
   * 异步初始化设置
   */
  private async initializeSettings(): Promise<void> {
    await this.loadLogLevelSetting();
    await this.initializeTauriLog();
  }

  /**
   * 初始化Tauri日志系统并设置控制台转发
   */
  private async initializeTauriLog(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.__TAURI__) {
        // 附加控制台到Tauri日志系统
        await attachConsole();

        // Rust 侧才是真正做过滤的日志级别。启动时把持久化的级别重新下发一遍，
        // 否则重启后会静默退回 info，调试级别的 dump 又会消失。
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_log_level', { level: this.logLevel });
        } catch {
          // 命令不可用时忽略：日志级别只影响调试输出
        }
        
        // 设置控制台转发
        if (this.shouldOutput) {
          forwardConsole('log', trace);
          forwardConsole('debug', debug);
          forwardConsole('info', info);
          forwardConsole('warn', warn);
          forwardConsole('error', error);
        }
        
        this.isInitialized = true;
        console.info('✅ Tauri日志系统初始化完成，控制台日志已自动转发');
      }
    } catch (err) {
      console.warn('⚠️ Tauri日志系统初始化失败，回退到控制台输出:', err);
    }
  }

  /**
   * 检查是否应该输出指定级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    if (this.logLevel === 'none') return false;
    
    const levelOrder = { 'none': 0, 'error': 1, 'warn': 2, 'info': 3, 'debug': 4 };
    return levelOrder[level] <= levelOrder[this.logLevel];
  }

  /**
   * 设置日志级别
   */
  async setLogLevel(level: LogLevel): Promise<void> {
    this.logLevel = level;
    await this.saveLogLevelSetting();
    console.info(`📋 日志级别已设置为: ${level}`);
  }

  /**
   * 获取当前日志级别
   */
  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * 获取日志文件路径信息
   */
  getLogInfo(): string {
    return `日志级别: ${this.logLevel}, 环境: ${this.isDevelopment ? '开发' : '生产'}, Tauri日志: ${this.isInitialized ? '已初始化' : '未初始化'}`;
  }

  /**
   * 从本地存储加载日志级别设置
   */
  private async loadLogLevelSetting(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        const saved = await StorageUtil.getItem('logger_log_level');
        if (saved !== null) {
          this.logLevel = JSON.parse(saved);
        }
      }
    } catch (error) {
      console.warn('Failed to load log level setting from storage:', error);
      this.logLevel = 'info';
    }
  }

  /**
   * 保存日志级别设置到本地存储
   */
  private async saveLogLevelSetting(): Promise<void> {
    try {
      if (typeof window !== 'undefined') {
        await StorageUtil.setItem('logger_log_level', JSON.stringify(this.logLevel));
      }
    } catch (error) {
      console.warn('Failed to save log level setting to storage:', error);
          }
  }
  }

// 创建全局实例
declare global {
  var __APP_LOGGER__: Logger | undefined;
}

if (!globalThis.__APP_LOGGER__) {
  globalThis.__APP_LOGGER__ = new Logger();
}

export const logger = globalThis.__APP_LOGGER__;

// 移除不再需要的导出函数，因为现在使用Tauri日志插件
// 所有console调用都会自动转发到Tauri日志系统

/**
 * 使用说明：
 * 
 * // 直接使用console，自动转发到Tauri日志系统
 * console.log('这是一条信息');
 * console.info('这是一条信息');
 * console.warn('这是一条警告');
 * console.error('发生错误', error);
 * console.debug('调试信息');
 * 
 * // 如果需要设置日志级别
 * import { setLogLevel } from '@/lib/logger';
 * await setLogLevel('debug');
 * 
 * // 环境控制：
 * // - 开发环境：所有console日志都会自动转发到Tauri日志系统
 * // - 生产环境：只有错误日志转发
 * // - 强制模式：设置 FORCE_LOGS=true 可强制转发所有日志
 * 
 * // 日志文件位置：
 * // - Windows: %APPDATA%\{bundleIdentifier}\logs\app.log
 * // - macOS: ~/Library/Logs/{bundleIdentifier}/app.log
 * // - Linux: ~/.local/share/{bundleIdentifier}/logs/app.log
 */ 
import { openPath } from '@tauri-apps/plugin-opener';
import { exists } from '@tauri-apps/plugin-fs';
import { toast } from '@/components/ui/sonner';
import { useState } from 'react';
import { resolveAliasPath } from '@/lib/filesystemAllowlist/displayPathAliases';
import { openCheckedPath } from '@/lib/filesystemAllowlist/openCheckedPath';

/**
 * 文件打开工具类
 * 使用系统默认程序打开文档，提供最佳用户体验
 * 
 * 优势：
 * - 零维护成本，无需在应用内渲染文档
 * - 用户体验优秀，使用熟悉的系统程序
 * - 功能完整，支持所有系统支持的文档格式
 * - 代码量极少，仅需几行核心代码
 */
export class FileOpener {
  // 避免重复触发 opener：某些环境下重复调用会导致先打开默认目录（如 Documents）再打开目标目录
  private static _lastOpen: { path: string; ts: number } | null = null;
  private static readonly _DEDUPE_WINDOW_MS = 1200;

  private static normalizeForOpen(input: string): string {
    const raw = String(input || '').trim();
    if (!raw) return '';
    // 将 @Alias / @WorkDir 解析为绝对路径（若可解析）
    const resolved = resolveAliasPath({ path: raw });
    // Windows 下用反斜杠更贴近 Explorer；同时避免把路径当成 URL
    return String(resolved).replace(/\//g, '\\');
  }

  private static shouldSkipDuplicate(path: string): boolean {
    const p = String(path || '');
    if (!p) return true;
    const now = Date.now();
    const last = this._lastOpen;
    if (last && last.path === p && (now - last.ts) < this._DEDUPE_WINDOW_MS) return true;
    this._lastOpen = { path: p, ts: now };
    return false;
  }
  
  /**
   * 使用系统默认程序打开文件
   * @param filePath 文件路径
   * @param fileName 文件名（用于提示信息）
   * @returns Promise<boolean> 是否成功打开
   */
  static async openFile(filePath: string, fileName?: string): Promise<boolean> {
    try {
      const normalized = this.normalizeForOpen(filePath);
      if (!normalized) {
        toast.error('打开文件失败', { description: '路径为空' });
        return false;
      }
      if (this.shouldSkipDuplicate(normalized)) return true;

      // 检查文件是否存在
      // 注意：在权限受限情况下 exists 可能失败；失败时降级为直接 openPath
      try {
        const fileExists = await exists(normalized);
        if (!fileExists) {
          // 仍尝试打开（某些系统关联程序可以处理不存在/快捷方式等场景）
          // 但给出提示更友好
          toast.error('文件不存在', {
            description: `无法找到文件: ${fileName || normalized}`
          });
          return false;
        }
      } catch {
        // ignore exists errors
      }

      // 使用系统默认程序打开文件
      // 先走应用自己的命令（能打开用户目录与会话产物目录），再退回受限插件。
      const opened = await openCheckedPath(normalized);
      if (!opened) await openPath(normalized);
      
      toast.success('文档已打开', {
        description: `已使用系统默认程序打开: ${fileName || '文档'}`
      });
      
      return true;
    } catch (error) {
      console.error('打开文件失败:', error);
      
      toast.error('打开文件失败', {
        description: error instanceof Error 
          ? error.message 
          : '未知错误，请检查文件路径是否正确'
      });
      
      return false;
    }
  }
  
  /**
   * 检查文件是否存在
   * @param filePath 文件路径
   * @returns Promise<boolean> 文件是否存在
   */
  static async checkFileExists(filePath: string): Promise<boolean> {
    try {
      const normalized = this.normalizeForOpen(filePath);
      if (!normalized) return false;
      return await exists(normalized);
    } catch (error) {
      console.error('检查文件存在性失败:', error);
      return false;
    }
  }
  
  /**
   * 获取支持的文档类型说明
   * @returns 支持的文档类型列表
   */
  static getSupportedTypes(): string[] {
    return [
      'PDF (.pdf)',
      'Word文档 (.docx, .doc)',
      'Markdown文件 (.md, .markdown)', 
      '文本文件 (.txt)',
      '以及系统支持的其他格式'
    ];
  }

  /**
   * 打开文件所在的文件夹
   * @param filePath 文件路径
   * @returns Promise<boolean> 是否成功打开
   */
  static async openFileLocation(filePath: string): Promise<boolean> {
    try {
      const normalized = this.normalizeForOpen(filePath);
      if (!normalized) {
        toast.error('无法打开文件位置', { description: '路径为空' });
        return false;
      }

      // 获取文件所在目录（修复：lastIndexOf('/') 为 -1 时不能用 `||`）
      const i1 = normalized.lastIndexOf('\\');
      const i2 = normalized.lastIndexOf('/');
      const cut = Math.max(i1, i2);
      const directory = cut >= 0 ? normalized.slice(0, cut) : normalized;

      if (this.shouldSkipDuplicate(directory)) return true;
      const openedDir = await openCheckedPath(directory);
      if (!openedDir) await openPath(directory);
      
      toast.success('已打开文件位置');
      
      return true;
    } catch (error) {
      console.error('打开文件位置失败:', error);
      toast.error('无法打开文件位置');
      return false;
    }
  }

  /**
   * 打开目录（不依赖 fs 权限校验；仅做去重与别名解析）
   */
  static async openDirectory(dirPath: string): Promise<boolean> {
    try {
      const normalized = this.normalizeForOpen(dirPath);
      if (!normalized) {
        toast.error('打开目录失败', { description: '路径为空' });
        return false;
      }
      if (this.shouldSkipDuplicate(normalized)) return true;
      const openedTarget = await openCheckedPath(normalized);
      if (!openedTarget) await openPath(normalized);
      return true;
    } catch (e) {
      toast.error('打开目录失败', { description: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /**
   * 获取支持的文件类型提示信息
   * @param fileType 文件类型
   * @returns 提示信息
   */
  static getFileTypeHint(fileType: string): string {
    const hints: Record<string, string> = {
      'pdf': '将使用系统默认的PDF阅读器打开',
      'docx': '将使用Word或兼容程序打开',
      'doc': '将使用Word或兼容程序打开', 
      'md': '将使用Markdown编辑器或文本编辑器打开',
      'markdown': '将使用Markdown编辑器或文本编辑器打开',
      'txt': '将使用文本编辑器打开',
      'xlsx': '将使用Excel或兼容程序打开',
      'pptx': '将使用PowerPoint或兼容程序打开'
    };
    
    return hints[fileType.toLowerCase()] || '将使用系统默认程序打开';
  }

  /**
   * 批量操作：打开多个文件
   * @param filePaths 文件路径数组
   * @param maxConcurrent 最大并发数，默认5
   */
  static async openMultipleFiles(
    filePaths: string[], 
    maxConcurrent: number = 5
  ): Promise<void> {
    if (filePaths.length === 0) return;
    
    if (filePaths.length > 10) {
      toast.warning('文件数量过多', {
        description: `您选择了${filePaths.length}个文件，建议分批打开`
      });
      return;
    }
    
    // 分批处理文件
    for (let i = 0; i < filePaths.length; i += maxConcurrent) {
      const batch = filePaths.slice(i, i + maxConcurrent);
      const promises = batch.map(path => this.openFile(path));
      
      await Promise.allSettled(promises);
      
      // 添加小延时避免系统过载
      if (i + maxConcurrent < filePaths.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * 获取文件类型对应的系统程序信息
   * 用于在UI中显示提示信息
   */
  static getFileTypeInfo(filePath: string): { 
    extension: string; 
    description: string; 
    icon: string; 
  } {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    
    const typeMap: Record<string, { description: string; icon: string }> = {
      'pdf': { description: 'PDF文档', icon: '📄' },
      'docx': { description: 'Word文档', icon: '📝' },
      'doc': { description: 'Word文档', icon: '📝' },
      'md': { description: 'Markdown文档', icon: '📑' },
      'markdown': { description: 'Markdown文档', icon: '📑' },
      'txt': { description: '文本文档', icon: '📄' },
      'rtf': { description: 'RTF文档', icon: '📄' },
      'odt': { description: 'OpenDocument文档', icon: '📄' },
    };

    return {
      extension,
      description: typeMap[extension]?.description || '文档',
      icon: typeMap[extension]?.icon || '📄'
    };
  }
}

/**
 * React Hook：文件打开功能
 * 提供加载状态和错误处理
 */
export function useFileOpener() {
  const [isOpening, setIsOpening] = useState(false);

  const openFile = async (filePath: string, fileName?: string) => {
    setIsOpening(true);
    try {
      const success = await FileOpener.openFile(filePath, fileName);
      return success;
    } finally {
      setIsOpening(false);
    }
  };

  return {
    openFile,
    isOpening
  };
} 

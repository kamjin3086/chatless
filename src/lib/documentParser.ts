// 文档解析工具类

import { invoke } from '@tauri-apps/api/core';
import { stat } from '@tauri-apps/plugin-fs';
import { 
  DocumentParseResult, 
  DocumentParseOptions, 
  SupportedFileType, 
  DocumentMetadata 
} from '@/types/document';

export type DocumentFileParseFailure =
  | { code: 'missing-file' }
  | { code: 'file-too-large'; maxBytes: number }
  | { code: 'unsupported-file-type'; fileType: string }
  | { code: 'timeout' }
  | { code: 'parse-failed'; diagnostic?: string };

type DocumentFileParseResult =
  | { success: true; content: string; fileType: string; fileName: string; fileSize: number }
  | { success: false; failure: DocumentFileParseFailure };

class DocumentParseTimeoutError extends Error {}

export class DocumentParser {
  private static readonly DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB，与后端一致
  private static readonly DEFAULT_TIMEOUT_MS = 30_000; // 30s 超时保护
  
  /**
   * 解析文档文本内容（从文件路径）
   * @param filePath 文件路径
   * @param options 解析选项
   * @returns 解析结果
   */
  static async parseDocument(
    filePath: string, 
    options: DocumentParseOptions = {}
  ): Promise<DocumentParseResult> {
    try {
      // 验证文件路径
      if (!filePath || filePath.trim() === '') {
        return {
          success: false,
          error: '文件路径不能为空'
        };
      }

      // 获取文件元数据
      const metadata = await this.getFileMetadata(filePath);
      
      // 检查文件大小
      const maxSize = options.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;
      if (metadata.fileSize > maxSize) {
        return {
          success: false,
          error: `文件大小超过限制 (${Math.round(maxSize / 1024 / 1024)}MB)`
        };
      }

      // 检查文件类型支持
      const isSupported = await this.isSupportedFileType(metadata.fileType);
      if (!isSupported) {
        return {
          success: false,
          error: `不支持的文件类型: ${metadata.fileType}`
        };
      }

      // 调用 Tauri 后端解析文档（超时保护）
      const content = await this.withTimeout(
        invoke<string>('parse_document_text', { filePath }),
        options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS,
        '解析文档'
      );

      return {
        success: true,
        content,
        fileType: metadata.fileType,
        fileName: metadata.fileName,
        fileSize: metadata.fileSize
      };

    } catch (error) {
      console.error('文档解析失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '文档解析失败'
      };
    }
  }

  /**
   * 从File对象解析文档（统一使用二进制数据传输）
   * @param file File对象
   * @param options 解析选项
   * @returns 解析结果
   */
  static async parseFileObject(
    file: File,
    options: DocumentParseOptions = {}
  ): Promise<DocumentFileParseResult> {
    try {
      if (!file) {
        return { success: false, failure: { code: 'missing-file' } };
      }

      const maxSize = options.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;
      if (file.size > maxSize) {
        return { success: false, failure: { code: 'file-too-large', maxBytes: maxSize } };
      }

      const fileType = this.getFileExtension(file.name);
      const isSupported = await this.isSupportedFileType(fileType);
      if (!isSupported) {
        return { success: false, failure: { code: 'unsupported-file-type', fileType } };
      }

      // 读取文件内容为二进制数组
      const fileBuffer = await file.arrayBuffer();
      const fileContent = Array.from(new Uint8Array(fileBuffer));

      // 使用新的统一二进制解析命令
      const content = await this.withTimeout(
        invoke<string>('parse_document_from_binary', { fileName: file.name, fileContent }),
        options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS,
        '解析文档'
      );

      // 主动释放引用，提示 GC
       
      (fileBuffer as unknown as null);

      return {
        success: true,
        content,
        fileType,
        fileName: file.name,
        fileSize: file.size
      };

    } catch (error) {
      console.error('文档解析失败:', error);
      return {
        success: false,
        failure: error instanceof DocumentParseTimeoutError
          ? { code: 'timeout' }
          : { code: 'parse-failed', diagnostic: error instanceof Error ? error.message : undefined },
      };
    }
  }

  /**
   * 获取文件元数据
   * @param filePath 文件路径
   * @returns 文件元数据
   */
  static async getFileMetadata(filePath: string): Promise<DocumentMetadata> {
    try {
      const fileStats = await stat(filePath);
      const fileName = filePath.split(/[\\/]/).pop() || '';
      const fileType = this.getFileExtension(fileName);
      
      return {
        fileName,
        fileSize: fileStats.size,
        fileType,
        lastModified: new Date(fileStats.mtime || 0),
        filePath
      };
    } catch (error) {
      throw new Error(`无法获取文件信息: ${error}`);
    }
  }

  /**
   * 获取支持的文件类型列表
   * @returns 支持的文件类型数组
   */
  static async getSupportedFileTypes(): Promise<SupportedFileType[]> {
    try {
      const types = await invoke<string[]>('get_supported_file_types');
      return types as SupportedFileType[];
    } catch (error) {
      console.error('获取支持的文件类型失败:', error);
      // 返回默认的支持类型
      return ['pdf', 'docx', 'md', 'markdown', 'txt', 'json', 'csv', 'xlsx', 'xls', 'html', 'htm', 'rtf', 'epub'] as unknown as SupportedFileType[];
    }
  }

  /**
   * 检查文件类型是否受支持
   * @param fileType 文件类型
   * @returns 是否支持
   */
  static async isSupportedFileType(fileType: string): Promise<boolean> {
    const supportedTypes = await this.getSupportedFileTypes();
    return supportedTypes.includes(fileType as SupportedFileType);
  }

  /**
   * 从文件名获取扩展名
   * @param fileName 文件名
   * @returns 文件扩展名（小写）
   */
  private static getFileExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1 || lastDotIndex === fileName.length - 1) {
      return '';
    }
    return fileName.substring(lastDotIndex + 1).toLowerCase();
  }

  /**
   * promise 超时保护
   */
  private static withTimeout<T>(promise: Promise<T>, ms: number, label = '操作'): Promise<T> {
    let timer: any;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DocumentParseTimeoutError(`${label}超时，请稍后重试`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  /**
   * 验证文档内容
   * @param content 文档内容
   * @returns 验证结果
   */
  static validateDocumentContent(content: string): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (!content || content.trim() === '') {
      issues.push('文档内容为空');
    }

    if (content.length < 10) {
      issues.push('文档内容过短（少于10个字符）');
    }

    if (content.length > 1000000) {
      issues.push('文档内容过长（超过1MB）');
    }

    // 检查是否包含乱码
    const invalidCharsPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
    if (invalidCharsPattern.test(content)) {
      issues.push('文档可能包含乱码字符');
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  /**
   * 清理文档内容
   * @param content 原始内容
   * @returns 清理后的内容
   */
  static cleanDocumentContent(content: string): string {
    if (!content) return '';

    return content
      // 去除多余的空白字符
      .replace(/\s+/g, ' ')
      // 去除首尾空白
      .trim()
      // 标准化换行符
      .replace(/\r\n|\r/g, '\n')
      // 去除过多的连续换行
      .replace(/\n{3,}/g, '\n\n')
      // 去除行首行尾空白
      .split('\n')
      .map(line => line.trim())
      .join('\n');
  }

  /**
   * 获取文档摘要
   * @param content 文档内容
   * @param maxLength 最大长度
   * @returns 文档摘要
   */
  static getDocumentSummary(content: string, maxLength: number = 200): string {
    if (!content) return '';

    const cleanContent = this.cleanDocumentContent(content);
    
    if (cleanContent.length <= maxLength) {
      return cleanContent;
    }

    // 尝试在句号处截断
    const truncated = cleanContent.substring(0, maxLength);
    const lastPeriodIndex = truncated.lastIndexOf('。');
    const lastDotIndex = truncated.lastIndexOf('.');

    const cutIndex = Math.max(lastPeriodIndex, lastDotIndex);
    
    if (cutIndex > maxLength * 0.7) {
      return cleanContent.substring(0, cutIndex + 1) + '...';
    }

    // 如果没有合适的句号，在最后一个空格处截断
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    if (lastSpaceIndex > maxLength * 0.8) {
      return cleanContent.substring(0, lastSpaceIndex) + '...';
    }

    return truncated + '...';
  }
} 
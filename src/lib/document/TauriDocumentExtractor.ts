import { DocumentExtractor, DocumentExtractionError, ExtractedDocument } from './types';
import { invoke } from '@tauri-apps/api/core';

/**
 * 基于Tauri API的文档提取器
 * 使用现有的文档解析命令，避免重复实现
 */
export class TauriDocumentExtractor implements DocumentExtractor {
  public supportedTypes: string[] = [];
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // 立即设置默认支持的类型
    this.supportedTypes = ['pdf', 'docx', 'md', 'markdown', 'txt', 'json'];
    // 异步获取真实的支持类型，但不阻塞构造函数
    this.initializationPromise = this.initializeSupportedTypes();
  }

  private async initializeSupportedTypes(): Promise<void> {
    try {
      const supportedTypes = await invoke<string[]>('get_supported_file_types');
      this.supportedTypes = supportedTypes;
      console.log('支持的文件类型:', this.supportedTypes);
    } catch (error) {
      console.error('获取支持的文件类型失败:', error);
      // 保持默认支持的类型
      console.log('使用默认支持的文件类型:', this.supportedTypes);
    }
  }

  async extractFromFile(filePath: string): Promise<ExtractedDocument> {
    try {
      // 确保支持的文件类型已初始化
      if (this.initializationPromise) {
        await this.initializationPromise;
        this.initializationPromise = null;
      }

      // 验证文件路径参数
      if (!filePath || typeof filePath !== 'string') {
        throw new DocumentExtractionError(`无效的文件路径: ${filePath}`);
      }
      
      // 验证文件类型
      const fileExtension = this.getFileExtension(filePath);
      if (!fileExtension) {
        throw new DocumentExtractionError(`无法确定文件类型，文件路径可能无效: ${filePath}`);
      }
      
      if (!this.isFileSupported(filePath)) {
        throw new DocumentExtractionError(`不支持的文件类型: ${fileExtension}。支持的类型: ${this.supportedTypes.join(', ')}`);
      }

      // 调用Tauri命令解析文档
      let parsed: import('@/lib/rag/evidenceTypes').ParsedDocument | undefined;
      let content = '';
      try {
        parsed = await invoke<import('@/lib/rag/evidenceTypes').ParsedDocument>('parse_document_structured', {
          filePath,
        });
        content = (parsed?.plainText || '').trim();
      } catch {
        content = (await invoke<string>('parse_document_text', { filePath })).trim();
      }

      const fileName = this.getFileName(filePath);

      return {
        content: content.trim(),
        parsed,
        metadata: {
          fileName,
          filePath,
          fileType: fileExtension,
          extractedAt: new Date(),
          extractorType: 'tauri',
          wordCount: this.countWords(content),
          characterCount: content.length,
        },
      };

    } catch (error) {
      throw new DocumentExtractionError(
        `文档提取失败 (${filePath}): ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  async extractFromBuffer(
    buffer: ArrayBuffer, 
    fileName: string
  ): Promise<ExtractedDocument> {
    try {
      // 验证文件类型
      if (!this.isFileSupported(fileName)) {
        throw new DocumentExtractionError(`不支持的文件类型: ${this.getFileExtension(fileName)}。支持的类型: ${this.supportedTypes.join(', ')}`);
      }

      // 将 ArrayBuffer 转换为 Uint8Array
      const uint8Array = new Uint8Array(buffer);
      const fileContent = Array.from(uint8Array);

      // 调用Tauri命令解析文档（JSON特殊处理：直接解析为文本）
      let content: string;
      const ext = this.getFileExtension(fileName);
      if (ext === 'json') {
        try {
          const decoder = new TextDecoder('utf-8');
          const jsonText = decoder.decode(buffer);
          // 压缩为单行文本，避免换行噪声
          content = jsonText.trim();
        } catch (e) {
          throw new DocumentExtractionError(`JSON 文本解析失败: ${(e as Error)?.message || e}`);
        }
      } else {
        content = await invoke<string>('parse_document_from_binary', {
          fileName: fileName,
          fileContent: fileContent
        });
      }

      const fileExtension = this.getFileExtension(fileName);

      return {
        content: content.trim(),
        metadata: {
          fileName,
          filePath: fileName, // 对于buffer模式，使用fileName作为标识
          fileType: fileExtension,
          extractedAt: new Date(),
          extractorType: 'tauri',
          wordCount: this.countWords(content),
          characterCount: content.length,
        },
      };

    } catch (error) {
      throw new DocumentExtractionError(
        `文档提取失败 (${fileName}): ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  async extractFromText(
    text: string, 
    fileName: string
  ): Promise<ExtractedDocument> {
    try {
      const fileExtension = this.getFileExtension(fileName);
      
      // 对于纯文本或Markdown，可以直接处理或调用Tauri命令
      let content = text;
      
      if (fileExtension === 'md' || fileExtension === 'markdown') {
        // 对于Markdown，使用Tauri的解析命令
        const encoder = new TextEncoder();
        const fileContent = Array.from(encoder.encode(text));
        
        content = await invoke<string>('parse_document_content', {
          fileName: fileName,
          fileContent: fileContent
        });
      }

      return {
        content: content.trim(),
        metadata: {
          fileName,
          filePath: fileName,
          fileType: fileExtension,
          extractedAt: new Date(),
          extractorType: 'tauri',
          wordCount: this.countWords(content),
          characterCount: content.length,
        },
      };

    } catch (error) {
      throw new DocumentExtractionError(
        `文本处理失败 (${fileName}): ${error instanceof Error ? error.message : '未知错误'}`
      );
    }
  }

  isFileSupported(filePath: string): boolean {
    const extension = this.getFileExtension(filePath);
    return this.supportedTypes.includes(extension);
  }

  getSupportedFormats(): string[] {
    return [...this.supportedTypes];
  }

  // 实现 DocumentExtractor 接口的方法
  extractText(filePath: string): Promise<string> {
    return this.extractFromFile(filePath).then(doc => doc.content);
  }

  getName(): string {
    return 'TauriDocumentExtractor';
  }

  supports(fileType: string): boolean {
    return this.supportedTypes.includes(fileType.toLowerCase());
  }

  /**
   * 获取文件扩展名
   */
  private getFileExtension(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      console.warn('getFileExtension: 无效的文件路径', filePath);
      return '';
    }
    const lastDotIndex = filePath.lastIndexOf('.');
    if (lastDotIndex === -1) return '';
    return filePath.substring(lastDotIndex + 1).toLowerCase();
  }

  /**
   * 获取文件名（不包含路径）
   */
  private getFileName(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      console.warn('getFileName: 无效的文件路径', filePath);
      return '未知文件';
    }
    const lastSlashIndex = Math.max(
      filePath.lastIndexOf('/'),
      filePath.lastIndexOf('\\')
    );
    return lastSlashIndex === -1 ? filePath : filePath.substring(lastSlashIndex + 1);
  }

  /**
   * 统计词数（简单实现）
   */
  private countWords(text: string): number {
    if (!text || text.trim().length === 0) return 0;
    return text.trim().split(/\s+/).length;
  }

  /**
   * 获取支持的文件类型（异步方法，确保类型列表已加载）
   */
  async getSupportedFormatsAsync(): Promise<string[]> {
    // 确保支持的文件类型已初始化
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }
    return this.getSupportedFormats();
  }

  /**
   * 验证文件是否可以处理
   */
  async validateFile(filePath: string): Promise<{
    isSupported: boolean;
    fileType: string;
    reason?: string;
  }> {
    // 确保支持的文件类型已初始化
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }

    const fileType = this.getFileExtension(filePath);
    const supportedFormats = this.getSupportedFormats();
    
    if (!supportedFormats.includes(fileType)) {
      return {
        isSupported: false,
        fileType,
        reason: `不支持的文件类型: ${fileType}。支持的类型: ${supportedFormats.join(', ')}`
      };
    }

    return {
      isSupported: true,
      fileType
    };
  }
} 
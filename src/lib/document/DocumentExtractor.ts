import { DocumentExtractor, ExtractionResult, DocumentMetadata, ExtractionOptions, UnsupportedFileTypeError, FileTooLargeError } from './types';
import { TauriDocumentExtractor } from './TauriDocumentExtractor';

/**
 * 统一文档内容提取器
 * 使用现有的Tauri API，避免重复实现
 */
export class DocumentExtractionService {
  private extractor: TauriDocumentExtractor;

  constructor() {
    this.extractor = new TauriDocumentExtractor();
  }

  /**
   * 检查是否支持指定文件类型
   */
  async supports(fileType: string): Promise<boolean> {
    const supportedTypes = await this.extractor.getSupportedFormatsAsync();
    return supportedTypes.includes(fileType.toLowerCase());
  }

  /**
   * 获取支持的文件类型列表
   */
  async getSupportedTypes(): Promise<string[]> {
    return await this.extractor.getSupportedFormatsAsync();
  }

  /**
   * 根据文件路径获取文件类型
   */
  private getFileType(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      console.warn('getFileType: 无效的文件路径', filePath);
      return '';
    }
    const extension = filePath.split('.').pop()?.toLowerCase();
    return extension || '';
  }

  /**
   * 提取文档内容（从文件路径）
   */
  async extractDocument(
    filePath: string, 
    options?: ExtractionOptions
  ): Promise<ExtractionResult> {
    try {
      // 验证文件路径参数
      if (!filePath || typeof filePath !== 'string') {
        throw new Error(`无效的文件路径: ${filePath}`);
      }
      
      console.log(`开始提取文档: ${filePath}`);
      
      const startTime = Date.now();
      const extractedDoc = await this.extractor.extractFromFile(filePath);
      const extractionTime = Date.now() - startTime;

      // 应用选项
      let processedText = extractedDoc.content;
      if (options?.maxLength && extractedDoc.content.length > options.maxLength) {
        processedText = extractedDoc.content.substring(0, options.maxLength);
        console.log(`文本已截断到 ${options.maxLength} 字符`);
      }

      // 转换元数据格式
      const metadata: DocumentMetadata = {
        title: extractedDoc.metadata.fileName.split('.').slice(0, -1).join('.'),
        fileSize: extractedDoc.metadata.characterCount, // 使用字符数作为近似文件大小
        fileType: extractedDoc.metadata.fileType,
        wordCount: extractedDoc.metadata.wordCount,
        extractedAt: extractedDoc.metadata.extractedAt,
        language: this.detectLanguage(extractedDoc.content)
      };

      return {
        text: processedText,
        metadata,
        parsed: extractedDoc.parsed,
        success: true
      };

    } catch (error) {
      console.error(`提取文档失败: ${filePath}`, error);
      
      return {
        text: '',
        metadata: await this.createDefaultMetadata(filePath),
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 提取文档内容（从文件buffer）
   */
  async extractFromBuffer(
    buffer: ArrayBuffer,
    fileName: string,
    options?: ExtractionOptions
  ): Promise<ExtractionResult> {
    try {
      console.log(`开始提取文档（从buffer）: ${fileName}`);
      // 大小校验
      if (options?.maxFileSizeBytes && buffer.byteLength > options.maxFileSizeBytes) {
        throw new FileTooLargeError(options.maxFileSizeBytes);
      }
      
      const startTime = Date.now();
      const extractedDoc = await this.extractor.extractFromBuffer(buffer, fileName);
      const extractionTime = Date.now() - startTime;

      // 应用选项
      let processedText = extractedDoc.content;
      if (options?.maxLength && extractedDoc.content.length > options.maxLength) {
        processedText = extractedDoc.content.substring(0, options.maxLength);
        console.log(`文本已截断到 ${options.maxLength} 字符`);
      }

             // 转换元数据格式
       const metadata: DocumentMetadata = {
         title: extractedDoc.metadata.fileName.split('.').slice(0, -1).join('.'),
         fileSize: extractedDoc.metadata.characterCount,
         fileType: extractedDoc.metadata.fileType,
         wordCount: extractedDoc.metadata.wordCount,
         extractedAt: extractedDoc.metadata.extractedAt,
         language: this.detectLanguage(extractedDoc.content)
       };

      return {
        text: processedText,
        metadata,
        parsed: extractedDoc.parsed,
        success: true
      };

    } catch (error) {
      console.error(`提取文档失败（从buffer）: ${fileName}`, error);
      
      return {
        text: '',
        metadata: await this.createDefaultMetadata(fileName),
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 批量提取文档
   */
  async extractDocuments(
    filePaths: string[], 
    options?: ExtractionOptions
  ): Promise<ExtractionResult[]> {
    console.log(`开始批量提取 ${filePaths.length} 个文档`);
    
    const results: ExtractionResult[] = [];
    
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      console.log(`提取进度: ${i + 1}/${filePaths.length} - ${filePath}`);
      
      try {
        const result = await this.extractDocument(filePath, options);
        results.push(result);
      } catch (error) {
        console.error(`批量提取失败: ${filePath}`, error);
        results.push({
          text: '',
          metadata: await this.createDefaultMetadata(filePath),
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`批量提取完成: ${successCount}/${filePaths.length} 成功`);
    
    return results;
  }

  /**
   * 验证文件是否可以处理
   */
  async validateFile(filePath: string): Promise<{
    isSupported: boolean;
    fileType: string;
    reason?: string;
  }> {
    return await this.extractor.validateFile(filePath);
  }

  /**
   * 创建默认元数据
   */
  private async createDefaultMetadata(filePath: string): Promise<DocumentMetadata> {
    const fileType = this.getFileType(filePath);
    return {
      title: this.extractTitle(filePath),
      fileSize: 0,
      fileType,
      wordCount: 0,
      extractedAt: new Date()
    };
  }

  /**
   * 从文件路径提取标题
   */
  private extractTitle(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      console.warn('extractTitle: 无效的文件路径', filePath);
      return '未知文档';
    }
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
    return fileName.split('.').slice(0, -1).join('.');
  }

  /**
   * 简单的语言检测
   */
  private detectLanguage(text: string): string {
    if (!text || text.trim().length === 0) return 'unknown';
    
    // 简单的中文检测
    const chineseRegex = /[\u4e00-\u9fff]/;
    if (chineseRegex.test(text)) {
      return 'zh';
    }
    
    // 默认认为是英文
    return 'en';
  }

  /**
   * 获取提取器统计信息
   */
  async getExtractorStats(): Promise<{
    supportedTypes: string[];
    totalTypes: number;
  }> {
    const supportedTypes = await this.getSupportedTypes();
    return {
      supportedTypes,
      totalTypes: supportedTypes.length
    };
  }
}

/**
 * 创建文档提取器的工厂函数
 */
export function createDocumentExtractor(): DocumentExtractionService {
  return new DocumentExtractionService();
} 
import { v4 as uuidv4 } from 'uuid';
import { writeFile, readFile, exists, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { StorageUtil } from './storage';
import { buildSafePhysicalFileName, validatePathLength } from './filesystem/safeFileName';

// 统一文件接口
export interface UnifiedFile {
  id: string;
  name: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  sizeFormatted: string;
  createdAt: string;
  updatedAt: string;
  source: 'upload' | 'chat' | 'sample' | 'import'; // 文件来源
  tags?: string[];
  note?: string;
  isIndexed?: boolean; // 是否已被知识库索引
  knowledgeBaseId?: string; // 关联的知识库ID
  lastReferencedAt?: string; // 最后引用时间
  /**
   * 文档的知识分片数量（可选）。仅当文档已被切分并索引后可用。
   */
  chunkCount?: number;
}

// 文件过滤选项
export interface FileFilterOptions {
  source?: 'upload' | 'chat' | 'sample' | 'import';
  fileType?: string;
  isIndexed?: boolean;
  knowledgeBaseId?: string;
  timeRange?: {
    start: Date;
    end: Date;
  };
}

// 统一文件管理服务
export class UnifiedFileService {
  private static readonly STORAGE_KEY = 'unified-files';
  private static readonly FILES_DIR = 'files'; // 统一使用 files 目录

  /**
   * 获取统一文件存储目录
   */
  static async getFilesDir(): Promise<string> {
    const dataDir = await appDataDir();
    const filesDir = await join(dataDir, this.FILES_DIR);
    
    // 确保目录存在
    try {
      await mkdir(filesDir, { recursive: true });
    } catch (error) {
      // 目录可能已存在，忽略错误
    }
    
    return filesDir;
  }

  /**
   * 保存文件索引
   */
  private static async saveFileIndex(files: UnifiedFile[]): Promise<void> {
    try {
      await StorageUtil.setItem(this.STORAGE_KEY, files, 'unified-files.json');
    } catch (error) {
      console.error('保存文件索引失败:', error);
      throw error;
    }
  }

  /**
   * 加载文件索引
   */
  private static async loadFileIndex(): Promise<UnifiedFile[]> {
    try {
      const files = await StorageUtil.getItem<UnifiedFile[]>(this.STORAGE_KEY, [], 'unified-files.json');
      return files || [];
    } catch (error) {
      console.error('加载文件索引失败:', error);
      return [];
    }
  }

  /**
   * 格式化文件大小
   */
  private static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 生成唯一文件ID
   */
  private static async generateUniqueId(): Promise<string> {
    const existingFiles = await this.loadFileIndex();
    let id = uuidv4();
    let retries = 0;
    const maxRetries = 5;

    while (existingFiles.some(f => f.id === id) && retries < maxRetries) {
      id = uuidv4();
      retries++;
    }

    if (retries >= maxRetries) {
      id = `${uuidv4()}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    return id;
  }

  /**
   * 保存文件（统一入口）
   */
  static async saveFile(
    file: File | Uint8Array,
    fileName: string,
    source: UnifiedFile['source'] = 'upload',
    options: {
      tags?: string[];
      note?: string;
      knowledgeBaseId?: string;
    } = {}
  ): Promise<UnifiedFile> {
    console.log(`[UnifiedFileService] 开始保存文件: ${fileName} (来源: ${source})`);

    try {
      const filesDir = await this.getFilesDir();
      const id = await this.generateUniqueId();
      const fileType = fileName.split('.').pop()?.toLowerCase() || 'unknown';
      const now = new Date().toISOString();

      // 处理文件数据
      let fileData: Uint8Array;
      let fileSize: number;

      if (file instanceof File) {
        const buffer = await file.arrayBuffer();
        fileData = new Uint8Array(buffer);
        fileSize = file.size;
      } else {
        fileData = file;
        fileSize = file.length;
      }

      // 生成安全的物理文件名（短 basename + 保留扩展名）
      const safeFileName = buildSafePhysicalFileName(fileName, id);
      const filePath = await join(filesDir, `${id}_${safeFileName}`);
      const pathCheck = validatePathLength(filePath);
      if (!pathCheck.ok) {
        throw new Error(pathCheck.message || '文件路径过长');
      }

      // 写入文件
      await writeFile(filePath, fileData);
      console.log(`[UnifiedFileService] 文件写入成功: ${filePath}`);

      // 创建文件记录
      const unifiedFile: UnifiedFile = {
        id,
        name: fileName,
        filePath,
        fileType,
        fileSize,
        sizeFormatted: this.formatFileSize(fileSize),
        createdAt: now,
        updatedAt: now,
        source,
        tags: options.tags || [],
        note: options.note,
        isIndexed: false,
        knowledgeBaseId: options.knowledgeBaseId,
        lastReferencedAt: now
      };

      // 更新索引
      const files = await this.loadFileIndex();
      files.push(unifiedFile);
      await this.saveFileIndex(files);

      // 自动同步到数据库
      try {
        const { DocumentSyncService } = await import('./services/documentSync');
        await DocumentSyncService.syncFileToDatabase(unifiedFile);
        console.log(`[UnifiedFileService] 文件已自动同步到数据库: ${fileName}`);
      } catch (syncError) {
        console.warn(`[UnifiedFileService] ⚠️ 文件同步到数据库失败: ${fileName}`, syncError);
        // 不抛出错误，文件保存仍然成功，只是数据库同步失败
      }

      console.log(`[UnifiedFileService] 文件保存成功: ${fileName} (ID: ${id})`);
      return unifiedFile;
    } catch (error) {
      console.error(`[UnifiedFileService] ❌ 文件保存失败: ${fileName}`, error);
      throw error;
    }
  }

  /**
   * 获取所有文件
   */
  static async getAllFiles(filter?: FileFilterOptions): Promise<UnifiedFile[]> {
    try {
      const files = await this.loadFileIndex();
      
      if (!filter) {
        return files;
      }

      return files.filter(file => {
        if (filter.source && file.source !== filter.source) return false;
        if (filter.fileType && file.fileType !== filter.fileType) return false;
        if (filter.isIndexed !== undefined && file.isIndexed !== filter.isIndexed) return false;
        if (filter.knowledgeBaseId && file.knowledgeBaseId !== filter.knowledgeBaseId) return false;
        
        if (filter.timeRange) {
          const fileDate = new Date(file.createdAt);
          if (fileDate < filter.timeRange.start || fileDate > filter.timeRange.end) return false;
        }

        return true;
      });
    } catch (error) {
      console.error('获取文件列表失败:', error);
      return [];
    }
  }

  /**
   * 获取单个文件
   */
  static async getFile(id: string): Promise<UnifiedFile | null> {
    try {
      const files = await this.loadFileIndex();
      return files.find(f => f.id === id) || null;
    } catch (error) {
      console.error(`获取文件失败 (ID: ${id}):`, error);
      return null;
    }
  }

  /**
   * 更新文件信息
   */
  static async updateFile(
    id: string, 
    updates: Partial<Pick<UnifiedFile, 'name' | 'tags' | 'note' | 'isIndexed' | 'knowledgeBaseId' | 'lastReferencedAt'>>
  ): Promise<boolean> {
    try {
      const files = await this.loadFileIndex();
      const fileIndex = files.findIndex(f => f.id === id);
      
      if (fileIndex === -1) {
        console.warn(`文件不存在: ${id}`);
        return false;
      }

      // 更新文件信息
      files[fileIndex] = {
        ...files[fileIndex],
        ...updates,
        updatedAt: new Date().toISOString()
      };

      await this.saveFileIndex(files);
      console.log(`文件信息更新成功: ${id}`);
      return true;
    } catch (error) {
      console.error(`更新文件信息失败 (ID: ${id}):`, error);
      return false;
    }
  }

  /**
   * 删除文件
   */
  static async deleteFile(id: string): Promise<boolean> {
    try {
      const files = await this.loadFileIndex();
      const fileIndex = files.findIndex(f => f.id === id);
      
      if (fileIndex === -1) {
        console.warn(`文件不存在: ${id}`);
        return false;
      }

      const file = files[fileIndex];

      // Keep the durable document/index tables in sync before mutating the
      // file index. If this fails, leave the file available so the user can
      // retry instead of creating an unreachable stale index.
      try {
        const { getDatabaseService } = await import('./db');
        await getDatabaseService().getDocumentRepository().deleteDocument(id);
      } catch (databaseError) {
        console.error(`删除文件对应的文档索引失败 (ID: ${id}):`, databaseError);
        return false;
      }

      // 删除物理文件
      try {
        if (await exists(file.filePath)) {
          await remove(file.filePath);
          console.log(`物理文件删除成功: ${file.filePath}`);
        }
      } catch (fileError) {
        console.warn(`物理文件删除失败: ${file.filePath}`, fileError);
      }

      // 从索引中删除
      files.splice(fileIndex, 1);
      await this.saveFileIndex(files);

      console.log(`文件删除成功: ${file.name} (ID: ${id})`);
      return true;
    } catch (error) {
      console.error(`删除文件失败 (ID: ${id}):`, error);
      return false;
    }
  }

  /**
   * 读取文件内容
   */
  static async readFileContent(id: string): Promise<Uint8Array | null> {
    try {
      const file = await this.getFile(id);
      if (!file) {
        console.warn(`文件不存在: ${id}`);
        return null;
      }

      const content = await readFile(file.filePath);
      
      // 更新最后引用时间
      await this.updateFile(id, { lastReferencedAt: new Date().toISOString() });
      
      return content;
    } catch (error) {
      console.error(`读取文件内容失败 (ID: ${id}):`, error);
      return null;
    }
  }

  /**
   * 读取文本文件内容
   */
  static async readTextContent(id: string): Promise<string | null> {
    try {
      const content = await this.readFileContent(id);
      if (!content) return null;

      return new TextDecoder('utf-8').decode(content);
    } catch (error) {
      console.error(`读取文本内容失败 (ID: ${id}):`, error);
      return null;
    }
  }

  /**
   * 文件分类统计
   */
  static async getFileStatistics(): Promise<{
    total: number;
    bySource: Record<UnifiedFile['source'], number>;
    byType: Record<string, number>;
    indexed: number;
    unindexed: number;
  }> {
    try {
      const files = await this.getAllFiles();
      
      const stats = {
        total: files.length,
        bySource: {
          upload: 0,
          chat: 0,
          sample: 0,
          import: 0
        } as Record<UnifiedFile['source'], number>,
        byType: {} as Record<string, number>,
        indexed: 0,
        unindexed: 0
      };

      files.forEach(file => {
        // 按来源统计
        stats.bySource[file.source]++;
        
        // 按类型统计
        stats.byType[file.fileType] = (stats.byType[file.fileType] || 0) + 1;
        
        // 按索引状态统计
        if (file.isIndexed) {
          stats.indexed++;
        } else {
          stats.unindexed++;
        }
      });

      return stats;
    } catch (error) {
      console.error('获取文件统计失败:', error);
      return {
        total: 0,
        bySource: { upload: 0, chat: 0, sample: 0, import: 0 },
        byType: {},
        indexed: 0,
        unindexed: 0
      };
    }
  }

  // 由于DocumentService和FileService已删除，不再需要迁移功能
  // 这里可以根据需要添加其他工具方法
}

// 导出向后兼容的接口
export const UnifiedFileManager = UnifiedFileService;

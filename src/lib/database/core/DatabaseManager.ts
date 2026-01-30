import Database from "@tauri-apps/plugin-sql";
import { StorageUtil } from "../../storage";
import { DatabaseError, DatabaseErrorType, DatabaseErrorAnalyzer } from "../errors/DatabaseErrors";
import { DatabaseMigrator } from "../../migrations";
import { startupMonitor } from "../../utils/startupPerformanceMonitor";
import { getDefaultDatabaseConfig } from '../../config/database';

/**
 * 数据库配置接口
 */
export interface DatabaseConfig {
  dbPath: string;
  timeout?: number;
  maxRetries?: number;
  enableWAL?: boolean;
  enableForeignKeys?: boolean;
  enableJournalMode?: boolean;
}

/**
 * 数据库事务接口
 */
export interface DatabaseTransaction {
  execute(sql: string, params?: any[]): Promise<any>;
  select(sql: string, params?: any[]): Promise<any[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * 统一数据库管理器
 * 负责数据库连接、配置、事务和迁移管理
 */
export class DatabaseManager {
  private db: Database | null = null;
  // Removed DatabaseLogger dependency
  private migrationManager: DatabaseMigrator | null = null;
  private config: DatabaseConfig;
  private isInitialized = false;
  private connectionLock = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * 初始化数据库连接
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.connectionLock) {
      throw new DatabaseError(
        DatabaseErrorType.CONCURRENT_OPERATION,
        "数据库初始化正在进行中"
      );
    }

    this.connectionLock = true;

    try {
      console.info("开始初始化数据库连接", { dbPath: this.config.dbPath });

      // 创建数据库连接
      startupMonitor.startPhase('数据库连接建立');
      this.db = await Database.load(`sqlite:${this.config.dbPath}`);
      startupMonitor.endPhase('数据库连接建立');

      // 配置数据库
      startupMonitor.startPhase('数据库配置');
      await this.configureDatabase();
      startupMonitor.endPhase('数据库配置');

      // 初始化迁移管理器
      this.migrationManager = new DatabaseMigrator(this.db);

      // 检查迁移状态缓存，避免重复迁移检查
      startupMonitor.startPhase('迁移检查');
      await this.checkAndRunMigrations();
      startupMonitor.endPhase('迁移检查');

      // 异步验证数据库健康状态，不阻塞初始化流程
      setTimeout(() => {
        this.validateDatabaseHealth().catch((error) => {
          console.warn("数据库健康检查失败", { error: error instanceof Error ? error.message : String(error) });
        });
      }, 100); // 延迟100ms执行健康检查

      this.isInitialized = true;
      console.info("数据库初始化完成");

    } catch (error) {
      startupMonitor.endPhase('数据库连接建立');
      startupMonitor.endPhase('数据库配置');
      startupMonitor.endPhase('迁移检查');
      
      const dbError = DatabaseErrorAnalyzer.analyze(error, { 
        operation: 'initialize',
        dbPath: this.config.dbPath 
      });
      console.error("数据库初始化失败", dbError);
      throw dbError;
    } finally {
      this.connectionLock = false;
    }
  }

  /**
   * 检查迁移状态缓存并执行迁移
   */
  private async checkAndRunMigrations(): Promise<void> {
    if (!this.migrationManager) {
      throw new DatabaseError(
        DatabaseErrorType.MISSING_DEPENDENCY,
        "迁移管理器未初始化"
      );
    }

    try {
      // 获取当前数据库版本
      startupMonitor.startPhase('获取数据库版本');
      const currentVersion = await this.migrationManager.getCurrentVersion();
      startupMonitor.endPhase('获取数据库版本');
      
      // 检查缓存中的版本 - 使用简单的内存缓存
      const cacheKey = `db_migration_version_${this.config.dbPath}`;
      const cachedVersion = this.getMigrationCache(cacheKey);
      
      if (cachedVersion && parseInt(cachedVersion) === currentVersion) {
        console.debug("迁移状态缓存命中，跳过迁移检查", { 
          cachedVersion, 
          currentVersion 
        });
        return;
      }

      // 执行迁移
      startupMonitor.startPhase('执行数据库迁移');
      await this.migrationManager.migrate();
      startupMonitor.endPhase('执行数据库迁移');
      
      // 更新缓存
      this.setMigrationCache(cacheKey, currentVersion.toString());
    } catch (error) {
      console.error("迁移检查失败:", error);
      throw error;
    }
  }

  /**
   * 获取迁移缓存
   */
  private getMigrationCache(key: string): string | null {
    try {
      // 使用简单的内存缓存
      if (typeof window !== 'undefined' && (window as any).__migrationCache) {
        return (window as any).__migrationCache[key] || null;
      }
      return null;
    } catch (error) {
      console.warn('获取迁移缓存失败:', error);
      return null;
    }
  }

  /**
   * 设置迁移缓存
   */
  private setMigrationCache(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined') {
        if (!(window as any).__migrationCache) {
          (window as any).__migrationCache = {};
        }
        (window as any).__migrationCache[key] = value;
      }
    } catch (error) {
      console.warn('设置迁移缓存失败:', error);
    }
  }

  /**
   * 获取数据库实例
   */
  getDatabase(): Database {
    if (!this.db || !this.isInitialized) {
      throw new DatabaseError(
        DatabaseErrorType.CONNECTION_FAILED,
        "数据库未初始化，请先调用 initialize() 方法"
      );
    }
    return this.db;
  }

  /**
   * 执行SQL查询
   */
  async execute(sql: string, params?: any[]): Promise<any> {
    const db = this.getDatabase();

    try {
      const result = await db.execute(sql, params);
      return result;
    } catch (error) {
      const dbError = DatabaseErrorAnalyzer.analyze(error, { sql, params });
      console.error("SQL执行失败", dbError);
      throw dbError;
    }
  }

  /**
   * 执行查询并返回结果
   */
  async select<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const db = this.getDatabase();

    try {
      const result = await db.select(sql, params);
      return result;
    } catch (error) {
      const dbError = DatabaseErrorAnalyzer.analyze(error, { sql, params });
      console.error("查询执行失败", dbError);
      throw dbError;
    }
  }

  /**
   * 开始事务
   */
  async beginTransaction(): Promise<DatabaseTransaction> {
    const db = this.getDatabase();
    
    try {
      await db.execute("BEGIN TRANSACTION");

      return {
        execute: async (sql: string, params?: any[]) => {
          return await db.execute(sql, params);
        },
        select: async <T = any>(sql: string, params?: any[]): Promise<T[]> => {
          return await db.select(sql, params);
        },
        commit: async () => {
          await db.execute("COMMIT");
        },
        rollback: async () => {
          await db.execute("ROLLBACK");
        }
      };
    } catch (error) {
      const dbError = DatabaseErrorAnalyzer.analyze(error, { 
        operation: 'beginTransaction' 
      });
      console.error("开始事务失败", dbError);
      throw dbError;
    }
  }

  /**
   * 清理参数中的敏感数据，避免日志过大
   */
  private sanitizeParamsForLog(params?: any[]): any[] {
    if (!params || !Array.isArray(params)) {
      return params || [];
    }
    
    return params.map(param => {
      if (typeof param === 'string') {
        if (param.startsWith('data:image/')) {
          // 处理Data URL格式
          const format = param.match(/data:image\/([^;]+)/)?.[1] || 'unknown';
          return `[base64图片, ${format}格式, ${param.length}字符]`;
        } else if (param.length > 50 && /^[A-Za-z0-9+/=]+$/.test(param)) {
          // 处理纯base64数据（长度大于50且只包含base64字符）
          return `[base64图片, 纯base64格式, ${param.length}字符]`;
        } else if (param.length > 200) {
          // 处理其他长字符串
          return `[长字符串, ${param.length}字符]`;
        }
      }
      return param;
    });
  }

  /**
   * 执行事务
   */
  async executeTransaction<T>(
    operation: (transaction: DatabaseTransaction) => Promise<T>
  ): Promise<T> {
    const maxRetries = this.config.maxRetries || 3;
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const transaction = await this.beginTransaction();
      let transactionCommitted = false;

      try {
        const result = await operation(transaction);
        await transaction.commit();
        transactionCommitted = true;
        
        if (attempt > 1) {
          console.log(`事务执行成功（第${attempt}次尝试）`);
        }
        
        return result;
      } catch (error) {
        // 只有在事务未提交时才尝试回滚
        if (!transactionCommitted) {
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            console.error(
              "事务回滚失败", 
              rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
              { 
                originalError: error instanceof Error ? error.message : String(error)
              }
            );
          }
        }

        lastError = error;
        
        // 检查是否是数据库锁定错误
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isLockError = errorMessage.includes('database is locked') || 
                           errorMessage.includes('database is busy') ||
                           errorMessage.includes('code: 5');
        
        if (isLockError && attempt < maxRetries) {
          const delay = Math.min(1000 * attempt, 5000); // 递增延迟，最大5秒
          console.warn(`数据库锁定，${delay}ms后重试（第${attempt}次尝试）`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // 如果不是锁定错误或已达到最大重试次数，抛出错误
        throw error;
      }
    }

    // 所有重试都失败了
    throw lastError;
  }

  /**
   * 获取数据库状态
   */
  async getStatus(): Promise<{
    isConnected: boolean;
    isInitialized: boolean;
    dbPath: string;
    version: number;
    tableCount: number;
    config: DatabaseConfig;
  }> {
    try {
      const tables = await this.select(`
        SELECT name FROM sqlite_master WHERE type='table'
      `);

      const version = this.migrationManager 
        ? await this.migrationManager.getCurrentVersion()
        : 0;

      return {
        isConnected: this.db !== null,
        isInitialized: this.isInitialized,
        dbPath: this.config.dbPath,
        version,
        tableCount: tables.length,
        config: this.config
      };
    } catch (error) {
      return {
        isConnected: false,
        isInitialized: false,
        dbPath: this.config.dbPath,
        version: 0,
        tableCount: 0,
        config: this.config
      };
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
        console.info("数据库连接已关闭");
      } catch (error) {
        console.warn("关闭数据库连接时发生错误", { error });
      } finally {
        this.db = null;
        this.isInitialized = false;
        this.migrationManager = null;
      }
    }
  }

  /**
   * 获取迁移管理器
   */
  getMigrationManager(): DatabaseMigrator {
    if (!this.migrationManager) {
      throw new DatabaseError(
        DatabaseErrorType.MISSING_DEPENDENCY,
        "迁移管理器未初始化"
      );
    }
    return this.migrationManager;
  }

  /**
   * 配置数据库参数
   */
  private async configureDatabase(): Promise<void> {
    if (!this.db) return;

    const config = this.config;

    try {
      // 批量执行所有PRAGMA语句，减少数据库往返次数
      const pragmaStatements = [];
      
      // 设置超时时间
      if (config.timeout) {
        pragmaStatements.push(`PRAGMA busy_timeout = ${config.timeout}`);
      } else {
        // 默认60秒超时
        pragmaStatements.push('PRAGMA busy_timeout = 60000');
      }

      // 启用外键约束
      if (config.enableForeignKeys !== false) {
        pragmaStatements.push("PRAGMA foreign_keys = ON");
      }

      // 启用WAL模式（更好的并发性能）
      if (config.enableWAL !== false) {
        pragmaStatements.push("PRAGMA journal_mode = WAL");
      }

      // 设置同步模式
      pragmaStatements.push("PRAGMA synchronous = NORMAL");

      // 设置临时存储模式
      pragmaStatements.push("PRAGMA temp_store = MEMORY");

      // 设置缓存大小
      pragmaStatements.push("PRAGMA cache_size = -64000"); // 64MB

      // 批量执行所有PRAGMA语句
      if (pragmaStatements.length > 0) {
        const batchPragma = pragmaStatements.join('; ');
        await this.db.execute(batchPragma);
      }

      console.debug("数据库配置完成", config);
    } catch (error) {
              console.warn("配置数据库参数时发生错误", { error });
    }
  }

  /**
   * 验证数据库健康状态
   */
  private async validateDatabaseHealth(): Promise<void> {
    if (!this.db) return;

    try {
      // 执行完整性检查 - 直接使用 this.db，避免调用 this.select()
      const integrityResult = await this.db.select<{ integrity_check: string }>(
        "PRAGMA integrity_check"
      );
      const integrityStatus = integrityResult[0]?.integrity_check;

      if (integrityStatus !== 'ok') {
        throw new DatabaseError(
          DatabaseErrorType.DATA_CORRUPTION,
          `数据库完整性检查失败: ${integrityStatus}`
        );
      }

      // 检查关键表是否存在 - 直接使用 this.db，避免调用 this.select()
      const requiredTables = ['conversations', 'messages', 'documents'];
      const existingTables = await this.db.select<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table'`
      );
      const existingTableNames = existingTables.map((t) => t.name);

      const missingTables = requiredTables.filter(
        table => !existingTableNames.includes(table)
      );

      if (missingTables.length > 0) {
        console.warn("缺少关键表", { missingTables });
      }

      console.debug("数据库健康检查通过");
    } catch (error) {
      const dbError = DatabaseErrorAnalyzer.analyze(error, { 
        operation: 'healthCheck' 
      });
      console.error("数据库健康检查失败", dbError);
      throw dbError;
    }
  }
}

/**
 * 默认数据库配置
 */
export const defaultDatabaseConfig: DatabaseConfig = getDefaultDatabaseConfig(); 
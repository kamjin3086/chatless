import Database from "@tauri-apps/plugin-sql";

/**
 * 数据库状态修复工具
 * 解决数据库表已存在但版本记录不一致的问题
 */

interface TableInfo {
  name: string;
  exists: boolean;
}

interface DatabaseState {
  hasOldVersionTable: boolean;
  hasNewMigrationTable: boolean;
  existingTables: string[];
  versionFromOldTable: number | null;
  versionFromNewTable: number | null;
  shouldRepair: boolean;
  suggestedAction: string;
}

export class DatabaseStateRepair {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * 检查数据库状态
   */
  async checkDatabaseState(): Promise<DatabaseState> {
    console.log('🔍 检查数据库状态...');

    // 检查所有现有表
    type TableRow = { name: string };
    const allTables = await this.db.select<TableRow>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    
    const existingTables = allTables.map(t => t.name);
    console.log('📋 现有表:', existingTables);

    // 检查版本表
    const hasOldVersionTable = existingTables.includes('schema_version');
    const hasNewMigrationTable = existingTables.includes('schema_migrations');

    let versionFromOldTable: number | null = null;
    let versionFromNewTable: number | null = null;

    // 获取旧版本表的版本
    if (hasOldVersionTable) {
      try {
        const result = await this.db.select<{ version: number }>("SELECT version FROM schema_version ORDER BY created_at DESC LIMIT 1");
        versionFromOldTable = result[0]?.version || null;
        console.log('📊 旧版本表版本:', versionFromOldTable);
      } catch (error) {
        console.warn('⚠️ 读取旧版本表失败:', error);
      }
    }

    // 获取新迁移表的版本
    if (hasNewMigrationTable) {
      try {
        const result = await this.db.select<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1");
        versionFromNewTable = result[0]?.version || null;
        console.log('📊 新迁移表版本:', versionFromNewTable);
      } catch (error) {
        console.warn('⚠️ 读取新迁移表失败:', error);
      }
    }

    // 检查核心业务表是否存在
    const coreTableNames = [
      'conversations', 'messages', 'documents', 
      'knowledge_bases', 'document_chunks', 'document_index_batches', 'doc_knowledge_mappings'
    ];
    
    const existingCoreTables = coreTableNames.filter(name => existingTables.includes(name));
    const hasCoreData = existingCoreTables.length > 0;

    // 判断是否需要修复
    let shouldRepair = false;
    let suggestedAction = '';

    if (hasCoreData && (!hasOldVersionTable && !hasNewMigrationTable)) {
      // 有数据但没有版本记录
      shouldRepair = true;
      suggestedAction = '数据库有表但缺少版本记录，需要重建版本信息';
    } else if (hasCoreData && hasOldVersionTable && versionFromOldTable === 0) {
      // 有数据但版本记录为0
      shouldRepair = true;
      suggestedAction = '数据库有表但版本记录为0，需要更新版本信息';
    } else if (hasCoreData && hasNewMigrationTable && versionFromNewTable === 0) {
      // 有数据但新版本记录为0
      shouldRepair = true;
      suggestedAction = '数据库有表但新迁移记录为0，需要更新迁移信息';
    }

    return {
      hasOldVersionTable,
      hasNewMigrationTable,
      existingTables,
      versionFromOldTable,
      versionFromNewTable,
      shouldRepair,
      suggestedAction
    };
  }

  /**
   * 修复数据库状态
   */
  async repairDatabaseState(): Promise<void> {
    const state = await this.checkDatabaseState();
    
    if (!state.shouldRepair) {
      console.log('数据库状态正常，无需修复');
      return;
    }

    console.log('🔧 开始修复数据库状态...');
    console.log('📝 修复原因:', state.suggestedAction);

    try {
      await this.db.execute('BEGIN TRANSACTION');

      // 检查现有表结构，判断应该设置的版本
      const targetVersion = await this.detectTargetVersion(state.existingTables);
      console.log(`🎯 目标版本: v${targetVersion}`);

      // 如果存在旧版本表，先清理
      if (state.hasOldVersionTable) {
        console.log('🗑️ 清理旧版本表...');
        await this.db.execute('DELETE FROM schema_version');
      }

      // 创建或更新新迁移表
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          executed_at INTEGER NOT NULL,
          execution_time INTEGER NOT NULL,
          checksum TEXT NOT NULL
        )
      `);

      // 清除可能存在的错误记录
      await this.db.execute('DELETE FROM schema_migrations');

      // 插入正确的迁移记录
      const currentTime = Date.now();
      const migrations = this.getMigrationRecords(targetVersion);
      
      for (const migration of migrations) {
        await this.db.execute(`
          INSERT INTO schema_migrations (version, name, executed_at, execution_time, checksum)
          VALUES (?, ?, ?, ?, ?)
        `, [migration.version, migration.name, currentTime, 0, migration.checksum]);
      }

      await this.db.execute('COMMIT');
      console.log(`数据库状态修复完成，当前版本: v${targetVersion}`);

    } catch (error) {
      await this.db.execute('ROLLBACK');
      console.error('❌ 数据库状态修复失败:', error);
      throw error;
    }
  }

  /**
   * 根据现有表结构检测目标版本
   */
  private async detectTargetVersion(existingTables: string[]): Promise<number> {
    const coreTablesV1 = ['conversations', 'messages'];
    const coreTablesV2 = ['documents', 'knowledge_bases', 'document_chunks', 'document_index_batches', 'doc_knowledge_mappings'];

    const hasV1Tables = coreTablesV1.every(table => existingTables.includes(table));
    const hasV2Tables = coreTablesV2.every(table => existingTables.includes(table));

    if (hasV1Tables && hasV2Tables) {
      return 2; // 完整的v2版本
    } else if (hasV1Tables) {
      return 1; // 只有v1版本
    } else {
      return 0; // 空数据库
    }
  }

  /**
   * 获取迁移记录
   */
  private getMigrationRecords(targetVersion: number): Array<{
    version: number;
    name: string;
    checksum: string;
  }> {
    const records = [];

    if (targetVersion >= 1) {
      records.push({
        version: 1,
        name: 'initial_schema',
        checksum: 'repair_generated_v1'
      });
    }

    if (targetVersion >= 2) {
      records.push({
        version: 2,
        name: 'knowledge_base_schema',
        checksum: 'repair_generated_v2'
      });
    }

    return records;
  }

  /**
   * 强制重置到指定版本（谨慎使用）
   */
  async forceSetVersion(version: number): Promise<void> {
    console.log(`🔧 强制设置数据库版本为 v${version}...`);

    try {
      await this.db.execute('BEGIN TRANSACTION');

      // 清理现有版本记录
      await this.db.execute('DELETE FROM schema_version WHERE 1=1');
      await this.db.execute('DELETE FROM schema_migrations WHERE 1=1');

      // 创建新迁移表
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          executed_at INTEGER NOT NULL,
          execution_time INTEGER NOT NULL,
          checksum TEXT NOT NULL
        )
      `);

      // 插入版本记录
      const currentTime = Date.now();
      const migrations = this.getMigrationRecords(version);
      
      for (const migration of migrations) {
        await this.db.execute(`
          INSERT INTO schema_migrations (version, name, executed_at, execution_time, checksum)
          VALUES (?, ?, ?, ?, ?)
        `, [migration.version, migration.name, currentTime, 0, migration.checksum]);
      }

      await this.db.execute('COMMIT');
      console.log(`版本强制设置完成: v${version}`);

    } catch (error) {
      await this.db.execute('ROLLBACK');
      console.error('❌ 强制设置版本失败:', error);
      throw error;
    }
  }
}

/**
 * 快速修复函数
 */
export async function quickRepairDatabase(db: Database): Promise<void> {
  const repair = new DatabaseStateRepair(db);
  await repair.repairDatabaseState();
}

/**
 * 检查数据库是否需要修复
 */
export async function checkDatabaseNeedsRepair(db: Database): Promise<boolean> {
  const repair = new DatabaseStateRepair(db);
  const state = await repair.checkDatabaseState();
  return state.shouldRepair;
}

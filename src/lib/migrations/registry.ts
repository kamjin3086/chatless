import { Migration } from './types';
import { migration_001 } from './scripts/001_initial_schema';
import { migration_002 } from './scripts/002_add_model_provider';
import { migration_003 } from './scripts/003_add_prompts_table';
import { migration_004 } from './scripts/004_add_prompt_shortcuts';
import { migration_005 } from './scripts/005_add_message_segments';
import { migration_006 } from './scripts/006_add_core_indexes';
import { migration_007 } from './scripts/007_add_message_versioning';
import { migration_008 } from './scripts/008_add_conversation_tool_mode';
// 合并到 v2 后，这里不再注册 v3/v4
/**
 * 迁移注册器
 * 管理所有迁移脚本的注册和发现
 */
export class MigrationRegistry {
  private migrations: Map<number, Migration> = new Map();

  constructor() {
    this.registerMigrations();
  }

  /**
   * 注册所有迁移脚本
   */
  private registerMigrations(): void {
    // 在这里注册所有迁移脚本
    this.register(migration_001);
    
    // 添加新迁移时，只需要在这里添加一行即可
    this.register(migration_002);
    this.register(migration_003);
    this.register(migration_004);
    this.register(migration_005);
    this.register(migration_006);
    this.register(migration_007);
    this.register(migration_008);
    // v3+v4 已合并到 v2，无需注册
  }

  /**
   * 注册单个迁移
   */
  private register(migration: Migration): void {
    if (this.migrations.has(migration.version)) {
      throw new Error(`迁移版本 ${migration.version} 已存在`);
    }
    this.migrations.set(migration.version, migration);
  }

  /**
   * 获取所有迁移，按版本号排序
   */
  getAllMigrations(): Migration[] {
    return Array.from(this.migrations.values())
      .sort((a, b) => a.version - b.version);
  }

  /**
   * 获取指定版本的迁移
   */
  getMigration(version: number): Migration | undefined {
    return this.migrations.get(version);
  }

  /**
   * 获取指定版本范围内的迁移
   */
  getMigrationsInRange(fromVersion: number, toVersion: number): Migration[] {
    return this.getAllMigrations()
      .filter(m => m.version > fromVersion && m.version <= toVersion);
  }

  /**
   * 获取最新版本号
   */
  getLatestVersion(): number {
    const migrations = this.getAllMigrations();
    return migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
  }

  /**
   * 验证迁移脚本完整性
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const migrations = this.getAllMigrations();
    
    // 检查版本号连续性
    for (let i = 0; i < migrations.length; i++) {
      const expectedVersion = i + 1;
      if (migrations[i].version !== expectedVersion) {
        errors.push(`迁移版本不连续: 期望 ${expectedVersion}, 实际 ${migrations[i].version}`);
      }
    }

    // 检查迁移名称唯一性
    const names = new Set();
    for (const migration of migrations) {
      if (names.has(migration.name)) {
        errors.push(`迁移名称重复: ${migration.name}`);
      }
      names.add(migration.name);
    }

    // 检查回滚操作
    for (const migration of migrations) {
      if (!migration.down || migration.down.length === 0) {
        // console.warn(`⚠️ 迁移 v${migration.version} 没有定义回滚操作`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 显示迁移列表
   */
  listMigrations(): void {
    const migrations = this.getAllMigrations();
    // console.log('📋 已注册的迁移脚本:');
    
    for (const migration of migrations) {
      // console.log(`  v${migration.version}: ${migration.name} - ${migration.description}`);
    }
    
    // console.log(`\n📊 总计: ${migrations.length} 个迁移脚本`);
    // console.log(`🔄 最新版本: v${this.getLatestVersion()}`);
  }
}

// 导出全局注册器实例
export const migrationRegistry = new MigrationRegistry(); 
/**
 * 本地技能加载器
 * 
 * 从本地 skills 目录加载技能
 * 使用 Tauri 的文件系统 API
 */

import type { Skill, ISkillLoader, SkillDependency } from './types';
import { parseSkillMd, extractDependencies, extractTitleFromContent, extractDescriptionFromContent } from './SkillMdParser';

/**
 * 默认本地技能目录名
 */
const DEFAULT_SKILLS_DIR = 'skills';

/**
 * SKILL.md 文件名
 */
const SKILL_MD_FILENAME = 'SKILL.md';

/**
 * 本地技能加载器配置
 */
export interface LocalSkillLoaderConfig {
  /** 技能目录路径（相对于应用数据目录） */
  skillsPath?: string;
}

/**
 * 本地技能加载器
 */
export class LocalSkillLoader implements ISkillLoader {
  private config: LocalSkillLoaderConfig;
  private cache: Map<string, Skill> = new Map();

  constructor(config: LocalSkillLoaderConfig = {}) {
    this.config = {
      skillsPath: config.skillsPath || DEFAULT_SKILLS_DIR,
    };
  }

  /**
   * 获取技能目录的完整路径
   */
  private async getSkillsBasePath(): Promise<string> {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const appData = await appDataDir();
      return await join(appData, this.config.skillsPath || DEFAULT_SKILLS_DIR);
    } catch {
      // 开发环境或非 Tauri 环境，返回相对路径
      return this.config.skillsPath || DEFAULT_SKILLS_DIR;
    }
  }

  /**
   * 检查目录是否存在
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      const { exists } = await import('@tauri-apps/plugin-fs');
      return await exists(path);
    } catch {
      return false;
    }
  }

  /**
   * 读取目录内容
   */
  private async readDirectory(path: string): Promise<string[]> {
    try {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(path);
      return entries
        .filter((e: any) => e.isDirectory)
        .map((e: any) => e.name);
    } catch (error) {
      console.warn('[LocalSkillLoader] Failed to read directory:', error);
      return [];
    }
  }

  /**
   * 读取文件内容
   */
  private async readFile(path: string): Promise<string | null> {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      return await readTextFile(path);
    } catch {
      return null;
    }
  }

  /**
   * 加载所有本地技能
   */
  async loadAll(): Promise<Skill[]> {
    const basePath = await this.getSkillsBasePath();
    
    // 检查目录是否存在
    const dirExists = await this.directoryExists(basePath);
    if (!dirExists) {
      console.info('[LocalSkillLoader] Skills directory does not exist:', basePath);
      return [];
    }

    // 读取所有子目录
    const skillDirs = await this.readDirectory(basePath);
    if (skillDirs.length === 0) {
      return [];
    }

    // 并行加载所有技能
    const skills = await Promise.all(
      skillDirs.map(dir => this.loadSkillFromDir(basePath, dir))
    );

    // 过滤掉加载失败的
    const validSkills = skills.filter((s): s is Skill => s !== null);
    
    // 更新缓存
    this.cache.clear();
    for (const skill of validSkills) {
      this.cache.set(skill.id, skill);
    }

    return validSkills;
  }

  /**
   * 加载单个技能
   */
  async load(id: string): Promise<Skill | null> {
    // 先检查缓存
    if (this.cache.has(id)) {
      return this.cache.get(id) || null;
    }

    const basePath = await this.getSkillsBasePath();
    const skill = await this.loadSkillFromDir(basePath, id);
    
    if (skill) {
      this.cache.set(id, skill);
    }
    
    return skill;
  }

  /**
   * 刷新技能列表
   */
  async refresh(): Promise<Skill[]> {
    this.cache.clear();
    return this.loadAll();
  }

  /**
   * 从目录加载技能
   */
  private async loadSkillFromDir(basePath: string, dirName: string): Promise<Skill | null> {
    try {
      const { join } = await import('@tauri-apps/api/path');
      const skillPath = await join(basePath, dirName);
      const skillMdPath = await join(skillPath, SKILL_MD_FILENAME);

      // 读取 SKILL.md
      const content = await this.readFile(skillMdPath);
      if (!content) {
        console.warn(`[LocalSkillLoader] No SKILL.md found in ${dirName}`);
        return null;
      }

      // 解析 SKILL.md
      const parseResult = parseSkillMd(content);
      if (!parseResult.success && !parseResult.frontmatter) {
        console.warn(`[LocalSkillLoader] Failed to parse ${dirName}:`, parseResult.error);
      }

      const frontmatter = parseResult.frontmatter;
      const dependencies = extractDependencies(frontmatter);

      // 构建技能对象
      const skill: Skill = {
        id: dirName,
        name: frontmatter?.name || extractTitleFromContent(parseResult.content) || dirName,
        description: frontmatter?.description || extractDescriptionFromContent(parseResult.content),
        version: frontmatter?.version || '1.0.0',
        source: 'local',
        status: this.determineStatus(dependencies),
        path: skillPath,
        skillMdContent: content,
        dependencies,
        enabled: true, // 本地技能默认启用
        installedAt: Date.now(),
        author: frontmatter?.author,
        tags: frontmatter?.tags,
        category: frontmatter?.category,
      };

      return skill;
    } catch (error) {
      console.error(`[LocalSkillLoader] Error loading skill ${dirName}:`, error);
      return null;
    }
  }

  /**
   * 根据依赖项确定技能状态
   */
  private determineStatus(dependencies: SkillDependency[]): Skill['status'] {
    if (dependencies.length === 0) {
      return 'installed';
    }

    // 如果有未安装的依赖，标记为 missing_deps
    const hasMissingDeps = dependencies.some(d => !d.installed);
    return hasMissingDeps ? 'missing_deps' : 'installed';
  }

  /**
   * 获取缓存的技能
   */
  getCached(id: string): Skill | undefined {
    return this.cache.get(id);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * 创建默认的本地技能加载器实例
 */
export function createLocalSkillLoader(config?: LocalSkillLoaderConfig): LocalSkillLoader {
  return new LocalSkillLoader(config);
}


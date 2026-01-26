/**
 * 远程技能加载器
 * 
 * 从 GitHub 仓库加载 Anthropic Skills
 * @see https://github.com/anthropics/skills
 */

import type { Skill, ISkillLoader, RemoteSkillInfo } from './types';
import { parseSkillMd, extractDependencies, extractTitleFromContent, extractDescriptionFromContent } from './SkillMdParser';
import { inferOriginKind, sha256Hex } from './integrity';

/**
 * Anthropic Skills 仓库信息
 */
const ANTHROPIC_SKILLS_REPO = {
  owner: 'anthropics',
  repo: 'skills',
  branch: 'main',
  apiUrl: 'https://api.github.com/repos/anthropics/skills/contents',
  rawUrl: 'https://raw.githubusercontent.com/anthropics/skills/main',
};

/**
 * 缓存过期时间（毫秒）
 */
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

/**
 * 远程技能加载器配置
 */
export interface RemoteSkillLoaderConfig {
  /** 自定义仓库 URL（可选） */
  repoUrl?: string;
  /** API URL */
  apiUrl?: string;
  /** Raw 内容 URL */
  rawUrl?: string;
  /** 是否使用缓存 */
  useCache?: boolean;
  /** 缓存过期时间 */
  cacheTtl?: number;
}

/**
 * GitHub API 目录项响应
 */
interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  url: string;
  html_url: string;
  download_url: string | null;
}

/**
 * 缓存项
 */
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

/**
 * 远程技能加载器
 */
export class RemoteSkillLoader implements ISkillLoader {
  private config: Required<RemoteSkillLoaderConfig>;
  private skillListCache: CacheItem<RemoteSkillInfo[]> | null = null;
  private skillCache: Map<string, CacheItem<Skill>> = new Map();

  constructor(config: RemoteSkillLoaderConfig = {}) {
    this.config = {
      repoUrl: config.repoUrl || `https://github.com/${ANTHROPIC_SKILLS_REPO.owner}/${ANTHROPIC_SKILLS_REPO.repo}`,
      apiUrl: config.apiUrl || ANTHROPIC_SKILLS_REPO.apiUrl,
      rawUrl: config.rawUrl || ANTHROPIC_SKILLS_REPO.rawUrl,
      useCache: config.useCache ?? true,
      cacheTtl: config.cacheTtl ?? CACHE_TTL,
    };
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid<T>(cache: CacheItem<T> | null): cache is CacheItem<T> {
    if (!cache || !this.config.useCache) {
      return false;
    }
    return Date.now() - cache.timestamp < this.config.cacheTtl;
  }

  /**
   * 获取远程技能目录列表
   */
  private async fetchSkillList(): Promise<RemoteSkillInfo[]> {
    // 检查缓存
    if (this.isCacheValid(this.skillListCache)) {
      return this.skillListCache.data;
    }

    try {
      const response = await fetch(this.config.apiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Chatless-Desktop',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const items: GitHubContentItem[] = await response.json();
      
      // 过滤出目录（每个目录代表一个技能）
      const skillDirs = items.filter(item => 
        item.type === 'dir' && 
        !item.name.startsWith('.') && // 排除隐藏目录
        !['docs', 'examples', 'tests'].includes(item.name) // 排除非技能目录
      );

      const skillInfos: RemoteSkillInfo[] = skillDirs.map(dir => ({
        id: dir.name,
        path: dir.path,
        sha: dir.sha,
        skillMdUrl: `${this.config.rawUrl}/${dir.path}/SKILL.md`,
        skillMdDownloadUrl: dir.download_url || undefined,
        repoUrl: `${this.config.repoUrl}/tree/${ANTHROPIC_SKILLS_REPO.branch}/${dir.path}`,
      }));

      // 更新缓存
      this.skillListCache = {
        data: skillInfos,
        timestamp: Date.now(),
      };

      return skillInfos;
    } catch (error) {
      console.error('[RemoteSkillLoader] Failed to fetch skill list:', error);
      // 如果有过期缓存，返回过期数据
      if (this.skillListCache) {
        console.warn('[RemoteSkillLoader] Using stale cache');
        return this.skillListCache.data;
      }
      return [];
    }
  }

  /**
   * 获取技能的 SKILL.md 内容
   */
  private async fetchSkillMd(skillInfo: RemoteSkillInfo): Promise<string | null> {
    try {
      const response = await fetch(skillInfo.skillMdUrl, {
        headers: {
          'User-Agent': 'Chatless-Desktop',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`[RemoteSkillLoader] No SKILL.md found for ${skillInfo.id}`);
          return null;
        }
        throw new Error(`HTTP error: ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      console.error(`[RemoteSkillLoader] Failed to fetch SKILL.md for ${skillInfo.id}:`, error);
      return null;
    }
  }

  /**
   * 加载所有远程技能
   */
  async loadAll(): Promise<Skill[]> {
    const skillInfos = await this.fetchSkillList();
    
    if (skillInfos.length === 0) {
      return [];
    }

    // 并行加载所有技能（限制并发数）
    const batchSize = 5;
    const skills: Skill[] = [];

    for (let i = 0; i < skillInfos.length; i += batchSize) {
      const batch = skillInfos.slice(i, i + batchSize);
      const batchSkills = await Promise.all(
        batch.map(info => this.loadSkillFromInfo(info))
      );
      skills.push(...batchSkills.filter((s): s is Skill => s !== null));
    }

    return skills;
  }

  /**
   * 加载单个技能
   */
  async load(id: string): Promise<Skill | null> {
    // 检查缓存
    const cached = this.skillCache.get(id) ?? null;
    if (this.isCacheValid(cached)) {
      return cached.data;
    }

    // 获取技能信息
    const skillInfos = await this.fetchSkillList();
    const skillInfo = skillInfos.find(s => s.id === id);
    
    if (!skillInfo) {
      return null;
    }

    return this.loadSkillFromInfo(skillInfo);
  }

  /**
   * 刷新技能列表
   */
  async refresh(): Promise<Skill[]> {
    // 清除缓存
    this.skillListCache = null;
    this.skillCache.clear();
    
    return this.loadAll();
  }

  /**
   * 从技能信息加载完整技能数据
   */
  private async loadSkillFromInfo(info: RemoteSkillInfo): Promise<Skill | null> {
    // 检查缓存
    const cached = this.skillCache.get(info.id) ?? null;
    if (this.isCacheValid(cached)) {
      return cached.data;
    }

    // 获取 SKILL.md
    const content = await this.fetchSkillMd(info);
    if (!content) {
      return null;
    }

    // 解析
    const parseResult = parseSkillMd(content);
    const frontmatter = parseResult.frontmatter;
    const dependencies = extractDependencies(frontmatter);
    const actionTypes = parseResult.actions.map((a) => a.type);
    const skillMdSha256 = await sha256Hex(content);

    // 构建技能对象
    const skill: Skill = {
      id: info.id,
      name: frontmatter?.name || extractTitleFromContent(parseResult.content) || info.id,
      description: frontmatter?.description || extractDescriptionFromContent(parseResult.content),
      version: frontmatter?.version || '1.0.0',
      source: 'remote',
      status: 'not_installed', // 远程技能默认未安装
      repoUrl: info.repoUrl,
      origin: {
        kind: inferOriginKind(info.repoUrl, 'remote'),
        repoUrl: info.repoUrl,
      },
      integrity: {
        remoteSha: info.sha,
        skillMdSha256: skillMdSha256 || undefined,
      },
      skillMdContent: content,
      actionCount: parseResult.actions.length,
      actionTypes,
      dependencies,
      enabled: false, // 远程技能默认未启用
      author: frontmatter?.author,
      tags: frontmatter?.tags,
      category: frontmatter?.category,
    };

    // 更新缓存
    this.skillCache.set(info.id, {
      data: skill,
      timestamp: Date.now(),
    });

    return skill;
  }

  /**
   * 获取缓存的技能
   */
  getCached(id: string): Skill | undefined {
    const cached = this.skillCache.get(id);
    return cached?.data;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.skillListCache = null;
    this.skillCache.clear();
  }

  /**
   * 检查技能是否有更新
   */
  async checkForUpdates(localSkill: Skill): Promise<boolean> {
    if (localSkill.source !== 'local' || !localSkill.version) {
      return false;
    }

    const remoteSkill = await this.load(localSkill.id);
    if (!remoteSkill || !remoteSkill.version) {
      return false;
    }

    // 简单版本比较（假设使用 semver）
    return this.compareVersions(localSkill.version, remoteSkill.version) < 0;
  }

  /**
   * 简单版本比较
   * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    const maxLen = Math.max(parts1.length, parts2.length);
    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    
    return 0;
  }
}

/**
 * 创建默认的远程技能加载器实例
 */
export function createRemoteSkillLoader(config?: RemoteSkillLoaderConfig): RemoteSkillLoader {
  return new RemoteSkillLoader(config);
}


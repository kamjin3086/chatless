/**
 * 技能管理器
 * 
 * 统一管理本地和远程技能的加载、安装、更新等操作
 */

import type { Skill, SkillManagerConfig, SkillInstallOptions, SkillIndexEntry } from './types';
import { LocalSkillLoader, createLocalSkillLoader } from './LocalSkillLoader';
import { RemoteSkillLoader, createRemoteSkillLoader } from './RemoteSkillLoader';
import { useSkillStore } from '@/store/skillStore';
import { inferOriginKind } from './integrity';
import { ensureAllowlistedDirectory } from '@/lib/filesystemAllowlist';

/**
 * 技能管理器
 */
export class SkillManager {
  private config: SkillManagerConfig;
  private localLoader: LocalSkillLoader;
  private remoteLoader: RemoteSkillLoader | null;
  private initialized = false;
  // 防重复：同一 skill 同一时间只允许一个更新/导入任务
  private _opLocks = new Map<string, Promise<unknown>>();

  constructor(config: SkillManagerConfig = {}) {
    this.config = {
      localSkillsPath: config.localSkillsPath || 'skills',
      enableRemoteCatalog: config.enableRemoteCatalog ?? false,
      remoteRepoUrl: config.remoteRepoUrl || 'https://github.com/anthropics/skills',
      cachePath: config.cachePath || 'skills-cache',
      autoCheckUpdates: config.autoCheckUpdates ?? true,
    };

    this.localLoader = createLocalSkillLoader({
      skillsPath: this.config.localSkillsPath,
    });

    this.remoteLoader = this.config.enableRemoteCatalog
      ? createRemoteSkillLoader({ repoUrl: this.config.remoteRepoUrl })
      : null;
  }

  /**
   * 初始化技能管理器
   * 加载所有技能并更新 store
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const store = useSkillStore.getState();
    store.setLoading(true);

    try {
      await this.loadAllSkills();
      this.initialized = true;

      // 自动检查更新
      if (this.config.autoCheckUpdates && this.remoteLoader) {
        void this.checkForUpdates();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize skills';
      store.setError(errorMessage);
      console.error('[SkillManager] Initialization failed:', error);
    } finally {
      store.setLoading(false);
    }
  }

  /**
   * 加载所有技能（本地；可选远程 catalog）
   */
  async loadAllSkills(): Promise<Skill[]> {
    const store = useSkillStore.getState();
    
    try {
      const localSkills = await this.localLoader.loadAll();
      const remoteSkills = this.remoteLoader ? await this.remoteLoader.loadAll() : [];

      // 合并技能列表，本地技能优先
      const mergedSkills = this.mergeSkills(localSkills, remoteSkills);

      // 恢复启用状态（从持久化的 store 中）
      const persistedSkills = store.skills;
      const finalSkills = mergedSkills.map(skill => {
        const persisted = persistedSkills.find(p => p.id === skill.id);
        if (persisted) {
          return {
            ...skill,
            enabled: (persisted as any).enabled ?? skill.enabled,
            installedAt: (persisted as any).installedAt ?? skill.installedAt,
          };
        }
        return skill;
      });

      // 更新 store
      store.setSkills(finalSkills);

      return finalSkills;
    } catch (error) {
      console.error('[SkillManager] Failed to load skills:', error);
      throw error;
    }
  }

  /**
   * 合并本地和远程技能
   * 本地技能优先，远程技能作为补充
   */
  private mergeSkills(localSkills: Skill[], remoteSkills: Skill[]): Skill[] {
    const skillMap = new Map<string, Skill>();

    // 先添加远程技能
    for (const skill of remoteSkills) {
      skillMap.set(skill.id, skill);
    }

    // 本地技能覆盖远程
    for (const skill of localSkills) {
      const existing = skillMap.get(skill.id);
      if (existing) {
        // 本地版本，标记为已安装
        skillMap.set(skill.id, {
          ...skill,
          status: 'installed',
          // 保留远程信息
          repoUrl: existing.repoUrl,
          origin: {
            kind: inferOriginKind(existing.repoUrl, 'remote'),
            repoUrl: existing.repoUrl,
          },
          integrity: {
            remoteSha: existing.integrity?.remoteSha,
            skillMdSha256: skill.integrity?.skillMdSha256,
          },
        });
      } else {
        skillMap.set(skill.id, skill);
      }
    }

    return Array.from(skillMap.values());
  }

  /**
   * 刷新技能列表
   */
  async refresh(): Promise<Skill[]> {
    const store = useSkillStore.getState();
    store.setLoading(true);

    try {
      // 清除加载器缓存
      this.localLoader.clearCache();
      this.remoteLoader?.clearCache();

      // 重新加载
      const skills = await this.loadAllSkills();
      return skills;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh skills';
      store.setError(errorMessage);
      throw error;
    } finally {
      store.setLoading(false);
    }
  }

  /**
   * 获取单个技能
   */
  async getSkill(id: string): Promise<Skill | null> {
    // 先从 store 获取
    const store = useSkillStore.getState();
    const cached = store.skills.find(s => s.id === id);
    if (cached) {
      return cached;
    }

    // 尝试从加载器获取
    const localSkill = await this.localLoader.load(id);
    if (localSkill) {
      return localSkill;
    }

    if (!this.remoteLoader) return null;
    return this.remoteLoader.load(id);
  }

  /**
   * 检查技能更新
   */
  async checkForUpdates(): Promise<Map<string, boolean>> {
    if (!this.remoteLoader) {
      return new Map();
    }
    const store = useSkillStore.getState();
    const localSkills = store.skills.filter(s => s.source === 'local');
    const updates = new Map<string, boolean>();

    for (const skill of localSkills) {
      try {
        const hasUpdate = await this.remoteLoader.checkForUpdates(skill);
        updates.set(skill.id, hasUpdate);

        if (hasUpdate) {
          // 更新状态为需要更新
          store.updateSkill(skill.id, { status: 'needs_update' });
        }
      } catch (error) {
        console.warn(`[SkillManager] Failed to check update for ${skill.id}:`, error);
      }
    }

    return updates;
  }

  /**
   * 安装远程技能到本地
   */
  async installSkill(id: string, options: SkillInstallOptions = {}): Promise<boolean> {
    // 当前产品形态：技能始终以“本地文件夹”存在。ZIP/Git 导入已覆盖主要安装路径。
    // 远程 catalog 安装是可选能力；默认关闭，避免引入网络不确定性与“未安装技能列表”的复杂性。
    if (!this.remoteLoader) {
      console.warn('[SkillManager] Remote catalog disabled; installSkill is not available. Use importFromZip/cloneFromGit.');
      return false;
    }
    const store = useSkillStore.getState();
    const skill = store.skills.find(s => s.id === id);

    if (!skill) {
      console.error(`[SkillManager] Skill not found: ${id}`);
      return false;
    }

    if (skill.source === 'local' && !options.overwrite) {
      console.warn(`[SkillManager] Skill already installed: ${id}`);
      return true;
    }

    try {
      // 获取远程技能的完整内容
      const remoteSkill = await this.remoteLoader.load(id);
      if (!remoteSkill || !remoteSkill.skillMdContent) {
        console.error(`[SkillManager] Failed to fetch remote skill: ${id}`);
        return false;
      }

      // 写入本地目录
      const success = await this.writeSkillToLocal(id, remoteSkill, options);
      
      if (success) {
        // 刷新本地技能
        await this.localLoader.refresh();
        
        // 更新 store
        store.updateSkill(id, {
          source: 'local',
          status: 'installed',
          installedAt: Date.now(),
          enabled: true,
        });
      }

      return success;
    } catch (error) {
      console.error(`[SkillManager] Failed to install skill ${id}:`, error);
      return false;
    }
  }

  /**
   * 将技能写入本地目录
   */
  private async writeSkillToLocal(
    id: string,
    skill: Skill,
    options: SkillInstallOptions
  ): Promise<boolean> {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');

      const appData = await appDataDir();
      const skillPath = options.targetPath || 
        await join(appData, this.config.localSkillsPath || 'skills', id);

      // 创建目录
      await mkdir(skillPath, { recursive: true });

      // 写入 SKILL.md
      const skillMdPath = await join(skillPath, 'SKILL.md');
      await writeTextFile(skillMdPath, skill.skillMdContent || '');

      return true;
    } catch (error) {
      console.error(`[SkillManager] Failed to write skill to local:`, error);
      return false;
    }
  }

  /**
   * 卸载技能（直接删除文件夹）
   */
  async uninstallSkill(id: string): Promise<boolean> {
    const store = useSkillStore.getState();
    const skill = store.skills.find(s => s.id === id);

    if (!skill || skill.source !== 'local') {
      console.warn(`[SkillManager] Cannot uninstall non-local skill: ${id}`);
      return false;
    }

    try {
      if (skill.path) {
        const { remove } = await import('@tauri-apps/plugin-fs');
        await remove(skill.path, { recursive: true });
      }

      // 刷新列表
      await this.refresh();
      
      return true;
    } catch (error) {
      console.error(`[SkillManager] Failed to uninstall skill ${id}:`, error);
      return false;
    }
  }

  /**
   * 从 ZIP 文件导入技能
   * 使用 JSZip 在前端解压
   */
  async importFromZip(
    zipPath: string,
    options?: { overwrite?: boolean; targetSkillId?: string }
  ): Promise<string | null> {
    try {
      const { readFile, writeFile, mkdir, exists, remove, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const JSZip = (await import('jszip')).default;
      
      // 读取 ZIP 文件
      const zipData = await readFile(zipPath);
      const zip = await JSZip.loadAsync(zipData);
      
      // 查找 SKILL.md 文件以确定技能根目录
      let skillRoot = '';
      let skillMdFound = false;
      
      for (const filename of Object.keys(zip.files)) {
        if (filename.endsWith('SKILL.md') || filename.endsWith('skill.md')) {
          skillMdFound = true;
          // 获取 SKILL.md 所在的目录
          const parts = filename.split('/');
          if (parts.length > 1) {
            skillRoot = parts.slice(0, -1).join('/');
          }
          break;
        }
      }
      
      if (!skillMdFound) {
        throw new Error('ZIP 文件中未找到 SKILL.md，不是有效的技能包');
      }
      
      // 确定目标目录名（允许覆盖指定 skillId）
      const zipFileName = zipPath.split(/[/\\]/).pop() || 'imported-skill';
      const skillDirName = skillRoot 
        ? skillRoot.split('/')[0] 
        : zipFileName.replace(/\.zip$/i, '');
      const finalDirName = String(options?.targetSkillId || '').trim() || skillDirName;
      
      // 获取技能基础路径
      const basePath = await this.getSkillsBasePath();
      const { join } = await import('@tauri-apps/api/path');
      const targetDir = await join(basePath, finalDirName);
      
      // 检查目标目录是否已存在
      if (await exists(targetDir)) {
        if (!options?.overwrite) {
          throw new Error(`技能 '${finalDirName}' 已存在，请先卸载或选择“覆盖安装”`);
        }
        // 覆盖安装：先删除原目录
        await remove(targetDir, { recursive: true });
        await mkdir(targetDir, { recursive: true });
      }
      
      // 创建目标目录
      await mkdir(targetDir, { recursive: true });
      
      // 解压文件
      for (const [filename, file] of Object.entries(zip.files)) {
        if (file.dir) continue;
        
        // 计算相对路径
        let relativePath = filename;
        if (skillRoot && filename.startsWith(skillRoot + '/')) {
          relativePath = filename.slice(skillRoot.length + 1);
        } else if (skillRoot && filename.startsWith(skillRoot)) {
          relativePath = filename.slice(skillRoot.length);
        }
        
        if (!relativePath) continue;
        
        const filePath = await join(targetDir, relativePath);
        
        // 确保父目录存在
        const parentDir = filePath.split(/[/\\]/).slice(0, -1).join('/');
        if (parentDir && !(await exists(parentDir))) {
          await mkdir(parentDir, { recursive: true });
        }
        
        // 写入文件
        const content = await file.async('uint8array');
        await writeFile(filePath, content);
      }

      // 写入安装元信息（用于更新/展示）
      try {
        const metaPath = await join(targetDir, '.chatless-skill.json');
        await writeTextFile(metaPath, JSON.stringify({ installMethod: 'zip', updatedAt: Date.now() }, null, 2));
      } catch {
        // ignore
      }
      
      // 刷新列表
      await this.refresh();
      
      return targetDir;
    } catch (error) {
      console.error(`[SkillManager] Failed to import from ZIP:`, error);
      throw error;
    }
  }

  /**
   * 从 Git 仓库克隆技能
   * 
   * 注意：此功能需要 @tauri-apps/plugin-shell 插件
   * 如果插件未安装，会抛出错误提示用户手动克隆
   */
  async cloneFromGit(gitUrl: string): Promise<string | null> {
    try {
      // 动态导入 shell 插件，如果未安装会抛出错误
      let Command;
      try {
        const shellModule = await import('@tauri-apps/plugin-shell');
        Command = shellModule.Command;
      } catch {
        throw new Error(
          'Git 克隆功能需要 shell 插件。\n' +
          '请手动克隆仓库到技能文件夹，或使用 ZIP 导入方式。'
        );
      }
      
      const { exists, remove, writeTextFile } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      
      // 从 URL 提取仓库名
      const repoName = this.extractRepoName(gitUrl);
      if (!repoName) {
        throw new Error('无法从 URL 提取仓库名称');
      }
      
      // 获取目标路径
      const basePath = await this.getSkillsBasePath();
      const targetDir = await join(basePath, repoName);
      
      // 检查是否已存在
      if (await exists(targetDir)) {
        throw new Error(`技能 '${repoName}' 已存在，请先卸载`);
      }
      
      // 执行 git clone
      const result = await Command.create('git', [
        'clone',
        '--depth', '1',
        gitUrl,
        targetDir
      ]).execute();
      
      if (result.code !== 0) {
        throw new Error(`Git 克隆失败: ${result.stderr}`);
      }
      
      // 验证 SKILL.md 存在
      const skillMdPath = await join(targetDir, 'SKILL.md');
      if (!(await exists(skillMdPath))) {
        // 清理
        await remove(targetDir, { recursive: true });
        throw new Error('仓库中未找到 SKILL.md，不是有效的技能仓库');
      }

      // 写入安装元信息（用于更新/展示）
      try {
        const metaPath = await join(targetDir, '.chatless-skill.json');
        await writeTextFile(metaPath, JSON.stringify({ installMethod: 'git', repoUrl: gitUrl, updatedAt: Date.now() }, null, 2));
      } catch {
        // ignore
      }
      
      // 刷新列表
      await this.refresh();
      
      return targetDir;
    } catch (error) {
      console.error(`[SkillManager] Failed to clone from Git:`, error);
      throw error;
    }
  }

  /**
   * 从 Git URL 提取仓库名
   */
  private extractRepoName(url: string): string | null {
    // 处理各种 Git URL 格式
    const cleanUrl = url.trim().replace(/\/$/, '').replace(/\.git$/, '');
    const name = cleanUrl.split('/').pop() || cleanUrl.split(':').pop();
    return name || null;
  }

  /**
   * 检查 Git 克隆功能是否可用
   * 需要 shell 插件和系统 Git
   */
  async checkGitAvailable(): Promise<boolean> {
    const r = await this.checkGitStatus();
    return r.ok;
  }

  /**
   * 更可靠的 Git 状态检测（用于 UI 提示与引导）
   * - 区分：shell 插件不可用 / git 不可用 / PATH 问题
   * - 尝试常见安装路径（Windows/macOS/Linux）
   */
  async checkGitStatus(): Promise<{
    ok: boolean;
    reason?: 'shell_plugin_missing' | 'not_found';
    detail?: string;
    gitPath?: string;
    versionText?: string;
  }> {
    // 检查 shell 插件是否可用
    let Command: any;
    try {
      const shellModule = await import('@tauri-apps/plugin-shell');
      Command = (shellModule as any).Command;
    } catch {
      return { ok: false, reason: 'shell_plugin_missing', detail: 'shell plugin not available' };
    }

    const tryRun = async (cmd: string, args: string[]) => {
      try {
        const r = await Command.create(cmd, args).execute();
        const out = String(r.stdout || r.stderr || '').trim();
        return { code: Number(r.code || 0), out };
      } catch (e) {
        return { code: 1, out: e instanceof Error ? e.message : String(e) };
      }
    };

    // 1) 先走 PATH：git --version
    const r1 = await tryRun('git', ['--version']);
    if (r1.code === 0) return { ok: true, gitPath: 'git', versionText: r1.out };

    // 2) 尝试常见安装路径
    try {
      const { platform } = await import('@tauri-apps/plugin-os');
      const { exists } = await import('@tauri-apps/plugin-fs');
      const { join, homeDir } = await import('@tauri-apps/api/path');

      const candidates: string[] = [];
      const plat = await platform();

      if (plat === 'windows') {
        candidates.push(
          'C:/Program Files/Git/cmd/git.exe',
          'C:/Program Files/Git/bin/git.exe',
          'C:/Program Files (x86)/Git/cmd/git.exe',
          'C:/Program Files (x86)/Git/bin/git.exe'
        );
        try {
          const home = await homeDir();
          const p1 = await join(home, 'AppData/Local/Programs/Git/cmd/git.exe');
          const p2 = await join(home, 'AppData/Local/Programs/Git/bin/git.exe');
          candidates.push(p1, p2);
        } catch {
          // ignore
        }
      } else if (plat === 'macos') {
        candidates.push('/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git');
      } else {
        candidates.push('/usr/bin/git', '/usr/local/bin/git', '/bin/git');
      }

      for (const p of candidates) {
        try {
          if (!(await exists(p))) continue;
          const rr = await tryRun(p, ['--version']);
          if (rr.code === 0) return { ok: true, gitPath: p, versionText: rr.out };
        } catch {
          // ignore and continue
        }
      }
    } catch {
      // ignore
    }

    return { ok: false, reason: 'not_found', detail: r1.out || 'git --version failed' };
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = String(key || '').trim();
    const prev = this._opLocks.get(k);
    if (prev) return (await prev) as T;
    const p = (async () => fn())();
    this._opLocks.set(k, p);
    try {
      return await p;
    } finally {
      this._opLocks.delete(k);
    }
  }

  async isGitSkillDirectory(skillPath: string): Promise<boolean> {
    try {
      const { exists } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      const p = await join(skillPath, '.git');
      return await exists(p);
    } catch {
      return false;
    }
  }

  /**
   * 一键更新（仅适用于 Git 安装的技能）
   * - 执行：git -C <skill.path> pull --ff-only
   */
  async updateSkillFromGit(skillId: string): Promise<{ ok: boolean; message: string }> {
    const id = String(skillId || '').trim();
    if (!id) return { ok: false, message: 'skillId is required' };

    return this.withLock(`update:${id}`, async () => {
      const store = useSkillStore.getState();
      const skill = store.skills.find((s) => s.id === id);
      if (!skill || skill.source !== 'local' || !skill.path) {
        return { ok: false, message: 'Skill not found or not local' };
      }

      const isGit = await this.isGitSkillDirectory(skill.path);
      if (!isGit) {
        return { ok: false, message: 'Not a git-installed skill' };
      }

      // shell plugin required
      let Command: any;
      try {
        const shellModule = await import('@tauri-apps/plugin-shell');
        Command = (shellModule as any).Command;
      } catch {
        return { ok: false, message: 'Git 更新需要 shell 插件。' };
      }

      // git available
      const okGit = await this.checkGitAvailable();
      if (!okGit) return { ok: false, message: '未检测到 Git，请先安装并配置到 PATH。' };

      const r = await Command.create('git', ['-C', skill.path, 'pull', '--ff-only']).execute();
      if (r.code !== 0) {
        return { ok: false, message: String(r.stderr || r.stdout || 'git pull failed') };
      }

      await this.refresh();
      return { ok: true, message: '更新完成' };
    });
  }

  /**
   * 重新导入覆盖（用于 ZIP/手动拷贝安装的技能）
   */
  async reinstallSkillFromZip(skillId: string, zipPath: string): Promise<{ ok: boolean; message: string }> {
    const id = String(skillId || '').trim();
    const zp = String(zipPath || '').trim();
    if (!id || !zp) return { ok: false, message: 'skillId and zipPath are required' };

    return this.withLock(`reinstall:${id}`, async () => {
      await this.importFromZip(zp, { overwrite: true, targetSkillId: id });
      return { ok: true, message: '覆盖安装完成' };
    });
  }

  /**
   * 获取技能存储的基础路径
   */
  async getSkillsBasePath(): Promise<string> {
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      const { join } = await import('@tauri-apps/api/path');
      const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
      
      const appData = await appDataDir();
      const skillsDir = await join(appData, 'skills');
      
      // 确保目录存在
      if (!(await exists(skillsDir))) {
        await mkdir(skillsDir, { recursive: true });
      }

      // 自动加入 filesystem 白名单（确保 skill 文件操作不会被权限拒绝）
      try {
        await ensureAllowlistedDirectory({
          path: skillsDir,
          alias: 'Skills',
          source: 'skills',
          permissions: { read: true, write: true, create: true, delete: false },
          reconnect: true,
        });
      } catch (e) {
        console.warn('[SkillManager] Failed to add skills dir to allowlist:', e);
        // 继续执行，让后续操作给出具体错误
      }
      
      return skillsDir;
    } catch (error) {
      console.error(`[SkillManager] Failed to get skills base path:`, error);
      throw error;
    }
  }

  /**
   * 打开技能文件夹
   */
  async openSkillsFolder(): Promise<void> {
    try {
      const basePath = await this.getSkillsBasePath();
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(basePath);
    } catch (error) {
      console.error(`[SkillManager] Failed to open skills folder:`, error);
      throw error;
    }
  }

  /**
   * 启用技能
   */
  enableSkill(id: string): void {
    useSkillStore.getState().enableSkill(id);
  }

  /**
   * 禁用技能
   */
  disableSkill(id: string): void {
    useSkillStore.getState().disableSkill(id);
  }

  /**
   * 切换技能启用状态
   */
  toggleSkill(id: string): void {
    useSkillStore.getState().toggleSkill(id);
  }

  /**
   * 获取已启用的技能列表
   */
  getEnabledSkills(): Skill[] {
    return useSkillStore.getState().skills.filter(s => s.enabled);
  }

  /**
   * 获取本地技能列表
   */
  getLocalSkills(): Skill[] {
    return useSkillStore.getState().skills.filter(s => s.source === 'local');
  }

  /**
   * 获取远程技能列表
   */
  getRemoteSkills(): Skill[] {
    return useSkillStore.getState().skills.filter(s => s.source === 'remote');
  }

  // ================================
  // 渐进式披露 (Progressive Disclosure) 相关方法
  // ================================

  /**
   * 生成技能索引（用于 System Prompt 注入）
   * 
   * 每个技能仅保留名称和简短描述，约 100 tokens
   * 实现渐进式披露的关键：让 AI 知道有哪些技能可用，但不占用大量上下文
   * 
   * @param maxDescriptionLength - 描述最大长度，默认 200
   */
  getSkillIndex(maxDescriptionLength = 200): SkillIndexEntry[] {
    const enabledSkills = this.getEnabledSkills();
    
    return enabledSkills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: this.truncateText(skill.description, maxDescriptionLength),
      lineCount: (() => {
        try {
          const s = String((skill as any)?.skillMdContent || '');
          if (!s) return undefined;
          return s.split('\n').length;
        } catch {
          return undefined;
        }
      })(),
      triggers: this.extractTriggers(skill),
      category: skill.category,
    }));
  }

  /**
   * 获取技能的完整提示词内容
   * 
   * 实现渐进式披露的第二层：当 AI 确定需要某技能时，获取完整内容
   * 
   * @param skillId - 技能 ID
   * @param maxContentLength - 内容最大长度，默认 8000（约 2000 tokens）
   */
  async getSkillPromptContent(skillId: string, maxContentLength = 8000): Promise<string | null> {
    const skill = await this.getSkill(skillId);
    if (!skill || !skill.skillMdContent) {
      return null;
    }

    // 如果内容过长，进行智能截断
    if (skill.skillMdContent.length > maxContentLength) {
      return this.truncateSkillContent(skill.skillMdContent, maxContentLength);
    }

    return skill.skillMdContent;
  }

  /**
   * 构建用于注入的技能索引提示词
   * 
   * 这是注入到 System Prompt 的“极简版”技能列表：
   * - 只注入 name + description（附带 id 便于调用）
   * - SOP/调用规范由 tools description（厚工具描述）承载，避免重复占上下文
   */
  buildSkillIndexPrompt(): string | null {
    const index = this.getSkillIndex();
    if (index.length === 0) return null;

    const lines = index.map((s) => {
      const id = String((s as any)?.id || '').trim();
      const name = String((s as any)?.name || id || '').trim();
      const desc = String((s as any)?.description || '').trim();
      const lc = typeof (s as any)?.lineCount === 'number' ? (s as any).lineCount : undefined;
      const lcText = (lc && Number.isFinite(lc) && lc > 0) ? ` (${lc} lines)` : '';
      return `- **${name || id || '(unknown)'}** (${id ? `\`${id}\`` : '(unknown-id)'}${lcText}): ${desc || '(no description)'}`;
    });

    // 精简版规则：强调必须调用 skill__guide 获取操作指南
    const header = `## 可用 Skills

⚠️ 此列表仅含名称，不含操作方法。

使用流程：
1. skill__guide → 获取操作指南（SKILL.md）
2. 按指南执行，如需 skill 包内的模板/脚本 → skill__list_files + skill__read_file
3. 使用 shell__run、fs__* 完成任务

❌ 禁止：跳过 skill__guide 直接操作

已启用：`;
    return header + '\n' + lines.join('\n');
  }

  /**
   * 截断文本
   */
  private truncateText(text: string | null | undefined, maxLength: number): string {
    const s = String(text ?? '');
    if (!Number.isFinite(maxLength) || maxLength <= 0) return '';
    if (s.length <= maxLength) {
      return s;
    }
    if (maxLength <= 3) return s.slice(0, maxLength);
    return s.slice(0, maxLength - 3) + '...';
  }

  /**
   * 从技能中提取触发关键词
   */
  private extractTriggers(skill: Skill): string[] {
    const out: string[] = [];

    // 1) frontmatter triggers（若存在，优先）
    if (Array.isArray((skill as any).triggers) && (skill as any).triggers.length > 0) {
      for (const t of (skill as any).triggers.slice(0, 6)) {
        const s = String(t || '').trim();
        if (s) out.push(s);
      }
    }

    // 2) tags（保留前几个）
    if (Array.isArray(skill.tags) && skill.tags.length > 0) {
      for (const t of skill.tags.slice(0, 6)) {
        const s = String(t || '').trim();
        if (s) out.push(s);
      }
    }

    // 3) skill id（用户经常直接写 id）
    const id = String((skill as any).id || '').trim();
    if (id) out.push(id);

    // 4) name 分词（必须防御：name 可能为 undefined）
    const name = String((skill as any).name || '').trim();
    if (name) {
      const words = name.toLowerCase().split(/[\s\-_]+/g).filter(Boolean);
      for (const w of words) {
        if (w.length > 2) out.push(w);
      }
    }

    // 去重并限制数量
    return Array.from(new Set(out)).slice(0, 8);
  }

  /**
   * 智能截断技能内容
   * 
   * 优先保留重要部分：
   * 1. frontmatter
   * 2. When to Use 部分
   * 3. Instructions 部分
   * 4. Examples 部分（至少一个）
   */
  private truncateSkillContent(content: string, maxLength: number): string {
    // 简单实现：保留前 maxLength 个字符
    // 未来可以实现更智能的截断逻辑
    const lines = content.split('\n');
    let result = '';
    let currentLength = 0;
    
    for (const line of lines) {
      if (currentLength + line.length + 1 > maxLength) {
        break;
      }
      result += line + '\n';
      currentLength += line.length + 1;
    }
    
    if (result.length < content.length) {
      result += '\n\n[内容已截断，请参考完整文档]';
    }
    
    return result;
  }
}

// 单例实例
let managerInstance: SkillManager | null = null;

/**
 * 获取技能管理器单例
 */
export function getSkillManager(config?: SkillManagerConfig): SkillManager {
  if (!managerInstance) {
    managerInstance = new SkillManager(config);
  }
  return managerInstance;
}

/**
 * 重置技能管理器（用于测试）
 */
export function resetSkillManager(): void {
  managerInstance = null;
}


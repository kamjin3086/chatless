/**
 * 技能管理器
 * 
 * 统一管理本地和远程技能的加载、安装、更新等操作
 */

import type { Skill, SkillManagerConfig, SkillInstallOptions, SkillIndexEntry } from './types';
import { LocalSkillLoader, createLocalSkillLoader } from './LocalSkillLoader';
import { RemoteSkillLoader, createRemoteSkillLoader } from './RemoteSkillLoader';
import { useSkillStore } from '@/store/skillStore';

/**
 * 技能管理器
 */
export class SkillManager {
  private config: SkillManagerConfig;
  private localLoader: LocalSkillLoader;
  private remoteLoader: RemoteSkillLoader;
  private initialized = false;

  constructor(config: SkillManagerConfig = {}) {
    this.config = {
      localSkillsPath: config.localSkillsPath || 'skills',
      remoteRepoUrl: config.remoteRepoUrl || 'https://github.com/anthropics/skills',
      cachePath: config.cachePath || 'skills-cache',
      autoCheckUpdates: config.autoCheckUpdates ?? true,
    };

    this.localLoader = createLocalSkillLoader({
      skillsPath: this.config.localSkillsPath,
    });

    this.remoteLoader = createRemoteSkillLoader({
      repoUrl: this.config.remoteRepoUrl,
    });
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
      if (this.config.autoCheckUpdates) {
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
   * 加载所有技能（本地 + 远程）
   */
  async loadAllSkills(): Promise<Skill[]> {
    const store = useSkillStore.getState();
    
    try {
      // 并行加载本地和远程技能
      const [localSkills, remoteSkills] = await Promise.all([
        this.localLoader.loadAll(),
        this.remoteLoader.loadAll(),
      ]);

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
      this.remoteLoader.clearCache();

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

    return this.remoteLoader.load(id);
  }

  /**
   * 检查技能更新
   */
  async checkForUpdates(): Promise<Map<string, boolean>> {
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
  async importFromZip(zipPath: string): Promise<string | null> {
    try {
      const { readFile, writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
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
      
      // 确定目标目录名
      const zipFileName = zipPath.split(/[/\\]/).pop() || 'imported-skill';
      const skillDirName = skillRoot 
        ? skillRoot.split('/')[0] 
        : zipFileName.replace(/\.zip$/i, '');
      
      // 获取技能基础路径
      const basePath = await this.getSkillsBasePath();
      const { join } = await import('@tauri-apps/api/path');
      const targetDir = await join(basePath, skillDirName);
      
      // 检查目标目录是否已存在
      if (await exists(targetDir)) {
        throw new Error(`技能 '${skillDirName}' 已存在，请先卸载`);
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
      
      const { exists, remove } = await import('@tauri-apps/plugin-fs');
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
    try {
      // 检查 shell 插件是否可用
      let Command;
      try {
        const shellModule = await import('@tauri-apps/plugin-shell');
        Command = shellModule.Command;
      } catch {
        return false; // 插件未安装
      }
      
      // 检查系统 Git 是否可用
      const result = await Command.create('git', ['--version']).execute();
      return result.code === 0;
    } catch {
      return false;
    }
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
      const { open } = await import('@tauri-apps/plugin-opener');
      await open(basePath);
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
   * 这是注入到 System Prompt 的精简版技能列表
   */
  buildSkillIndexPrompt(): string | null {
    const index = this.getSkillIndex();
    if (index.length === 0) {
      return null;
    }

    const skillList = index.map(s => {
      const triggers = s.triggers.length > 0 
        ? ` [触发词: ${s.triggers.slice(0, 3).join(', ')}]` 
        : '';
      return `- **${s.name}** (\`${s.id}\`): ${s.description}${triggers}`;
    }).join('\n');

    // 构建每个技能的 ID 列表，用于关键词匹配提示
    const skillIds = index.map(s => s.id).join(', ');
    
    return `## 🎯 可用技能 (HIGHEST PRIORITY)

**重要：当用户请求涉及以下任何技能时，必须首先使用技能工具，不要使用 web_search！**

技能关键词匹配列表：${skillIds}

已启用的技能：

${skillList}

### 技能工具调用方式

**1. 获取技能说明（必须首先调用）：**
\`\`\`xml
<use_mcp_tool>
<server_name>skills</server_name>
<tool_name>get_skill_instructions</tool_name>
<arguments>{"skillId": "技能ID"}</arguments>
</use_mcp_tool>
\`\`\`

**2. 查看技能可用动作：**
\`\`\`xml
<use_mcp_tool>
<server_name>skills</server_name>
<tool_name>list_skill_actions</tool_name>
<arguments>{"skillId": "技能ID"}</arguments>
</use_mcp_tool>
\`\`\`

**3. 执行特定动作：**
\`\`\`xml
<use_mcp_tool>
<server_name>skills</server_name>
<tool_name>run_skill_action</tool_name>
<arguments>{"skillId": "技能ID", "actionId": "动作ID"}</arguments>
</use_mcp_tool>
\`\`\`

### 动作执行说明

技能可以定义多种类型的动作：
- **shell**: 执行 Shell/PowerShell 命令
- **script**: 执行 Python/Node.js 脚本
- **file**: 文件读写操作
- **mcp_tool**: 调用其他 MCP 工具
- **instruction**: 纯文本指令

高风险动作会等待用户确认，用户可以：
- 直接批准执行
- 编辑命令后执行
- 拒绝执行

### 强制执行策略
1. **检测关键词**：如果用户消息包含 ${skillIds} 等关键词，**立即**调用 \`get_skill_instructions\`
2. **禁止 web_search**：对于已安装的技能，**绝对不要**使用 web_search 搜索相关信息
3. **获取技能指令**：调用 \`get_skill_instructions\` 获取详细操作说明
4. **查看可用动作**：如果技能定义了动作，调用 \`list_skill_actions\` 查看可用动作
5. **执行动作**：使用 \`run_skill_action\` 执行具体动作，或按照技能指令操作
6. **示例**：用户说"创建一个docx文档" → 立即调用 \`get_skill_instructions\` 获取 docx 技能指令`;
  }

  /**
   * 截断文本
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * 从技能中提取触发关键词
   */
  private extractTriggers(skill: Skill): string[] {
    const triggers: string[] = [];
    
    // 从 tags 提取
    if (skill.tags) {
      triggers.push(...skill.tags.slice(0, 3));
    }
    
    // 从名称中提取关键词
    const nameWords = skill.name.toLowerCase().split(/[\s-_]+/);
    triggers.push(...nameWords.filter(w => w.length > 2));
    
    // 去重并限制数量
    return [...new Set(triggers)].slice(0, 5);
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


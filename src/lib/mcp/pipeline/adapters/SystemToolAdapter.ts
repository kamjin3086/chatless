/**
 * SystemToolAdapter - 系统内部功能的 Tool Adapter
 *
 * 职责：处理 system__* 命名的工具调用，对接 promptStore、SkillManager 等内部模块。
 * 命名约定：server = "system"
 */

import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { usePromptStore } from '@/store/promptStore';
import { useSkillStore } from '@/store/skillStore';
import { getSkillManager } from '@/lib/skills/SkillManager';
import type { PromptItem } from '@/types/prompt';

const SYSTEM_SERVER = 'system';

export class SystemToolAdapter implements ToolAdapter {
  readonly server = SYSTEM_SERVER;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === SYSTEM_SERVER;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const { tool, args } = invocation;

    // 根据 tool 名称分发到对应处理函数
    switch (tool) {
      // === Prompt Management ===
      case 'list_prompts':
        return this.listPrompts(args || {});
      case 'get_prompt':
        return this.getPrompt(args || {});
      case 'create_prompt':
        return this.createPrompt(args || {});
      case 'update_prompt':
        return this.updatePrompt(args || {});
      case 'delete_prompt':
        return this.deletePrompt(args || {});
      case 'optimize_prompt':
        return this.optimizePrompt(args || {});

      // === Skill Management ===
      case 'list_skills':
        return this.listSkills(args || {});
      case 'get_skill':
        return this.getSkill(args || {});
      case 'install_skill_from_git':
        return this.installSkillFromGit(args || {});
      case 'install_skill_from_zip':
        return this.installSkillFromZip(args || {});
      case 'uninstall_skill':
        return this.uninstallSkill(args || {});
      case 'enable_skill':
        return this.enableSkill(args || {});
      case 'disable_skill':
        return this.disableSkill(args || {});
      case 'update_skill':
        return this.updateSkill(args || {});

      default:
        return { error: `Unknown system tool: ${tool}` };
    }
  }

  // ========================================
  // Prompt Management Implementation
  // ========================================

  private listPrompts(args: Record<string, unknown>): unknown {
    const store = usePromptStore.getState();
    let prompts = [...store.prompts];

    // 搜索过滤
    const query = String(args.query || '').trim().toLowerCase();
    if (query) {
      prompts = prompts.filter((p) => {
        const name = (p.name || '').toLowerCase();
        const desc = (p.description || '').toLowerCase();
        const tags = (p.tags || []).join(' ').toLowerCase();
        const shortcuts = (p.shortcuts || []).join(' ').toLowerCase();
        return name.includes(query) || desc.includes(query) || tags.includes(query) || shortcuts.includes(query);
      });
    }

    // 按标签过滤
    const tag = String(args.tag || '').trim().toLowerCase();
    if (tag) {
      prompts = prompts.filter((p) => (p.tags || []).some((t) => t.toLowerCase() === tag));
    }

    // 仅收藏
    if (args.favoriteOnly === true) {
      prompts = prompts.filter((p) => p.favorite);
    }

    // 限制数量
    let limit = Number(args.limit) || 20;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;
    prompts = prompts.slice(0, limit);

    // 返回精简数据
    return {
      total: prompts.length,
      prompts: prompts.map((p) => ({
        id: p.id,
        name: p.name,
        description: (p.description || '').slice(0, 100),
        tags: p.tags || [],
        favorite: p.favorite,
        updatedAt: p.updatedAt,
      })),
    };
  }

  private getPrompt(args: Record<string, unknown>): unknown {
    const store = usePromptStore.getState();
    const id = String(args.id || '').trim();
    const name = String(args.name || '').trim().toLowerCase();

    let prompt: PromptItem | undefined;

    if (id) {
      prompt = store.prompts.find((p) => p.id === id);
    }
    if (!prompt && name) {
      // 精确或近似匹配
      prompt = store.prompts.find((p) => (p.name || '').toLowerCase() === name);
      if (!prompt) {
        prompt = store.prompts.find((p) => (p.name || '').toLowerCase().includes(name));
      }
    }

    if (!prompt) {
      return { error: 'Prompt not found', id, name };
    }

    return {
      id: prompt.id,
      name: prompt.name,
      description: prompt.description,
      content: prompt.content,
      tags: prompt.tags,
      shortcuts: prompt.shortcuts,
      favorite: prompt.favorite,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
    };
  }

  private createPrompt(args: Record<string, unknown>): unknown {
    const store = usePromptStore.getState();
    const name = String(args.name || '').trim();
    const content = String(args.content || '').trim();

    if (!name || !content) {
      return { error: 'name and content are required' };
    }

    const id = store.createPrompt({
      name,
      content,
      description: String(args.description || ''),
      tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
      shortcuts: Array.isArray(args.shortcuts) ? args.shortcuts.map(String) : [],
      favorite: args.favorite === true,
      variables: [],
      languages: [],
      modelHints: [],
    });

    return { success: true, id, message: `Prompt "${name}" created` };
  }

  private updatePrompt(args: Record<string, unknown>): unknown {
    const store = usePromptStore.getState();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const existing = store.prompts.find((p) => p.id === id);
    if (!existing) {
      return { error: 'Prompt not found', id };
    }

    const updates: Partial<PromptItem> = {};
    if (typeof args.name === 'string') updates.name = args.name;
    if (typeof args.content === 'string') updates.content = args.content;
    if (typeof args.description === 'string') updates.description = args.description;
    if (Array.isArray(args.tags)) updates.tags = args.tags.map(String);
    if (Array.isArray(args.shortcuts)) updates.shortcuts = args.shortcuts.map(String);
    if (typeof args.favorite === 'boolean') updates.favorite = args.favorite;

    store.updatePrompt(id, updates);

    return { success: true, id, message: `Prompt "${existing.name}" updated` };
  }

  private deletePrompt(args: Record<string, unknown>): unknown {
    const store = usePromptStore.getState();
    const id = String(args.id || '').trim();
    const confirm = args.confirm === true;

    if (!id) {
      return { error: 'id is required' };
    }

    if (!confirm) {
      return { error: 'confirm must be true to delete', id };
    }

    const existing = store.prompts.find((p) => p.id === id);
    if (!existing) {
      return { error: 'Prompt not found', id };
    }

    store.deletePrompt(id);

    return { success: true, id, message: `Prompt "${existing.name}" deleted` };
  }

  private optimizePrompt(args: Record<string, unknown>): unknown {
    const store = usePromptStore.getState();
    const id = String(args.id || '').trim();
    const goal = String(args.optimization_goal || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const existing = store.prompts.find((p) => p.id === id);
    if (!existing) {
      return { error: 'Prompt not found', id };
    }

    // 生成优化建议（这里返回占位符，实际可调用 LLM 生成）
    // 真正的实现可能需要调用 LLM API，这里返回原内容 + 说明
    return {
      id,
      originalContent: existing.content,
      proposedContent: existing.content, // 占位：实际应由 Agent 基于 goal 生成
      optimizationGoal: goal || '(未指定)',
      note: '优化建议已生成。如需应用，请调用 system__update_prompt 更新 content 字段。',
    };
  }

  // ========================================
  // Skill Management Implementation
  // ========================================

  private listSkills(args: Record<string, unknown>): unknown {
    const store = useSkillStore.getState();
    let skills = [...store.skills];

    // 搜索过滤
    const query = String(args.query || '').trim().toLowerCase();
    if (query) {
      skills = skills.filter((s) => {
        const name = (s.name || '').toLowerCase();
        const desc = (s.description || '').toLowerCase();
        const tags = (s.tags || []).join(' ').toLowerCase();
        return name.includes(query) || desc.includes(query) || tags.includes(query);
      });
    }

    // 按状态过滤
    const status = String(args.status || '').trim();
    if (status && status !== 'all') {
      skills = skills.filter((s) => s.status === status);
    }

    // 按来源过滤
    const source = String(args.source || '').trim();
    if (source && source !== 'all') {
      skills = skills.filter((s) => s.source === source);
    }

    // 返回精简数据
    return {
      total: skills.length,
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: (s.description || '').slice(0, 100),
        status: s.status,
        source: s.source,
        enabled: s.enabled,
        category: s.category,
      })),
    };
  }

  private async getSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();
    const name = String(args.name || '').trim().toLowerCase();

    let skill = null;

    if (id) {
      skill = await manager.getSkill(id);
    }
    if (!skill && name) {
      const store = useSkillStore.getState();
      const found = store.skills.find((s) => (s.name || '').toLowerCase() === name);
      if (found) {
        skill = await manager.getSkill(found.id);
      }
    }

    if (!skill) {
      return { error: 'Skill not found', id, name };
    }

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      author: skill.author,
      status: skill.status,
      source: skill.source,
      enabled: skill.enabled,
      category: skill.category,
      tags: skill.tags,
      path: skill.path,
      repoUrl: skill.repoUrl,
      installedAt: skill.installedAt,
    };
  }

  private async installSkillFromGit(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const repoUrl = String(args.repoUrl || '').trim();

    if (!repoUrl) {
      return { error: 'repoUrl is required' };
    }

    try {
      const path = await manager.cloneFromGit(repoUrl);
      return { success: true, path, message: `Skill installed from ${repoUrl}` };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async installSkillFromZip(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const filePath = String(args.filePath || '').trim();

    if (!filePath) {
      return { error: 'filePath is required' };
    }

    try {
      const path = await manager.importFromZip(filePath);
      return { success: true, path, message: `Skill installed from ZIP` };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async uninstallSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    try {
      const success = await manager.uninstallSkill(id);
      if (success) {
        return { success: true, id, message: `Skill "${id}" uninstalled` };
      } else {
        return { error: 'Failed to uninstall skill', id };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private enableSkill(args: Record<string, unknown>): unknown {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const store = useSkillStore.getState();
    const skill = store.skills.find((s) => s.id === id);
    if (!skill) {
      return { error: 'Skill not found', id };
    }

    manager.enableSkill(id);
    return { success: true, id, message: `Skill "${skill.name}" enabled` };
  }

  private disableSkill(args: Record<string, unknown>): unknown {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const store = useSkillStore.getState();
    const skill = store.skills.find((s) => s.id === id);
    if (!skill) {
      return { error: 'Skill not found', id };
    }

    manager.disableSkill(id);
    return { success: true, id, message: `Skill "${skill.name}" disabled` };
  }

  private async updateSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const store = useSkillStore.getState();
    const skill = store.skills.find((s) => s.id === id);
    if (!skill) {
      return { error: 'Skill not found', id };
    }

    // 检查是否为 Git 安装的技能
    const isGit = skill.path ? await manager.isGitSkillDirectory(skill.path) : false;

    if (isGit) {
      const result = await manager.updateSkillFromGit(id);
      return result;
    } else {
      return {
        error: 'Skill is not git-installed. Use install_skill_from_zip to reinstall.',
        id,
      };
    }
  }
}

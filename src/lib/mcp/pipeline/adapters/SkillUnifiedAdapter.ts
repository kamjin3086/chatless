/**
 * SkillUnifiedAdapter - 统一的 Skill 工具适配器
 *
 * 合并了原来分散的三个 skill 相关适配器：
 * - SkillsToolAdapter (list_available_skills, get_skill_instructions 等)
 * - SystemToolAdapter 中的 skill 部分 (list_skills, install/uninstall 等)
 * - SkillsFsAdapter (list_skill_resources, read_skill_resource 等)
 *
 * 设计理念：Skill 是"指导 AI 如何组合使用已有 Tools 完成任务"的模板
 */

import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { SKILL_SERVER_NAME } from '@/lib/mcp/nativeTools/skillUnifiedTools';
import { getSkillManager } from '@/lib/skills/SkillManager';
import { parseSkillMd } from '@/lib/skills/SkillMdParser';
import {
  listSkillResources,
  readSkillResource,
  writeSkillFile,
} from '@/lib/skills/skillFileOperations';

export class SkillUnifiedAdapter implements ToolAdapter {
  readonly server = SKILL_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === SKILL_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const { tool, args } = invocation;

    switch (tool) {
      // 列表和查询
      case 'list':
        return this.listSkills(args || {});
      case 'guide':
        return this.getSkillGuide(args || {});

      // 安装和卸载
      case 'install':
        return this.installSkill(args || {});
      case 'uninstall':
        return this.uninstallSkill(args || {});

      // 启用和禁用
      case 'enable':
        return this.enableSkill(args || {});
      case 'disable':
        return this.disableSkill(args || {});

      // 更新
      case 'update':
        return this.updateSkill(args || {});

      // 资源获取（只读）
      case 'list_resources':
        return this.listResources(args || {});
      case 'get_template':
        return this.getTemplate(args || {});

      // 编辑 skill 包资源（需用户明确指示）
      case 'edit_resource':
        return this.editResource(args || {});

      // 依赖检查
      case 'check_deps':
        return this.checkDeps(args || {});

      default:
        return { error: `Unknown skill tool: ${tool}` };
    }
  }

  // ========================================
  // 列表和查询
  // ========================================

  private async listSkills(args: Record<string, unknown>): Promise<unknown> {
    // 只问 manager：它是磁盘与启用态的 provider，store 只是它写给 UI 的视图缓存。
    // 从 store 直接读，模型看见的就是「上一次界面刷新时」的世界，而不是盘上的事实。
    const manager = getSkillManager();
    await manager.initialize();
    const query = String(args.query || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 200);

    let entries = manager.getSkillIndex();
    if (query) {
      entries = entries.filter((entry) => {
        const haystack = `${entry.name} ${entry.id} ${entry.description} ${entry.category || ''}`.toLowerCase();
        return haystack.includes(query);
      });
    }

    const total = entries.length;
    const shown = entries.slice(0, limit);

    return {
      total,
      skills: shown.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: (entry.description || '').slice(0, 200),
      })),
      warning:
        shown.length > 0
          ? 'These are names only. Call skill__guide with an id before acting on a skill.'
          : 'No enabled skill matches. Compose the ordinary tools (fs__*, shell__run, web__*) instead.',
    };
  }

  private async getSkillGuide(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();
    const name = String(args.name || '').trim().toLowerCase();
    const includeContent = args.includeContent !== false; // 默认 true
    const startLine = typeof args.startLine === 'number' ? args.startLine : undefined;
    const endLine = typeof args.endLine === 'number' ? args.endLine : undefined;

    let skill = null;

    if (id) {
      skill = await manager.getSkill(id);
    }
    if (!skill && name) {
      const found = manager.getEnabledSkills().find((s) => (s.name || '').toLowerCase() === name);
      if (found) {
        skill = await manager.getSkill(found.id);
      }
    }

    if (!skill) {
      return { error: 'Skill not found', id, name };
    }

    const result: Record<string, unknown> = {
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
      repoUrl: skill.repoUrl,
      installedAt: skill.installedAt,
    };

    // 获取 SKILL.md 内容
    if (includeContent) {
      const full = await manager.getSkillPromptContent(skill.id, 200000);
      if (full) {
        const lines = String(full).split('\n');
        const totalLines = lines.length;

        if (startLine || endLine) {
          const s = Math.max(1, Math.floor(startLine || 1));
          const e = Math.min(totalLines, Math.floor(endLine || totalLines));
          const start = Math.min(s, totalLines || 1);
          const end = Math.max(start, e);
          result.content = lines.slice(start - 1, end).join('\n');
          result.contentRange = { start, end, total: totalLines };
        } else {
          result.content = full;
          result.contentLines = totalLines;
        }

        // 解析 SKILL.md 获取依赖信息
        const parsed = parseSkillMd(full);
        if (parsed.frontmatter?.dependencies && parsed.frontmatter.dependencies.length > 0) {
          result.dependencies = parsed.frontmatter.dependencies;
        }
      }
    }

    // 执行指南：告诉模型如何按 SKILL.md 把活干完
    result.howToUse = {
      step1: 'Follow the guide in content.',
      step2: 'If it points at files inside the package, list them with skill__list_resources and read one with skill__get_template.',
      step3: 'Do the work with the ordinary tools: shell__run, and fs__write under @WorkDir.',
      important: 'Task output goes to @WorkDir with fs__write, never into the skill package.',
    };

    return result;
  }

  // ========================================
  // 安装和卸载
  // ========================================

  private async installSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const repoUrl = String(args.repoUrl || '').trim();
    const zipPath = String(args.zipPath || '').trim();

    if (repoUrl) {
      try {
        const path = await manager.cloneFromGit(repoUrl);
        return { success: true, path, message: `Skill installed from ${repoUrl}` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    if (zipPath) {
      try {
        const path = await manager.importFromZip(zipPath);
        return { success: true, path, message: 'Skill installed from ZIP' };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    return { error: 'Either repoUrl or zipPath is required' };
  }

  private async uninstallSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();
    const confirm = args.confirm === true;

    if (!id) {
      return { error: 'id is required' };
    }

    if (!confirm) {
      return { error: 'confirm must be true to uninstall', id };
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

  // ========================================
  // 启用和禁用
  // ========================================

  private async enableSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const skill = await manager.getSkill(id);
    if (!skill) {
      return { error: 'Skill not found', id };
    }

    manager.enableSkill(id);
    return { success: true, id, message: `Skill "${skill.name}" enabled` };
  }

  private async disableSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const skill = await manager.getSkill(id);
    if (!skill) {
      return { error: 'Skill not found', id };
    }

    manager.disableSkill(id);
    return { success: true, id, message: `Skill "${skill.name}" disabled` };
  }

  // ========================================
  // 更新
  // ========================================

  private async updateSkill(args: Record<string, unknown>): Promise<unknown> {
    const manager = getSkillManager();
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const skill = await manager.getSkill(id);
    if (!skill) {
      return { error: 'Skill not found', id };
    }

    const isGit = skill.path ? await manager.isGitSkillDirectory(skill.path) : false;

    if (isGit) {
      const result = await manager.updateSkillFromGit(id);
      return result;
    } else {
      return {
        error: 'Skill is not git-installed. Use skill__install to reinstall.',
        id,
      };
    }
  }

  // ========================================
  // 资源获取（只读）
  // ========================================

  private async listResources(args: Record<string, unknown>): Promise<unknown> {
    const id = String(args.id || '').trim();
    const max = typeof args.max === 'number' ? args.max : 50;

    if (!id) {
      return { error: 'id is required' };
    }

    try {
      const files = await listSkillResources(id, max);
      return {
        skillId: id,
        resources: files,
        count: files.length,
        usage: '使用 skill__get_template 读取模板/示例内容，然后用 fs__write 写入用户目录',
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async getTemplate(args: Record<string, unknown>): Promise<unknown> {
    const id = String(args.id || '').trim();
    // 支持 name（新）和 path（旧）两种参数名
    const name = String(args.name || args.path || '').trim();
    const maxLines = typeof args.maxLines === 'number' ? args.maxLines : undefined;

    if (!id) {
      return { error: 'id is required' };
    }
    if (!name) {
      return { error: 'name is required (资源文件名，从 skill__list_resources 获取)' };
    }

    try {
      const content = await readSkillResource(id, name, maxLines);
      return {
        skillId: id,
        name,
        content,
        usage: '这是 skill 包提供的模板/示例。如需使用，请用 fs__write 写入用户目录（@WorkDir/...）',
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async editResource(args: Record<string, unknown>): Promise<unknown> {
    const id = String(args.id || '').trim();
    // 支持 name（新）和 path（旧）两种参数名
    const name = String(args.name || args.path || '').trim();
    const content = String(args.content ?? '');

    if (!id) {
      return { error: 'id is required' };
    }
    if (!name) {
      return { error: 'name is required (资源文件名)' };
    }

    try {
      const result = await writeSkillFile(id, name, content);
      return {
        success: true,
        skillId: id,
        name,
        message: result,
        note: '已修改 skill 包内部资源。如果这不是你想要的，用户文件请用 fs__write + @WorkDir。',
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ========================================
  // 依赖检查
  // ========================================

  private async checkDeps(args: Record<string, unknown>): Promise<unknown> {
    const id = String(args.id || '').trim();

    if (!id) {
      return { error: 'id is required' };
    }

    const manager = getSkillManager();
    const skill = await manager.getSkill(id);

    if (!skill) {
      return { error: 'Skill not found', id };
    }

    // 获取 SKILL.md 解析依赖
    const content = await manager.getSkillPromptContent(id, 200000);
    if (!content) {
      return { skillId: id, dependencies: [], allMet: true };
    }

    const parsed = parseSkillMd(content);
    const dependencies = parsed.frontmatter?.dependencies || [];

    if (dependencies.length === 0) {
      return { skillId: id, dependencies: [], allMet: true };
    }

    // 简单返回依赖列表，实际检查可以扩展
    return {
      skillId: id,
      dependencies,
      note: '请确保这些依赖已安装，然后使用 shell__run 等工具执行任务。',
    };
  }
}

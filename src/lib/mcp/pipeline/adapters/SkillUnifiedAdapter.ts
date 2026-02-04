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
import { useSkillStore } from '@/store/skillStore';
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
      case 'use':  // 新名称
      case 'get':  // 兼容旧名称
        return this.getSkill(args || {});

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

      // 文件操作
      case 'list_files':
        return this.listFiles(args || {});
      case 'read_file':
        return this.readFile(args || {});
      case 'write_file':
        return this.writeFile(args || {});

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

  private listSkills(args: Record<string, unknown>): unknown {
    const store = useSkillStore.getState();
    const manager = getSkillManager();
    const mode = String(args.mode || 'task');
    const enabledOnly = args.enabledOnly !== false; // 默认 true
    const query = String(args.query || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 200);

    let skills = [...store.skills];

    // 仅已启用
    if (enabledOnly) {
      skills = skills.filter((s) => s.enabled);
    }

    // 搜索过滤
    if (query) {
      skills = skills.filter((s) => {
        const name = (s.name || '').toLowerCase();
        const desc = (s.description || '').toLowerCase();
        const tags = (s.tags || []).join(' ').toLowerCase();
        return name.includes(query) || desc.includes(query) || tags.includes(query);
      });
    }

    skills = skills.slice(0, limit);

    if (mode === 'admin') {
      // 管理模式：返回完整元数据
      return {
        total: skills.length,
        mode: 'admin',
        skills: skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: (s.description || '').slice(0, 200),
          version: s.version,
          author: s.author,
          status: s.status,
          source: s.source,
          enabled: s.enabled,
          category: s.category,
          tags: s.tags,
          pathAlias: `@skill:${s.id}`,
          repoUrl: s.repoUrl,
          installedAt: s.installedAt,
        })),
      };
    }

    // 任务模式：返回简要列表 + 触发词
    const skillIndex = manager.getSkillIndex();
    return {
      total: skills.length,
      mode: 'task',
      skills: skills.map((s) => {
        const index = skillIndex.find((i) => i.id === s.id);
        return {
          id: s.id,
          name: s.name,
          description: (s.description || '').slice(0, 100),
          pathAlias: `@skill:${s.id}`,
          triggers: index?.triggers || [],
        };
      }),
      // ⚠️ 强调必须调用 skill__use 获取操作指南
      // 注意：nextStep 和 toolsReminder 会被 stripInternalFields 过滤，仅 warning 会保留
      nextStep:
        skills.length > 0
          ? '⚠️ 【必须】调用 skill__use 获取完整操作指南后，才能正确执行技能！'
          : '未找到匹配技能。请直接组合 shell/fs/web 等工具完成任务。',
      warning:
        skills.length > 0
          ? '⚠️ 重要：此列表仅含名称，不含使用方法。你必须调用 skill__use 获取操作指南后才能使用技能！'
          : undefined,
      toolsReminder:
        'Skill 是任务模板。必须先用 skill__use 读取指南，再用 shell__run、fs__*、web__* 等工具执行。',
    };
  }

  private async getSkill(args: Record<string, unknown>): Promise<unknown> {
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
      const store = useSkillStore.getState();
      const found = store.skills.find((s) => (s.name || '').toLowerCase() === name);
      if (found) {
        skill = await manager.getSkill(found.id);
      }
    }

    if (!skill) {
      return { error: 'Skill not found', id, name };
    }

    const pathAlias = `@skill:${skill.id}`;
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
      pathAlias,
      fileAccessGuide: {
        hint: '访问此 Skill 内部文件时，使用 skill__list_files 和 skill__read_file',
        listFiles: { tool: 'skill__list_files', example: { id: skill.id } },
        readFile: { tool: 'skill__read_file', example: { id: skill.id, path: 'README.md' } },
      },
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

    result.executionGuide =
      '阅读 content 中的指导，然后使用 shell__run、fs__*、web__* 等工具执行任务。';

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

  // ========================================
  // 更新
  // ========================================

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
  // 文件操作
  // ========================================

  private async listFiles(args: Record<string, unknown>): Promise<unknown> {
    const id = String(args.id || '').trim();
    const max = typeof args.max === 'number' ? args.max : 50;

    if (!id) {
      return { error: 'id is required' };
    }

    try {
      const files = await listSkillResources(id, max);
      return {
        skillId: id,
        files,
        count: files.length,
        note: '使用 skill__read_file 读取文件内容',
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async readFile(args: Record<string, unknown>): Promise<unknown> {
    const id = String(args.id || '').trim();
    const path = String(args.path || '').trim();
    const maxLines = typeof args.maxLines === 'number' ? args.maxLines : undefined;

    if (!id) {
      return { error: 'id is required' };
    }
    if (!path) {
      return { error: 'path is required' };
    }

    try {
      const content = await readSkillResource(id, path, maxLines);
      return {
        skillId: id,
        path,
        content,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async writeFile(args: Record<string, unknown>): Promise<unknown> {
    const id = String(args.id || '').trim();
    const path = String(args.path || '').trim();
    const content = String(args.content ?? '');

    if (!id) {
      return { error: 'id is required' };
    }
    if (!path) {
      return { error: 'path is required' };
    }

    try {
      const result = await writeSkillFile(id, path, content);
      return {
        success: true,
        skillId: id,
        path,
        message: result,
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

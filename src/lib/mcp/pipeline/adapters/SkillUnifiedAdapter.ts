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
      case 'guide':  // 推荐名称
      case 'use':    // 兼容旧名称
      case 'get':    // 兼容旧名称
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
      case 'list_resources':  // 新名称
      case 'list_files':      // 兼容旧名称
        return this.listResources(args || {});
      case 'get_template':    // 新名称
      case 'read_file':       // 兼容旧名称
        return this.getTemplate(args || {});
      
      // 编辑 skill 包资源（需用户明确指示）
      case 'edit_resource':   // 新名称（推荐）
      case 'write_file':      // 兼容旧名称
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
      // 注意：nextStep 和 toolsReminder 会被 stripInternalFields 过滤，仅 warning 会保留
      nextStep:
        skills.length > 0
          ? '调用 skill__guide 获取操作指南'
          : '未找到匹配技能。请直接组合 shell/fs/web 等工具完成任务。',
      warning:
        skills.length > 0
          ? '此列表仅含名称。调用 skill__guide 获取完整操作指南后再执行。'
          : undefined,
      toolsReminder:
        '调用 skill__guide 获取操作指南，指南包含所有所需信息，无需再读取其他文件。',
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

    // 执行指南：告诉 AI 如何按照 SKILL.md 完成任务
    result.howToUse = {
      step1: '阅读 content 中的操作指南',
      step2: '如需 skill 包内的模板/示例，用 skill__list_resources 查看，skill__get_template 读取',
      step3: '使用 shell__run、fs__write（配合 @WorkDir）等工具执行任务',
      important: '用户文件必须用 fs__write 写入 @WorkDir，不要写入 skill 包',
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

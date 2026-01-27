/**
 * Skills 文件操作（专用）
 *
 * 目标：
 * - Skill 资源读取/列举/修改与 MCP filesystem 解耦
 * - 只允许在 skill 目录内读写，禁止路径越界
 */

import { getSkillManager } from './SkillManager';

function assertSafeRelativePath(p: string): void {
  const path = String(p || '').trim();
  if (!path) throw new Error('resourcePath/filePath is required');
  // 禁止绝对路径/盘符
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\')) {
    throw new Error('Absolute path is not allowed for skill file operations');
  }
  // 简单的路径穿越防护
  const normalized = path.replace(/\\/g, '/');
  if (normalized.includes('../') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Path traversal is not allowed');
  }
  // 禁止奇怪的协议/前缀
  if (normalized.includes('://')) {
    throw new Error('Protocol path is not allowed');
  }
}

async function getSkillPath(skillId: string): Promise<string> {
  const manager = getSkillManager();
  await manager.initialize();
  const skill = await manager.getSkill(skillId);
  if (!skill?.path) {
    // 给出“可纠错”的强提示：skillId 必须来自 skills.list_available_skills
    let validIds: string[] = [];
    try {
      validIds = (manager.getSkillIndex?.() || []).map((s: any) => String(s.id)).filter(Boolean);
    } catch {
      validIds = [];
    }
    const hint = validIds.length > 0 ? `Valid skillId: ${validIds.join(', ')}` : 'Valid skillId: (unknown)';
    throw new Error(
      `Invalid skillId "${skillId}". skillId 必须来自 skills.list_available_skills 返回的 id；resourcePath 只是文件名（例如 "docx-js.md"）。 ${hint}`
    );
  }
  return skill.path;
}

export async function listSkillResources(skillId: string, max = 50): Promise<string[]> {
  const skillPath = await getSkillPath(skillId);
  const { readDir } = await import('@tauri-apps/plugin-fs');

  const entries = await readDir(skillPath);
  const files = (entries || [])
    .filter((e: any) => !e?.isDirectory && e?.name && e.name !== 'SKILL.md')
    .map((e: any) => String(e.name))
    .slice(0, Math.max(0, max));
  return files;
}

export async function readSkillResource(skillId: string, resourcePath: string, maxLines?: number): Promise<string> {
  assertSafeRelativePath(resourcePath);
  const skillPath = await getSkillPath(skillId);

  const { join } = await import('@tauri-apps/api/path');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');

  const fullPath = await join(skillPath, resourcePath);
  const content = await readTextFile(fullPath);

  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = content.split('\n');
    return lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? `\n... (${lines.length - maxLines} more lines)` : '');
  }

  return content;
}

export async function writeSkillFile(skillId: string, filePath: string, content: string): Promise<string> {
  assertSafeRelativePath(filePath);
  const skillPath = await getSkillPath(skillId);

  const { join } = await import('@tauri-apps/api/path');
  const { writeTextFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');

  const fullPath = await join(skillPath, filePath);
  const normalized = String(fullPath).replace(/\\/g, '/');
  const dirPath = normalized.substring(0, normalized.lastIndexOf('/'));
  if (dirPath && !(await exists(dirPath))) {
    await mkdir(dirPath, { recursive: true });
  }

  await writeTextFile(fullPath, String(content ?? ''));
  return `Skill file written: ${fullPath}`;
}


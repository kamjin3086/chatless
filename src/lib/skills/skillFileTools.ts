import type { SkillToolDefinition } from './skillTools';
import { listSkillResources, readSkillResource, writeSkillFile } from './skillFileOperations';

export const SKILLS_FS_SERVER_NAME = 'skills_fs';

export const skillFileTools: SkillToolDefinition[] = [
  {
    name: 'list_skill_resources',
    description: '列出指定技能包内的可用资源文件（不含 SKILL.md）。用于查找示例代码、模板等。',
    parameters: {
      skillId: { type: 'string', description: '技能 ID', required: true },
      max: { type: 'number', description: '最多返回多少个文件（可选，默认50）' },
    },
    handler: async (params) => {
      const skillId = typeof params.skillId === 'string' ? params.skillId : '';
      const max = typeof (params as any).max === 'number' ? (params as any).max : Number((params as any).max ?? 50);
      return listSkillResources(skillId, max);
    },
  },
  {
    name: 'read_skill_resource',
    description: '读取指定技能包内的资源文件内容（只允许相对 skill 目录的路径）。',
    parameters: {
      skillId: { type: 'string', description: '技能 ID', required: true },
      resourcePath: { type: 'string', description: '相对 skill 目录的资源路径，例如 docx-js.md', required: true },
      maxLines: { type: 'number', description: '最多读取行数（可选，用于大文件）' },
    },
    handler: async (params) => {
      const skillId = typeof params.skillId === 'string' ? params.skillId : '';
      const resourcePath = typeof (params as any).resourcePath === 'string' ? (params as any).resourcePath : String((params as any).resourcePath ?? '');
      const maxLines = typeof (params as any).maxLines === 'number' ? (params as any).maxLines : undefined;
      return readSkillResource(skillId, resourcePath, maxLines);
    },
  },
  {
    name: 'write_skill_file',
    description:
      '在技能目录内创建/修改文件（用于迭代改进 skill，例如修复脚本/补充文档）。只允许相对 skill 目录的路径。',
    parameters: {
      skillId: { type: 'string', description: '技能 ID', required: true },
      filePath: { type: 'string', description: '相对 skill 目录的文件路径，例如 scripts/build.ts', required: true },
      content: { type: 'string', description: '要写入的内容', required: true },
    },
    handler: async (params) => {
      const skillId = typeof params.skillId === 'string' ? params.skillId : '';
      const filePath = typeof (params as any).filePath === 'string' ? (params as any).filePath : String((params as any).filePath ?? '');
      const content = typeof (params as any).content === 'string' ? (params as any).content : String((params as any).content ?? '');
      return writeSkillFile(skillId, filePath, content);
    },
  },
];

export function isSkillFileTool(toolName: string): boolean {
  const t = String(toolName || '').toLowerCase();
  return skillFileTools.some((d) => d.name.toLowerCase() === t);
}

export async function executeSkillFileTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  const def = skillFileTools.find((d) => d.name === toolName) || skillFileTools.find((d) => d.name.toLowerCase() === toolName.toLowerCase());
  if (!def) throw new Error(`Unknown skills_fs tool: ${toolName}`);
  return def.handler(params || {});
}


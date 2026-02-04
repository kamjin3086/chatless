import type { SkillToolDefinition } from './skillTools';
import { listSkillResources, readSkillResource, writeSkillFile } from './skillFileOperations';

export const SKILLS_FS_SERVER_NAME = 'skills_fs';

export const skillFileTools: SkillToolDefinition[] = [
  {
    name: 'list_skill_resources',
    description:
      '【Skill 专属】列出指定技能包内的可用资源文件（不含 SKILL.md）。\n' +
      '**重要**：这是查看 Skill 目录文件的唯一方式，不要使用 fs__list_directory。\n' +
      '用于查找 skill 内的示例代码、模板、配置文件等。',
    parameters: {
      skillId: { type: 'string', description: '技能 ID（从 system__get_skill 返回的 id 字段获取）', required: true },
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
    description:
      '【Skill 专属】读取指定技能包内的资源文件内容。\n' +
      '**重要**：这是读取 Skill 内部文件的唯一方式，不要使用 fs__read_file。\n' +
      '只接受相对 skill 目录的路径，系统会自动解析到正确的绝对路径。',
    parameters: {
      skillId: { type: 'string', description: '技能 ID（从 system__get_skill 返回的 id 字段获取）', required: true },
      resourcePath: { type: 'string', description: '相对 skill 目录的资源路径，例如 docx-js.md、templates/example.txt', required: true },
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
      '【Skill 专属】在技能目录内创建/修改文件。\n' +
      '**重要**：这是写入 Skill 内部文件的唯一方式，不要使用 fs__write_file。\n' +
      '用于迭代改进 skill，例如修复脚本、补充文档。只接受相对 skill 目录的路径。',
    parameters: {
      skillId: { type: 'string', description: '技能 ID（从 system__get_skill 返回的 id 字段获取）', required: true },
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


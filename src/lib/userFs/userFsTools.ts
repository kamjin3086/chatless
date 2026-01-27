import type { SkillToolDefinition } from '@/lib/skills/skillTools';
import { listAuthorizedDirectories, readUserFile, writeUserFile } from './userFsOperations';

export const USER_FS_SERVER_NAME = 'user_fs';

export const userFsTools: SkillToolDefinition[] = [
  {
    name: 'list_authorized_directories',
    description: '列出用户已授权的目录（alias -> path）及其读写权限。',
    handler: async () => listAuthorizedDirectories(),
  },
  {
    name: 'read_user_file',
    description: '读取用户授权目录中的文件内容。路径必须使用 alias，例如 @ProjectDocs/readme.md。',
    parameters: {
      path: { type: 'string', description: '文件路径（必须使用 @Alias/...）', required: true },
      maxLines: { type: 'number', description: '最多读取的行数（可选）' },
    },
    handler: async (params) => {
      const p = typeof (params as any).path === 'string' ? (params as any).path : String((params as any).path ?? '');
      const maxLines = typeof (params as any).maxLines === 'number' ? (params as any).maxLines : undefined;
      return readUserFile(p, maxLines);
    },
  },
  {
    name: 'write_user_file',
    description: '写入用户授权目录中的文件（会覆盖）。路径必须使用 alias，例如 @ProjectDocs/output.txt。',
    parameters: {
      path: { type: 'string', description: '文件路径（必须使用 @Alias/...）', required: true },
      content: { type: 'string', description: '要写入的内容', required: true },
    },
    handler: async (params) => {
      const p = typeof (params as any).path === 'string' ? (params as any).path : String((params as any).path ?? '');
      const content = typeof (params as any).content === 'string' ? (params as any).content : String((params as any).content ?? '');
      return writeUserFile(p, content);
    },
  },
];

export function isUserFsTool(toolName: string): boolean {
  const t = String(toolName || '').toLowerCase();
  return userFsTools.some((d) => d.name.toLowerCase() === t);
}

export async function executeUserFsTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  const def =
    userFsTools.find((d) => d.name === toolName) ||
    userFsTools.find((d) => d.name.toLowerCase() === toolName.toLowerCase());
  if (!def) throw new Error(`Unknown user_fs tool: ${toolName}`);
  return def.handler(params || {});
}


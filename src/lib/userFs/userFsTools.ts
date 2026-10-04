import type { SkillToolDefinition } from '@/lib/skills/skillTools';
import { listAuthorizedDirectories, readUserFile, writeUserFile } from './userFsOperations';

export const USER_FS_SERVER_NAME = 'user_fs';

export const userFsTools: SkillToolDefinition[] = [
  {
    name: 'list_authorized_directories',
    description: 'List the directories the user authorized (alias -> path) with their read/write permissions.',
    handler: async () => listAuthorizedDirectories(),
  },
  {
    name: 'read_user_file',
    description: 'Read a file inside a user-authorized directory. The path must use an alias, for example @ProjectDocs/readme.md.',
    parameters: {
      path: { type: 'string', description: 'File path (must use @Alias/...)', required: true },
      maxLines: { type: 'number', description: 'Maximum lines to read (optional)' },
    },
    handler: async (params) => {
      const p = typeof (params as any).path === 'string' ? (params as any).path : String((params as any).path ?? '');
      const maxLines = typeof (params as any).maxLines === 'number' ? (params as any).maxLines : undefined;
      return readUserFile(p, maxLines);
    },
  },
  {
    name: 'write_user_file',
    description: 'Write a file inside a user-authorized directory (overwrites). The path must use an alias, for example @ProjectDocs/output.txt.',
    parameters: {
      path: { type: 'string', description: 'File path (must use @Alias/...)', required: true },
      content: { type: 'string', description: 'Content to write', required: true },
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


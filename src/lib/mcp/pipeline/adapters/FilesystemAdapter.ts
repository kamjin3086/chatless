import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import {
  readFile,
  writeFile,
  editFile,
  searchFiles,
  listDirectory,
  createDirectory,
  deleteFile,
  deleteMany,
  deleteByPattern,
  renameFile,
} from '@/lib/tauri/filesystemCommands';

/**
 * 内置 filesystem adapter（调用 Rust 后端 commands）
 *
 * 目标：
 * - 让 filesystem 的真实文件操作不受 Tauri plugin-fs 的 fs:scope/capabilities 限制
 * - 后端会执行 allowlist 校验；前端 gate 负责审批 UX 与同步 allowlist
 *
 * 使用 @/lib/tauri/filesystemCommands 封装层：
 * - 自动处理 payload 包裹
 * - 自动处理 camelCase ↔ snake_case 转换
 */
export class FilesystemAdapter implements ToolAdapter {
  readonly server = 'fs';

  canHandle(invocation: ToolInvocation): boolean {
    const srv = String(invocation.server || '').toLowerCase();
    return srv === 'fs' || srv === 'filesystem';
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').toLowerCase();
    const args = invocation.args || {};

    const path = typeof (args as Record<string, unknown>).path === 'string'
      ? String((args as Record<string, unknown>).path)
      : '';
    const dir = typeof (args as Record<string, unknown>).dir === 'string'
      ? String((args as Record<string, unknown>).dir)
      : '';
    const paths = Array.isArray((args as Record<string, unknown>).paths)
      ? ((args as Record<string, unknown>).paths as unknown[]).map((p) => String(p ?? '').trim()).filter(Boolean)
      : null;

    try {
      if (tool === 'read_file' || tool === 'read') {
        if (!path) return { ok: false, error: 'path is required' };
        const maxLines = typeof (args as Record<string, unknown>).maxLines === 'number'
          ? (args as Record<string, unknown>).maxLines as number
          : undefined;
        const startLine = typeof (args as Record<string, unknown>).startLine === 'number'
          ? (args as Record<string, unknown>).startLine as number
          : undefined;
        const endLine = typeof (args as Record<string, unknown>).endLine === 'number'
          ? (args as Record<string, unknown>).endLine as number
          : undefined;
        return await readFile({ path, maxLines, startLine, endLine });
      }

      if (tool === 'write_file' || tool === 'write') {
        if (!path) return { ok: false, error: 'path is required' };
        const content = typeof (args as Record<string, unknown>).content === 'string'
          ? String((args as Record<string, unknown>).content)
          : '';
        return await writeFile({ path, content });
      }

      if (tool === 'edit' || tool === 'edit_file') {
        if (!path) return { ok: false, error: 'path is required' };
        const find = typeof (args as Record<string, unknown>).find === 'string'
          ? String((args as Record<string, unknown>).find)
          : '';
        if (!find) return { ok: false, error: 'find is required' };
        // An omitted `replace` used to be coerced to "" and silently deleted the
        // matched text. Deleting content must be an explicit empty string.
        if (typeof (args as Record<string, unknown>).replace !== 'string') {
          return {
            ok: false,
            error: {
              code: 'INVALID_ARGUMENTS',
              message: 'replace is required (pass "" to delete the matched text)',
              hints: ['必须同时给出 find 与 replace；删除内容时显式传 replace=""'],
            },
          };
        }
        const replace = String((args as Record<string, unknown>).replace);
        const all = (args as Record<string, unknown>).all === true;
        const expectedHash = typeof (args as Record<string, unknown>).expectedHash === 'string'
          ? String((args as Record<string, unknown>).expectedHash)
          : undefined;
        const result = await editFile({ path, find, replace, all, expectedHash });
        if (!result.ok) {
          const stale = result.reason === 'FILE_CHANGED';
          return {
            ok: false,
            error: {
              code: result.reason || 'EDIT_FAILED',
              message: stale
                ? '文件在读取后已被修改，编辑未执行。请重新读取该文件再编辑。'
                : result.reason === 'EDIT_MATCH_NOT_UNIQUE'
                  ? '原文匹配到多处，请给出更长的唯一片段，或用 all=true 全部替换'
                  : '原文未找到，请按候选行核对缩进与空白后重试',
              candidates: result.candidates,
            },
          };
        }
        return result;
      }

      if (tool === 'search' || tool === 'search_files') {
        const root = typeof (args as Record<string, unknown>).root === 'string'
          ? String((args as Record<string, unknown>).root)
          : path;
        if (!root) return { ok: false, error: 'root is required' };
        const query = typeof (args as Record<string, unknown>).query === 'string'
          ? String((args as Record<string, unknown>).query)
          : '';
        if (!query) return { ok: false, error: 'query is required' };
        const glob = typeof (args as Record<string, unknown>).glob === 'string'
          ? String((args as Record<string, unknown>).glob)
          : undefined;
        const limit = typeof (args as Record<string, unknown>).limit === 'number'
          ? Number((args as Record<string, unknown>).limit)
          : undefined;
        const regex = (args as Record<string, unknown>).regex === true;
        const modeRaw = String((args as Record<string, unknown>).mode ?? 'both').toLowerCase();
        if (!['content', 'filename', 'both'].includes(modeRaw)) {
          return {
            ok: false,
            error: {
              code: 'INVALID_ARGUMENTS',
              message: `mode 只能是 content / filename / both，收到: ${modeRaw}`,
            },
          };
        }
        const mode = modeRaw as 'content' | 'filename' | 'both';
        return await searchFiles({ root, query, glob, limit, regex, mode });
      }

      if (tool === 'list_directory' || tool === 'list' || tool === 'dir' || tool === 'ls') {
        if (!path) return { ok: false, error: 'path is required' };
        const limit = typeof (args as Record<string, unknown>).limit === 'number'
          ? Number((args as Record<string, unknown>).limit)
          : undefined;
        const pattern = typeof (args as Record<string, unknown>).pattern === 'string'
          ? String((args as Record<string, unknown>).pattern)
          : undefined;
        const kind = typeof (args as Record<string, unknown>).kind === 'string'
          ? String((args as Record<string, unknown>).kind)
          : undefined;
        return await listDirectory({ path, limit, pattern, kind });
      }

      if (tool === 'create_directory' || tool === 'mkdir' || tool === 'create') {
        if (!path) return { ok: false, error: 'path is required' };
        const recursive = (args as Record<string, unknown>).recursive !== undefined
          ? !!(args as Record<string, unknown>).recursive
          : true;
        return await createDirectory({ path, recursive });
      }

      if (tool === 'delete_file' || tool === 'delete' || tool === 'rm') {
        const pattern = typeof (args as Record<string, unknown>).pattern === 'string'
          ? String((args as Record<string, unknown>).pattern)
          : '';
        const limit = typeof (args as Record<string, unknown>).limit === 'number'
          ? Number((args as Record<string, unknown>).limit)
          : undefined;
        const kind = typeof (args as Record<string, unknown>).kind === 'string'
          ? String((args as Record<string, unknown>).kind)
          : undefined;
        const dryRun = (args as Record<string, unknown>).dryRun !== undefined
          ? !!(args as Record<string, unknown>).dryRun
          : undefined;

        if (paths && paths.length > 0) {
          return await deleteMany({ paths });
        }
        if (dir.trim() && pattern.trim()) {
          return await deleteByPattern({ dir, pattern, limit, kind, dryRun });
        }
        if (!path) return { ok: false, error: 'path / paths / (dir+pattern) is required' };
        return await deleteFile({ path });
      }

      if (tool === 'rename_file' || tool === 'rename' || tool === 'move_file' || tool === 'move' || tool === 'mv') {
        const oldPath = typeof (args as Record<string, unknown>).oldPath === 'string'
          ? String((args as Record<string, unknown>).oldPath)
          : '';
        const newPath = typeof (args as Record<string, unknown>).newPath === 'string'
          ? String((args as Record<string, unknown>).newPath)
          : '';
        if (!oldPath || !newPath) {
          return { ok: false, error: 'oldPath and newPath are required' };
        }
        return await renameFile({ oldPath, newPath });
      }

      // 未支持的工具：返回可读错误，让 follow-up 纠错
      return { ok: false, error: `Unsupported filesystem tool: ${invocation.tool}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}

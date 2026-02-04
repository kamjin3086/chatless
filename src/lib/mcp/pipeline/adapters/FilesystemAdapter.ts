import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import {
  readFile,
  writeFile,
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

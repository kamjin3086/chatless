import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

/**
 * 内置 filesystem adapter（调用 Rust 后端 commands）
 *
 * 目标：
 * - 让 filesystem 的真实文件操作不受 Tauri plugin-fs 的 fs:scope/capabilities 限制
 * - 后端会执行 allowlist 校验；前端 gate 负责审批 UX 与同步 allowlist
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

    const path = typeof (args as any).path === 'string' ? String((args as any).path) : '';
    const dir = typeof (args as any).dir === 'string' ? String((args as any).dir) : '';
    const paths = Array.isArray((args as any).paths) ? (args as any).paths.map((p: any) => String(p || '').trim()).filter(Boolean) : null;

    try {
      // 动态导入：避免非客户端环境报错
      const { invoke } = await import('@tauri-apps/api/core');

      if (tool === 'read_file' || tool === 'read') {
        if (!path) return { ok: false, error: 'path is required' };
        const maxLines = typeof (args as any).maxLines === 'number' ? (args as any).maxLines : undefined;
        const startLine = typeof (args as any).startLine === 'number' ? (args as any).startLine : undefined;
        const endLine = typeof (args as any).endLine === 'number' ? (args as any).endLine : undefined;
        return await invoke('filesystem_read_file', { path, maxLines, startLine, endLine });
      }

      if (tool === 'write_file' || tool === 'write') {
        if (!path) return { ok: false, error: 'path is required' };
        const content = typeof (args as any).content === 'string' ? String((args as any).content) : '';
        return await invoke('filesystem_write_file', { path, content });
      }

      if (tool === 'list_directory' || tool === 'list' || tool === 'dir' || tool === 'ls') {
        if (!path) return { ok: false, error: 'path is required' };
        const limit = typeof (args as any).limit === 'number' ? Number((args as any).limit) : undefined;
        const pattern = typeof (args as any).pattern === 'string' ? String((args as any).pattern) : undefined;
        const kind = typeof (args as any).kind === 'string' ? String((args as any).kind) : undefined;
        return await invoke('filesystem_list_directory', { path, limit, pattern, kind });
      }

      if (tool === 'create_directory' || tool === 'mkdir' || tool === 'create') {
        if (!path) return { ok: false, error: 'path is required' };
        const recursive = (args as any).recursive !== undefined ? !!(args as any).recursive : true;
        return await invoke('filesystem_create_directory', { path, recursive });
      }

      if (tool === 'delete_file' || tool === 'delete' || tool === 'rm') {
        const pattern = typeof (args as any).pattern === 'string' ? String((args as any).pattern) : '';
        const limit = typeof (args as any).limit === 'number' ? Number((args as any).limit) : undefined;
        const kind = typeof (args as any).kind === 'string' ? String((args as any).kind) : undefined;
        const dryRun = (args as any).dryRun !== undefined ? !!(args as any).dryRun : undefined;

        if (paths && paths.length > 0) {
          return await invoke('filesystem_delete_many', { payload: { paths } });
        }
        if (dir.trim() && pattern.trim()) {
          return await invoke('filesystem_delete_by_pattern', { payload: { dir, pattern, limit, kind, dryRun } });
        }
        if (!path) return { ok: false, error: 'path / paths / (dir+pattern) is required' };
        return await invoke('filesystem_delete_file', { path });
      }

      if (tool === 'rename_file' || tool === 'rename' || tool === 'move_file' || tool === 'move' || tool === 'mv') {
        const oldPath = typeof (args as any).oldPath === 'string' ? String((args as any).oldPath) : '';
        const newPath = typeof (args as any).newPath === 'string' ? String((args as any).newPath) : '';
        if (!oldPath || !newPath) {
          return { ok: false, error: 'oldPath and newPath are required' };
        }
        return await invoke('filesystem_rename_file', { oldPath, newPath });
      }

      // 未支持的工具：返回可读错误，让 follow-up 纠错
      return { ok: false, error: `Unsupported filesystem tool: ${invocation.tool}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}


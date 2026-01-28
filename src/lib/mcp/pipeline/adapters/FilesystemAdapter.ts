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
  readonly server = 'filesystem';

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === 'filesystem';
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').toLowerCase();
    const args = invocation.args || {};

    const path = typeof (args as any).path === 'string' ? String((args as any).path) : '';
    if (!path) {
      return { ok: false, error: 'path is required' };
    }

    try {
      // 动态导入：避免非客户端环境报错
      const { invoke } = await import('@tauri-apps/api/core');

      if (tool === 'read_file' || tool === 'read') {
        const maxLines = typeof (args as any).maxLines === 'number' ? (args as any).maxLines : undefined;
        return await invoke('filesystem_read_file', { path, maxLines });
      }

      if (tool === 'write_file' || tool === 'write') {
        const content = typeof (args as any).content === 'string' ? String((args as any).content) : '';
        return await invoke('filesystem_write_file', { path, content });
      }

      if (tool === 'list_directory' || tool === 'list' || tool === 'dir') {
        return await invoke('filesystem_list_directory', { path });
      }

      if (tool === 'create_directory' || tool === 'mkdir' || tool === 'create') {
        const recursive = (args as any).recursive !== undefined ? !!(args as any).recursive : true;
        return await invoke('filesystem_create_directory', { path, recursive });
      }

      if (tool === 'delete_file' || tool === 'delete') {
        return await invoke('filesystem_delete_file', { path });
      }

      // 未支持的工具：返回可读错误，让 follow-up 纠错
      return { ok: false, error: `Unsupported filesystem tool: ${invocation.tool}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}


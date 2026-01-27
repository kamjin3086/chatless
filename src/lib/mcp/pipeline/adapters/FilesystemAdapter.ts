import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

/**
 * 内置 filesystem adapter（不依赖外部 MCP 进程）
 *
 * 解决问题：
 * - 外部 stdio（npx）在用户环境中可能不存在，导致 `program not found`
 * - 内置执行可保证读写/列目录/创建目录/删除稳定可用
 *
 * 注意：
 * - “白名单/审批”由 ToolExecutionPipeline 的 filesystem gate 负责
 * - 这里仅执行真实文件操作
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

    // 动态导入：避免非客户端环境报错
    const { readTextFile, writeTextFile, readDir, mkdir, remove, exists } = await import('@tauri-apps/plugin-fs');

    const normalize = (p: string) => String(p || '').trim().replace(/\\/g, '/');

    const dirname = (p: string): string => {
      const s = normalize(p);
      const i = s.lastIndexOf('/');
      if (i <= 0) return s;
      return s.slice(0, i);
    };

    const ensureParentDir = async (filePath: string) => {
      const parent = dirname(filePath);
      if (!parent) return;
      if (!(await exists(parent))) {
        await mkdir(parent, { recursive: true });
      }
    };

    try {
      if (tool === 'read_file' || tool === 'read') {
        const content = await readTextFile(path);
        const maxLines = typeof (args as any).maxLines === 'number' ? (args as any).maxLines : undefined;
        if (typeof maxLines === 'number' && maxLines > 0) {
          const lines = String(content).split('\n');
          return lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? `\n... (${lines.length - maxLines} more lines)` : '');
        }
        return content;
      }

      if (tool === 'write_file' || tool === 'write') {
        const content = typeof (args as any).content === 'string' ? String((args as any).content) : '';
        await ensureParentDir(path);
        await writeTextFile(path, content);
        return { ok: true, message: 'File written successfully', path };
      }

      if (tool === 'list_directory' || tool === 'list' || tool === 'dir') {
        const entries = await readDir(path);
        // 统一输出更稳定的结构，避免 UI 端依赖 Tauri 的内部字段
        return (entries || []).map((e: any) => ({
          name: e?.name ?? '',
          path: e?.path ?? '',
          isDirectory: !!e?.isDirectory,
          isFile: !!e?.isFile,
        }));
      }

      if (tool === 'create_directory' || tool === 'mkdir' || tool === 'create') {
        const recursive = (args as any).recursive !== undefined ? !!(args as any).recursive : true;
        await mkdir(path, { recursive });
        return { ok: true, message: 'Directory created successfully', path, recursive };
      }

      if (tool === 'delete_file' || tool === 'delete') {
        await remove(path, { recursive: false });
        return { ok: true, message: 'File deleted successfully', path };
      }

      // 未支持的工具：返回可读错误，让 follow-up 纠错
      return { ok: false, error: `Unsupported filesystem tool: ${invocation.tool}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }
}


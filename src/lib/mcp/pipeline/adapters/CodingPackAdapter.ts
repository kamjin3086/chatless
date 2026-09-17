import { CODING_PACK_SERVER_NAME } from '@/lib/mcp/nativeTools/codingPack';
import { isCodingPackEnabled } from '@/lib/codingPack/config';
import { previewPatch, searchGlob, searchGrep } from '@/lib/codingPack/search';
import { resolveAllowlistPath } from '@/lib/filesystemAllowlist/allowlist';
import { syncFilesystemAllowlistToBackend } from '@/lib/filesystemAllowlist/backendSync';
import { getProcessSandbox } from '@/lib/skills/sandbox';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

async function resolveCodingRoot(conversationId: string, raw: string): Promise<string> {
  const trimmed = String(raw || '').trim();
  const allowlist = useFilesystemAllowlistStore.getState();
  await allowlist.load();
  const dirsForResolve = [...allowlist.directories];
  let workingDir: string | undefined;
  if (conversationId) {
    const wd = useConversationAttachmentStore.getState().getWorkingDir(conversationId);
    if (wd) {
      workingDir = String(wd).replace(/\\/g, '/');
      dirsForResolve.unshift({
        id: `session:${conversationId}:workdir`,
        path: workingDir,
        alias: 'WorkDir',
        permissions: { read: true, write: true, create: true, delete: false },
        source: 'workdir',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as any);
    }
  }
  if (!trimmed) return workingDir || '';
  try {
    await syncFilesystemAllowlistToBackend(dirsForResolve as any);
  } catch {
    // best-effort
  }
  return resolveAllowlistPath({
    inputPath: trimmed,
    directories: dirsForResolve as any,
    workingDir,
  }).absolutePath;
}

export class CodingPackAdapter implements ToolAdapter {
  readonly server = CODING_PACK_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === CODING_PACK_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    if (!(await isCodingPackEnabled())) {
      return { ok: false, error: 'CODING_PACK_DISABLED', message: 'Coding Pack 未启用（Labs 中可开启）' };
    }

    const tool = String(invocation.tool || '').toLowerCase();
    const args = invocation.args || {};
    const conversationId = invocation.conversationId;

    const root = await resolveCodingRoot(
      conversationId || '',
      String((args as any).root || (args as any).workingDir || '').trim(),
    );

    if (tool === 'glob') {
      if (!root) return { ok: false, error: 'root is required' };
      const matches = await searchGlob({
        root,
        pattern: String((args as any).pattern || '**/*'),
        limit: Number((args as any).limit) || 200,
      });
      return { ok: true, matches, truncated: matches.length >= (Number((args as any).limit) || 200) };
    }

    if (tool === 'grep') {
      if (!root) return { ok: false, error: 'root is required' };
      const matches = await searchGrep({
        root,
        query: String((args as any).query || ''),
        glob: (args as any).glob ? String((args as any).glob) : undefined,
        limit: Number((args as any).limit) || 100,
      });
      return { ok: true, matches };
    }

    if (tool === 'apply_patch') {
      return previewPatch({
        path: String((args as any).path || ''),
        patch: String((args as any).patch || ''),
        mode: (args as any).mode,
      });
    }

    if (tool === 'git') {
      const sub = String((args as any).subcommand || 'status');
      const extra = String((args as any).args || '').trim();
      if (/force|reset\s+--hard|clean\s+-fd/i.test(extra)) {
        return { ok: false, error: 'destructive git args blocked' };
      }
      const wd = root || String((args as any).workingDir || '');
      const sandbox = getProcessSandbox();
      const extraArgs = extra ? extra.split(/\s+/).filter(Boolean) : [];
      return await sandbox.execute({
        command: 'git',
        args: [sub, ...extraArgs],
        workingDir: wd || undefined,
      });
    }

    if (tool === 'diagnostics') {
      const command = String((args as any).command || '').trim();
      const wd = root || String((args as any).workingDir || '');
      const parts = command.split(/\s+/).filter(Boolean);
      const sandbox = getProcessSandbox();
      return await sandbox.execute({
        command: parts[0] || 'echo',
        args: parts.slice(1),
        workingDir: wd || undefined,
        timeoutMs: Number((args as any).timeout) || 120_000,
      });
    }

    return { ok: false, error: `unknown tool: ${tool}` };
  }
}

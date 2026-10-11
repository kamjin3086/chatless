import { describe, expect, it } from 'vitest';
import { isFilesystemServer, isShellServer, normalizeServerName } from '@/lib/mcp/toolNaming';
import type { AllowlistDirectory } from '@/lib/filesystemAllowlist';
import { decideFilesystemCall, decideServerCall, planFilesystemPromotion, planShellPromotion } from '../policy';

const dir = (permissions: Partial<AllowlistDirectory['permissions']>): AllowlistDirectory => ({
  id: 'd', path: 'C:/work/proj', permissions: { read: false, write: false, create: false, delete: false, ...permissions },
  source: 'manual', createdAt: 0, updatedAt: 0,
});

describe('decideFilesystemCall', () => {
  it('asks when the allowlist does not already cover the operation', () => {
    expect(decideFilesystemCall({ op: 'write', primaryPath: 'C:/work/proj/a.txt', directory: dir({ read: true }), unrestricted: false }).kind).toBe('ask');
    expect(decideFilesystemCall({ op: 'write', primaryPath: 'C:/work/proj/a.txt', directory: dir({ write: true }), unrestricted: false }).kind).toBe('allow');
    expect(decideFilesystemCall({ op: 'write', primaryPath: 'C:/other/a.txt', directory: undefined, unrestricted: false }).kind).toBe('ask');
  });

  it('asks for a delete even in a directory that allows everything else', () => {
    const full = dir({ read: true, write: true, create: true });
    const d = decideFilesystemCall({ op: 'delete', primaryPath: 'C:/work/proj/a.txt', directory: full, unrestricted: false });

    expect(d.kind).toBe('ask');
    expect(d.kind === 'ask' && d.needsCallGrant).toBe(true);
    expect(d.kind === 'ask' && d.approvableDirectory).toBe('C:/work/proj');
  });

  it('never asks once the conversation is unrestricted, but still reports the grant it needs', () => {
    const d = decideFilesystemCall({ op: 'write', primaryPath: 'C:/other/a.txt', directory: undefined, unrestricted: true });

    expect(d.kind).toBe('allow');
    expect(d.needsCallGrant).toBe(true);
  });

  it('offers no rememberable directory when there is no path at all', () => {
    const d = decideFilesystemCall({ op: 'read', primaryPath: '', directory: undefined, unrestricted: false });

    expect(d.kind).toBe('allow');
  });

  it('falls back to the parent of the target as the approvable directory', () => {
    const d = decideFilesystemCall({ op: 'write', primaryPath: 'C:/outside/dir/f.txt', directory: undefined, unrestricted: false });

    expect(d.kind === 'ask' && d.approvableDirectory).toBe('C:/outside/dir');
  });
});

describe('promotion grid: three answers, two scopes, nine cells, no default', () => {
  it('fs: once changes nothing, always remembers, unrestricted is per-conversation', () => {
    expect(planFilesystemPromotion({ answer: 'once', approvableDirectory: 'C:/w', isDelete: false }))
      .toEqual({ rememberDirectory: undefined, conversationUnrestricted: false, globalUnrestricted: false });
    expect(planFilesystemPromotion({ answer: 'always', approvableDirectory: 'C:/w', isDelete: false }))
      .toEqual({ rememberDirectory: 'C:/w', conversationUnrestricted: false, globalUnrestricted: false });
    expect(planFilesystemPromotion({ answer: 'unrestricted', approvableDirectory: 'C:/w', isDelete: false }))
      .toEqual({ rememberDirectory: undefined, conversationUnrestricted: true, globalUnrestricted: false });
  });

  it('fs: always never remembers a delete, and never toggles the global switch', () => {
    expect(planFilesystemPromotion({ answer: 'always', approvableDirectory: 'C:/w', isDelete: true }).rememberDirectory)
      .toBeUndefined();
    expect(planFilesystemPromotion({ answer: 'always', approvableDirectory: undefined, isDelete: false }).rememberDirectory)
      .toBeUndefined();
    for (const answer of ['once', 'always', 'unrestricted'] as const) {
      expect(planFilesystemPromotion({ answer, approvableDirectory: 'C:/w', isDelete: false }).globalUnrestricted)
        .toBe(false);
    }
  });

  it('shell: always is the global switch, unrestricted the conversation one - never both', () => {
    expect(planShellPromotion({ answer: 'once' }))
      .toEqual({ rememberDirectory: undefined, conversationUnrestricted: false, globalUnrestricted: false });
    expect(planShellPromotion({ answer: 'always' }))
      .toEqual({ rememberDirectory: undefined, conversationUnrestricted: false, globalUnrestricted: true });
    expect(planShellPromotion({ answer: 'unrestricted' }))
      .toEqual({ rememberDirectory: undefined, conversationUnrestricted: true, globalUnrestricted: false });
  });

  it('the same answer word means a different thing per scope', () => {
    const fsAlways = planFilesystemPromotion({ answer: 'always', approvableDirectory: 'C:/w', isDelete: false });
    const shellAlways = planShellPromotion({ answer: 'always' });

    expect(fsAlways.rememberDirectory).toBe('C:/w');
    expect(fsAlways.globalUnrestricted).toBe(false);
    expect(shellAlways.globalUnrestricted).toBe(true);
    expect(shellAlways.rememberDirectory).toBeUndefined();
  });
});

/** 抽取前的原实现，当 oracle 穷举比对用。 */
function oldNeedsAuthorization(server: string, tool: string, autoAuth: boolean): boolean {
  const srv = normalizeServerName(server);
  const tl = String(tool || '').toLowerCase();
  if (isShellServer(srv)) {
    if (/^(logs|list|stop)$/.test(tl)) return false;
    return !autoAuth;
  }
  if (srv === 'user_fs') return tl === 'write_user_file' && !autoAuth;
  if (srv === 'skills_fs') return !/^(read_skill_resource|list_skill_resources|list_files)$/.test(tl);
  if (srv === 'skills' || srv === 'skill') return !/^(list|guide|read_file|list_files|check_deps|use)$/.test(tl);
  if (srv === 'tools') return false;
  if (srv === 'system') return !/^(list_prompts|get_prompt|list_skills)$/.test(tl);
  if (isFilesystemServer(srv)) return false;
  return !autoAuth;
}

describe('decideServerCall reproduces needsAuthorization', () => {
  const SERVERS = ['shell', 'shell_executor', 'fs', 'filesystem', 'user_fs', 'skills', 'skill',
    'skills_fs', 'tools', 'system', 'web_search', 'some_mcp_server', ''];
  const TOOLS = ['run', 'logs', 'list', 'stop', 'write_user_file', 'read_user_file', 'list',
    'read_skill_resource', 'list_skill_resources', 'list_files', 'guide', 'use', 'check_deps',
    'read_file', 'search', 'write_file', 'list_prompts', 'get_prompt', 'list_skills', 'read', ''];

  it('agrees on every server x tool x autoAuthorize combination', () => {
    for (const server of SERVERS) {
      for (const tool of TOOLS) {
        for (const autoAuthorize of [false, true]) {
          const expected = oldNeedsAuthorization(server, tool, autoAuthorize) ? 'ask' : 'allow';
          expect(decideServerCall({ server, tool, autoAuthorize }), `${server}/${tool}/${autoAuthorize}`)
            .toBe(expected);
        }
      }
    }
  });
});

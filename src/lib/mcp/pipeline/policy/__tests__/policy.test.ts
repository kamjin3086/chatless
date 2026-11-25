import { describe, expect, it } from 'vitest';
import { isFilesystemServer, isShellServer, normalizeServerName } from '@/lib/mcp/toolNaming';
import type { AllowlistDirectory } from '@/lib/filesystemAllowlist';
import { decideFilesystemCall, decideServerCall, planFilesystemPromotion, planShellPromotion } from '../policy';
import { toolRisk } from '../toolRisk';

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

describe('promotion grid: three answers, two scopes, six cells, no default', () => {
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
  // The built-in skill server is not in this list on purpose - `skill`, `SKILL` and the
  // rest normalize to one name: its approval answer no longer comes from a name list of
  // its own but from the risk table, which the block at the end of this file pins.
  // The external `skills` server keeps the old rule - its tool names are the package's.
  const SERVERS = ['shell', 'shell_executor', 'SHELL', 'Shell_Executor', 'fs', 'filesystem', 'FileSystem',
    'user_fs', 'User_FS', 'USER_FS', 'skills', 'Skills',
    'skills_fs', 'Skills_FS', 'tools', 'Tools', 'TOOLS', 'system', 'System', 'SYSTEM',
    'web_search', 'web', 'some_mcp_server', ' Some_MCP ', ''];
  const TOOLS = ['run', 'logs', 'list', 'stop', 'write_user_file', 'WRITE_USER_FILE', 'Read_User_File', 'list',
    'read_skill_resource', 'Read_Skill_Resource', 'list_skill_resources', 'list_files', 'guide', 'use',
    'check_deps', 'read_file', 'search', 'write_file', 'list_prompts', 'LIST_PROMPTS', 'get_prompt',
    'list_skills', 'read', ' Search ', ''];

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

describe('the built-in skill row asks the risk table, not a second name list (#242)', () => {
  const READS = ['list', 'guide', 'list_resources', 'get_template', 'check_deps'];
  const MANAGEMENT = ['edit_resource', 'create', 'update', 'delete', 'import', 'export',
    'export_all', 'set_enabled', 'set_tool_call_preference', 'reload'];

  for (const tool of READS) {
    it(`reads are approval-free: skill__${tool}`, () => {
      expect(decideServerCall({ server: 'skill', tool, autoAuthorize: false })).toBe('allow');
    });
  }

  for (const tool of MANAGEMENT) {
    it(`management writes still ask: skill__${tool}`, () => {
      expect(decideServerCall({ server: 'skill', tool, autoAuthorize: false })).toBe('ask');
    });
  }

  for (const tool of ['use', 'get', 'read_file', 'list_files', 'list_available_skills',
    'get_skill_instructions', 'list_skill_actions', 'anything_new']) {
    it(`a name the server does not have is not treated as a read: skill__${tool}`, () => {
      expect(decideServerCall({ server: 'skill', tool, autoAuthorize: false })).toBe('ask');
      expect(toolRisk('skill', tool)).toBe('unknown');
    });
  }

  it('leaves the external skills server on its own list', () => {
    // `skills` (plural) is an MCP server whose names belong to the package: a retired
    // built-in name is a live read there.
    expect(decideServerCall({ server: 'skills', tool: 'use', autoAuthorize: false })).toBe('allow');
    expect(decideServerCall({ server: 'skills', tool: 'list_files', autoAuthorize: false })).toBe('allow');
    expect(decideServerCall({ server: 'skills', tool: 'install', autoAuthorize: false })).toBe('ask');
  });
});


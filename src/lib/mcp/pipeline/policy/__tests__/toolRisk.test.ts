import { describe, expect, it } from 'vitest';
import { normalizeServerName } from '@/lib/mcp/toolNaming';
import { SKILL_UNIFIED_TOOLS } from '@/lib/mcp/nativeTools/skillUnifiedTools';
import { filesystemOp, isPlanOnlyAllowed, isReplayableRead, toolRisk } from '../toolRisk';

/**
 * 这三段是抽取前 ToolExecutionPipeline 里的原样实现，在这里当 oracle 用。
 * 穷举比对新旧结果，证明换表这一步没有改变任何判定。
 */
const OLD_FS_READ_ONLY = /^(read|read_file|list|list_directory|ls|dir|stat|exists|search)$/;

function oldIsPlanOnlyAllowed(server: string, tool: string): boolean {
  const srv = normalizeServerName(server).toLowerCase();
  const tl = String(tool || '').toLowerCase();
  if (srv === 'fs') return OLD_FS_READ_ONLY.test(tl);
  if (srv === 'knowledge') return /^(list|search|read)$/.test(tl);
  if (srv === 'tool_result') return tl === 'read';
  if (srv === 'web_search' || srv === 'web') return /^(search|fetch)$/.test(tl);
  if (srv === 'tools') return tl === 'search';
  if (srv === 'skill') return /^(list|guide|use|read_file|list_files|check_deps)$/.test(tl);
  if (srv === 'system') return /^(list_prompts|get_prompt)$/.test(tl);
  return false;
}

function oldIsReadOnlyRetry(srvForRetry: string, toolForRetry: string): boolean {
  return (
    (srvForRetry === 'fs' && OLD_FS_READ_ONLY.test(toolForRetry)) ||
    (srvForRetry === 'knowledge' && /^(list|search|read)$/.test(toolForRetry)) ||
    (srvForRetry === 'web_search' && /^(search|fetch)$/.test(toolForRetry)) ||
    (srvForRetry === 'tools' && toolForRetry === 'search')
  );
}

function oldGetFilesystemOp(tool: string): 'read' | 'write' | 'create' | 'delete' {
  const tl = String(tool || '').toLowerCase();
  if (tl === 'delete_file' || tl === 'delete' || tl === 'rm') return 'delete';
  if (tl === 'read_file' || tl === 'read' || tl === 'list_directory' || tl === 'list' || tl === 'dir' || tl === 'ls') return 'read';
  if (tl === 'rename_file' || tl === 'rename' || tl === 'move_file' || tl === 'move' || tl === 'mv') return 'write';
  if (tl === 'write_file' || tl === 'write') return 'write';
  if (tl === 'edit' || tl === 'edit_file') return 'write';
  if (tl === 'search' || tl === 'search_files') return 'read';
  if (tl === 'mkdir' || tl === 'create_directory' || tl === 'create') return 'create';
  return 'read';
}

const SERVERS = [
  'fs', 'filesystem', 'file-system', 'FS', ' filesystem ',
  'knowledge', 'web_search', 'web', 'tools', 'tool_result', 'skill', 'skills', 'skills_fs',
  'system', 'shell', 'shell_executor', 'user_fs', 'ctx', 'some_mcp_server', '',
];

const TOOLS = [
  // fs
  'read', 'read_file', 'list', 'list_directory', 'list_files', 'ls', 'dir', 'stat', 'exists',
  'search', 'search_files', 'write', 'write_file', 'edit', 'edit_file', 'rename', 'rename_file',
  'move', 'move_file', 'mv', 'mkdir', 'create', 'create_directory', 'delete', 'delete_file', 'rm',
  // others
  'use', 'guide', 'check_deps', 'read_skill_resource', 'list_skill_resources',
  'fetch', 'search_query', 'list_prompts', 'get_prompt', 'list_skills',
  'write_user_file', 'logs', 'stop', '', 'unknown_tool', 'READ_FILE', ' Search ',
];

/**
 * The oracle loop above proves the table matches the cascades it replaced. Three
 * `skill` names no longer match, and deliberately so: `use`, `read_file` and
 * `list_files` were compatibility aliases in `SkillUnifiedAdapter.execute`, and an
 * adapter branch that nothing routes must not stay plan-allowed once it is gone.
 * The loop skips exactly these three; the narrowing test below owns them.
 */
const NARROWED_SKILL_ALIASES = ['use', 'read_file', 'list_files'];

describe('toolRisk table reproduces the predicates it replaces', () => {
  it('agrees with the old plan-only allow list on every combination', () => {
    for (const server of SERVERS) {
      for (const tool of TOOLS) {
        const tl = String(tool || '').toLowerCase();
        if (normalizeServerName(server).toLowerCase() === 'skill' && NARROWED_SKILL_ALIASES.includes(tl)) continue;
        expect(isPlanOnlyAllowed(server, tool), `planOnly ${server}/${tool}`).toBe(
          oldIsPlanOnlyAllowed(server, tool),
        );
      }
    }
  });

  it('agrees with the old retry read-only test on every combination', () => {
    for (const server of SERVERS) {
      for (const tool of TOOLS) {
        const srvForRetry = normalizeServerName(server).toLowerCase();
        expect(isReplayableRead(server, tool), `retry ${server}/${tool}`).toBe(
          oldIsReadOnlyRetry(srvForRetry, String(tool || '').toLowerCase()),
        );
      }
    }
  });

  it('agrees with the old filesystem op on every tool name', () => {
    for (const tool of TOOLS) {
      expect(filesystemOp(tool), `op ${tool}`).toBe(oldGetFilesystemOp(tool));
    }
  });
});

describe('toolRisk classification itself', () => {
  it('keeps unregistered filesystem tool names out of the table instead of defaulting them', () => {
    // filesystemOp still answers read for these (existing behaviour), but they are
    // not registered as reads, so neither plan mode nor retry lets them through.
    expect(toolRisk('fs', 'list_files')).toBe('unknown');
    expect(filesystemOp('list_files')).toBe('read');
    expect(isPlanOnlyAllowed('fs', 'list_files')).toBe(false);
    expect(isReplayableRead('fs', 'list_files')).toBe(false);
  });

  it('does not treat a third-party MCP tool as replayable just because it reads', () => {
    expect(toolRisk('some_mcp_server', 'read')).toBe('unknown');
    expect(isReplayableRead('some_mcp_server', 'read')).toBe(false);
  });

  it('keeps skill__use an explicit plan-mode exception rather than a fake read', () => {
    // The alias is gone (see NARROWED_SKILL_ALIASES); `guide` answers the same need.
    expect(toolRisk('skill', 'use')).toBe('unknown');
    expect(isPlanOnlyAllowed('skill', 'use')).toBe(false);
    expect(isPlanOnlyAllowed('skill', 'guide')).toBe(true);
  });

  it('drops the removed skill aliases out of both predicates', () => {
    // Search that proved the names are unroutable:
    //   grep -n "case '" src/lib/mcp/pipeline/adapters/SkillUnifiedAdapter.ts
    // lists every name the adapter can still route.
    for (const name of NARROWED_SKILL_ALIASES) {
      expect(toolRisk('skill', name), name).toBe('unknown');
      expect(isPlanOnlyAllowed('skill', name), name).toBe(false);
      expect(isReplayableRead('skill', name), name).toBe(false);
    }
  });

  it('leaves the skills server as closed as it always was', () => {
    // normalizeServerName does not fold skills -> skill, and never did.
    expect(isPlanOnlyAllowed('skills', 'list')).toBe(false);
    expect(toolRisk('skills', 'list')).toBe('unknown');
  });
});

describe('skill row of the table tracks the tools the registry exposes', () => {
  it('names exactly the tools skillUnifiedTools still publishes', () => {
    // A tool added or renamed in skillUnifiedTools lands here, so the table cannot
    // keep a name nothing exposes (zombie names stay plan-allowed forever).
    expect(SKILL_UNIFIED_TOOLS.map((t) => t.name).sort()).toEqual([
      'check_deps', 'disable', 'edit_resource', 'enable', 'get_template', 'guide',
      'install', 'list', 'list_resources', 'uninstall', 'update',
    ]);
  });

  it('registers as read exactly the read-only tools of that group', () => {
    for (const name of ['list', 'guide', 'list_resources', 'get_template', 'check_deps']) {
      expect(toolRisk('skill', name), name).toBe('read');
    }
    for (const name of ['install', 'uninstall', 'enable', 'disable', 'update', 'edit_resource']) {
      expect(toolRisk('skill', name), name).toBe('unknown');
    }
  });
});

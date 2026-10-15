import { describe, expect, it } from 'vitest';
import type { AllowlistDirectory } from '@/lib/filesystemAllowlist';
import { ToolInvocation } from '../../ToolInvocation';
import { hasFilesystemPaths, resolveFilesystemCall } from '../resolveCall';

const PROJECT: AllowlistDirectory = {
  id: 'd1', path: 'C:/Users/me/project', alias: 'Project',
  permissions: { read: true, write: true, create: true, delete: false },
  source: 'manual', createdAt: 0, updatedAt: 0,
};

const WORKDIR: AllowlistDirectory = {
  id: 'session', path: '/tmp/session-work', alias: 'WorkDir',
  permissions: { read: true, write: true, create: true, delete: false },
  source: 'workdir', createdAt: 0, updatedAt: 0,
};

const DIRECTORIES = [WORKDIR, PROJECT];

/** A real invocation always carries these; they are not what the tests below are about. */
const realInvocation = () => ({
  provider: 'openai-compatible',
  model: 'gpt-fixture',
  historyForLlm: [],
  originalUserContent: 'question',
});

function call(args: Record<string, unknown>) {
  return new ToolInvocation({
    ...realInvocation(),
    assistantMessageId: 'run-1', conversationId: 'conv-1',
    server: 'filesystem', tool: 'write_file', args, callId: 'call-1',
  });
}

function resolve(args: Record<string, unknown>) {
  return resolveFilesystemCall({ invocation: call(args), cardId: 'card-1', directories: DIRECTORIES });
}

describe('resolveFilesystemCall', () => {
  it('turns an alias into the real path and keeps the hit directory alongside it', () => {
    const result = resolve({ path: '@Project/src/a.ts', content: 'x' });

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.invocation.args!.path).toBe('C:/Users/me/project/src/a.ts');
    expect(result.primaryPath).toBe('C:/Users/me/project/src/a.ts');
    expect(result.requestedPath).toBe('@Project/src/a.ts');
    expect(result.directory?.alias).toBe('Project');
    // The rest of the arguments travel untouched.
    expect(result.invocation.args!.content).toBe('x');
  });

  it('resolves both sides of a rename', () => {
    const result = resolve({ oldPath: '@Project/a.ts', newPath: '@WorkDir/b.ts' });

    if (result.kind !== 'resolved') throw new Error(`expected resolved, got ${result.kind}`);
    expect(result.invocation.args!.oldPath).toBe('C:/Users/me/project/a.ts');
    expect(result.invocation.args!.newPath).toBe('/tmp/session-work/b.ts');
  });

  it('resolves every entry of a bulk path list', () => {
    const result = resolve({ paths: ['@Project/a.ts', '@Project/b.ts'] });

    if (result.kind !== 'resolved') throw new Error(`expected resolved, got ${result.kind}`);
    expect(result.invocation.args!.paths).toEqual([
      'C:/Users/me/project/a.ts', 'C:/Users/me/project/b.ts',
    ]);
  });

  it('refuses an alias with no authorized directory instead of passing it through', () => {
    const result = resolve({ path: '@Nope/a.ts' });

    expect(result.kind).toBe('reject');
    if (result.kind !== 'reject') return;
    expect(result.alias).toBe('@Nope');
    expect(result.reason).toContain('@Nope');
  });

  it('refuses when any entry of a bulk list carries a dead alias', () => {
    const result = resolve({ paths: ['@Project/a.ts', '@Ghost/b.ts'] });

    expect(result.kind).toBe('reject');
    if (result.kind !== 'reject') return;
    expect(result.alias).toBe('@Ghost');
  });

  it('reports relative paths against the session working directory', () => {
    const result = resolveFilesystemCall({
      invocation: call({ path: 'notes.md' }), cardId: 'card-1',
      directories: DIRECTORIES, workingDir: '/tmp/session-work',
    });

    if (result.kind !== 'resolved') throw new Error(`expected resolved, got ${result.kind}`);
    expect(result.primaryPath).toBe('/tmp/session-work/notes.md');
  });

  it('says nothing needs doing when no argument carries a path', () => {
    expect(hasFilesystemPaths({ command: 'ls' })).toBe(false);
    expect(hasFilesystemPaths({ paths: ['  '] })).toBe(false);
    // 空白不等于“没得”：原实现不做 trim，'  ' 照样计作一个待解析路径。
    expect(hasFilesystemPaths({ dir: '  ' })).toBe(true);
    expect(hasFilesystemPaths({ path: '@Project/a.ts' })).toBe(true);
    expect(hasFilesystemPaths({ newPath: '@Project/b.ts' })).toBe(true);
    expect(hasFilesystemPaths({ paths: ['@Project/b.ts'] })).toBe(true);
  });
});

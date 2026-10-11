import { describe, expect, test } from 'vitest';
import { buildAuthDeniedResult } from '../present';

/**
 * 这些断言钉的是"模型看到什么"，不是内部实现。三处下游依赖这个形状：
 * public/tool-docs/fs.txt 承诺 AUTH_DENIED、AgentLoopRunner 读嵌套的 error.code、
 * 工具卡片按 suggestion.action 决定提示什么。改形状就等于改对用户的承诺。
 */
describe('buildAuthDeniedResult: the shape the model is promised', () => {
  test('error stays a nested object carrying code, never a bare string', () => {
    const out = buildAuthDeniedResult({
      server: 'shell', tool: 'run', message: '用户拒绝授权此工具调用',
    });

    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe('object');
    expect(out.error.code).toBe('AUTH_DENIED');
    expect(out.error.message).toBe('用户拒绝授权此工具调用');
    expect(out.error.server).toBe('shell');
    expect(out.error.tool).toBe('run');
  });

  test('missing ids and args stay present so consumers never read undefined keys', () => {
    const out = buildAuthDeniedResult({ server: 'web_search', tool: 'search', message: 'no' });

    expect(out.error.args).toEqual({});
    expect('conversationId' in out.error).toBe(true);
    expect(out.error.conversationId).toBeUndefined();
    expect('cardId' in out.error).toBe(true);
  });

  test('a filesystem refusal points at the directory to authorize', () => {
    const out = buildAuthDeniedResult({
      server: 'filesystem',
      tool: 'write_file',
      message: '用户拒绝授权此文件系统操作（write）：/srv/app',
      conversationId: 'c1', assistantMessageId: 'a1', cardId: 'k1',
      args: { path: '/srv/app/x.ts' },
      fs: { op: 'write', inputPath: 'src/x.ts', resolvedPath: '/srv/app/x.ts', suggestDir: '/srv/app' },
    });

    expect(out.error.fs).toEqual({
      op: 'write', inputPath: 'src/x.ts', resolvedPath: '/srv/app/x.ts', suggestDir: '/srv/app',
    });
    expect(out.error.suggestion).toEqual({
      action: 'REQUEST_DIRECTORY_AUTH',
      directory: '/srv/app',
      note: '需要用户授权该目录（加入 allowlist）后才能继续执行 filesystem 操作。',
    });
    expect(out.error.args).toEqual({ path: '/srv/app/x.ts' });
  });

  test('both filesystem spellings the pipeline uses take the directory branch', () => {
    for (const server of ['filesystem', 'fs']) {
      const out = buildAuthDeniedResult({
        server, tool: 'read_file', message: 'm', fs: { suggestDir: '/docs' },
      });
      expect((out.error.suggestion as { action: string }).action).toBe('REQUEST_DIRECTORY_AUTH');
    }
  });

  test('everything else is asked about as a single tool call', () => {
    const out = buildAuthDeniedResult({ server: 'some_mcp', tool: 'do', message: 'm' });

    expect(out.error.suggestion).toEqual({
      action: 'REQUEST_TOOL_APPROVAL',
      note: '需要用户批准该工具调用后才能继续执行。',
    });
  });

  /**
   * 继承下来的行为，不是设计意图：这里的 server 比较是原样比字符串，没有走
   * normalizeServerName，所以 'FileSystem' 走的是"批准这次调用"而不是"授权目录"。
   * 改它会让模型看到的建议变掉，属于另一件事，先钉住现状。
   */
  test('the directory branch is matched on the raw server string, not the normalized one', () => {
    const out = buildAuthDeniedResult({
      server: 'FileSystem', tool: 'read_file', message: 'm', fs: { suggestDir: '/docs' },
    });

    expect((out.error.suggestion as { action: string }).action).toBe('REQUEST_TOOL_APPROVAL');
  });
});

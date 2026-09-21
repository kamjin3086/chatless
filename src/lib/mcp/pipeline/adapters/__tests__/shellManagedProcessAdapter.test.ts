import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellExecutorAdapter } from '../ShellExecutorAdapter';
import { ToolInvocation } from '../../ToolInvocation';

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => ({ executionId: 'shell:run-1:card-1', pid: 4242 })),
  read: vi.fn(async () => ({
    executionId: 'shell:run-1:card-1', running: true, exitCode: null,
    stdout: 'ready in 812ms', stderr: '', stdoutBytes: 13, stderrBytes: 0,
    stdoutDropped: 0, stderrDropped: 0,
  })),
  stop: vi.fn(async () => ({ stopped: true, exitCode: null })),
  list: vi.fn(async () => [{ executionId: 'shell:run-1:card-1', pid: 4242, command: 'pnpm dev',
    workingDir: 'D:/site', running: true, exitCode: null, startedAt: 1, stdoutBytes: 13, stderrBytes: 0 }]),
}));

vi.mock('@/lib/skills/sandbox', () => ({
  getProcessSandbox: () => ({
    isAvailable: async () => true,
    startManagedProcess: mocks.start,
    readManagedProcess: mocks.read,
    stopManagedProcess: mocks.stop,
    listManagedProcesses: mocks.list,
  }),
}));

beforeEach(() => vi.clearAllMocks());

const invocation = (tool: string, args: Record<string, unknown>) => new ToolInvocation({
  assistantMessageId: 'run-1', conversationId: 'conv-1', server: 'shell', tool, args, callId: 'call-1',
});

describe('shell background process tools', () => {
  it('starts a long-running command and returns a handle', async () => {
    const result: any = await new ShellExecutorAdapter().execute(
      invocation('start', { command: 'pnpm dev --port 4321', workingDir: 'D:/site', name: 'dev-server' }),
    );

    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      executionId: expect.stringContaining('shell:run-1'),
      command: 'pnpm',
      args: ['dev', '--port', '4321'],
      workingDir: 'D:/site',
    }));
    expect(result).toMatchObject({ ok: true, pid: 4242, name: 'dev-server' });
  });

  it('reads logs, stops and lists without touching a command', async () => {
    const adapter = new ShellExecutorAdapter();

    const logs: any = await adapter.execute(invocation('logs', { executionId: 'shell:run-1:card-1' }));
    expect(logs).toMatchObject({ ok: true, running: true, stdout: 'ready in 812ms' });

    const stopped: any = await adapter.execute(invocation('stop', { executionId: 'shell:run-1:card-1' }));
    expect(stopped).toMatchObject({ ok: true, stopped: true });
    expect(mocks.stop).toHaveBeenCalledWith('shell:run-1:card-1');

    const list: any = await adapter.execute(invocation('list', {}));
    expect(list.processes).toHaveLength(1);
    expect(list.processes[0]).toMatchObject({ command: 'pnpm dev', running: true });
  });

  it('maps failures into structured tool errors', async () => {
    mocks.start.mockRejectedValueOnce(new Error('已达后台进程上限（4）'));
    const result: any = await new ShellExecutorAdapter().execute(invocation('start', { command: 'pnpm dev' }));

    expect(result).toMatchObject({ ok: false, error: { code: 'START_FAILED' } });
    expect(String(result.error.message)).toContain('上限');
  });

  it('rejects logs without an execution id', async () => {
    const result: any = await new ShellExecutorAdapter().execute(invocation('logs', {}));
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENTS' } });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});

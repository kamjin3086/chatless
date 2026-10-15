/**
 * The shell plan has to be built from the platform the app is running on (#102). This
 * pins the wiring: the adapter asks the runtime, and passes the answer down - a browser
 * string is no longer allowed to decide which interpreter gets spawned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolInvocation } from '../../ToolInvocation';
import { ShellExecutorAdapter } from '../ShellExecutorAdapter';

const state = vi.hoisted(() => ({ platform: 'linux', execute: vi.fn() }));

vi.mock('@/lib/shell/hostPlatform', () => ({
  hostPlatform: async () => state.platform,
}));

vi.mock('@/lib/skills/sandbox', () => ({
  getProcessSandbox: () => ({
    isAvailable: async () => true,
    checkEnvironment: async (runtime: string) => ({
      runtime,
      available: true,
    }),
    setAllowedWorkingDirs: () => undefined,
    execute: (...args: unknown[]) => state.execute(...args),
  }),
}));

/** A real invocation always carries these; they are not what the tests below are about. */
const realInvocation = () => ({
  provider: 'openai-compatible',
  model: 'gpt-fixture',
  historyForLlm: [],
  originalUserContent: 'question',
});

const invocation = (args: Record<string, unknown>) =>
  new ToolInvocation({
    ...realInvocation(),
    assistantMessageId: 'run-1',
    conversationId: 'conv-1',
    server: 'shell',
    tool: 'run',
    args,
    callId: 'call-1',
  });

beforeEach(() => {
  state.execute = vi.fn(async () => ({
    success: true,
    exitCode: 0,
    stdout: 'ready',
    stderr: '',
    duration: 1,
    timedOut: false,
  }));
  // A browser that claims Windows must not be able to move the plan on a Linux host -
  // that mismatch is what made every shell task fail to start on a Linux runner.
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
});

describe('the shell plan follows the runtime platform', () => {
  it('plans bash on a Linux host', async () => {
    state.platform = 'linux';
    await new ShellExecutorAdapter().execute(
      invocation({ command: 'echo hi' }),
    );
    expect(state.execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'bash', args: ['-lc', 'echo hi'] }),
      expect.anything(),
    );
  });

  it('plans cmd on a Windows host', async () => {
    state.platform = 'windows';
    await new ShellExecutorAdapter().execute(
      invocation({ command: 'echo hi' }),
    );
    expect(state.execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'cmd.exe' }),
      expect.anything(),
    );
  });

  it('tells the model which shell is available instead of naming another system', async () => {
    state.platform = 'linux';
    const result: any = await new ShellExecutorAdapter().execute(
      invocation({ command: 'dir', shell: 'cmd' }),
    );
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('Linux');
    expect(result.error.message).not.toContain('Windows');
    expect(result.error.code).toBe('SHELL_UNSUPPORTED');
  });
});

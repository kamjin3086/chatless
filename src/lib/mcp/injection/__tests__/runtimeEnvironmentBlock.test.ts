import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInitialPrompt } from '../promptBuilder';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  platform: vi.fn(),
  configuredServers: vi.fn(),
  remoteTools: vi.fn(),
  connectRemote: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  isTauri: mocks.isTauri,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: mocks.platform }));
vi.mock('@/lib/mcp/chatIntegration', () => ({
  getEnabledConfiguredServers: mocks.configuredServers,
}));
vi.mock('@/lib/mcp/persistentCache', () => ({
  persistentCache: { getToolsWithCache: mocks.remoteTools },
}));
vi.mock('@/lib/mcp/executor/ConnectionManager', () => ({
  ensureServerConnected: mocks.connectRemote,
}));

async function runtimeBlock(userAgent?: string) {
  if (userAgent) vi.stubGlobal('navigator', { userAgent });
  const { systemMessages } = await buildInitialPrompt(
    {
      userContent: 'Look in my Downloads folder.',
      phase: 'initial',
      providerName: 'OpenAI',
      modelName: 'gpt-4o',
    },
    {
      hasExplicitMention: false,
      mentionedServers: [],
      webSearchEnabled: false,
      hasToolKeywords: false,
      hasPreviousToolUse: false,
      isTimeRelated: false,
    },
  );
  const block = (systemMessages as Array<{ id: string; content: string }>).find(
    (b) => b.id === 'runtime-environment',
  );
  expect(
    block,
    'the runtime environment block is always injected',
  ).toBeTruthy();
  return block!.content;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  mocks.isTauri.mockReturnValue(true);
  mocks.configuredServers.mockResolvedValue([]);
  mocks.remoteTools.mockResolvedValue([]);
  mocks.connectRemote.mockResolvedValue(true);
});

describe('the runtime environment block', () => {
  it('says Android on the phone, and says nothing about shells', async () => {
    mocks.platform.mockReturnValue('android');
    const content = await runtimeBlock();

    expect(content).toContain('[Runtime environment - Android (binding)]');
    expect(content).toContain('Android phone or tablet');
    expect(content).toContain('do not call shell__run');
    expect(content).not.toContain('Shell:');
    expect(content).not.toContain('Common commands:');
    expect(content).not.toContain('fs__mkdir');
  });

  it('keeps telling a desktop Linux which shell to pass', async () => {
    mocks.platform.mockReturnValue('linux');
    const content = await runtimeBlock();

    expect(content).toContain('[Runtime environment - Linux (binding)]');
    expect(content).toContain('Shell: shell__run uses shell: "bash"');
    expect(content).toContain('Common commands:');
    expect(content).toContain('Prefer fs__mkdir over a shell command');
  });
});

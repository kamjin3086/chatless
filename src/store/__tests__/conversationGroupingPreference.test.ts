import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/storage', () => ({
  default: {
    getItem: async (key: string, fallback: unknown, file: string) =>
      storage.get(`${file}:${key}`) ?? fallback,
    setItem: async (key: string, value: unknown, file: string) => {
      storage.set(`${file}:${key}`, value);
      return true;
    },
  },
}));

beforeEach(() => {
  storage.clear();
  vi.resetModules();
});

it('restores the selected view when preferences initialize again', async () => {
  const { useUiPreferences } = await import('../uiPreferences');
  await vi.waitFor(() =>
    expect(useUiPreferences.getState().initialized).toBe(true),
  );
  expect(useUiPreferences.getState().conversationGrouping).toBe('workspace');
  useUiPreferences.getState().setConversationGrouping('time');
  expect(useUiPreferences.getState().conversationGrouping).toBe('time');

  vi.resetModules();
  const reloaded = (await import('../uiPreferences')).useUiPreferences;
  await vi.waitFor(() => expect(reloaded.getState().initialized).toBe(true));
  expect(reloaded.getState().conversationGrouping).toBe('time');
});

it('restores the compact app navigation independently from the conversation sidebar', async () => {
  const { useUiPreferences } = await import('../uiPreferences');
  await vi.waitFor(() =>
    expect(useUiPreferences.getState().initialized).toBe(true),
  );
  expect(useUiPreferences.getState().appNavCollapsed).toBe(false);
  const sidebar = useUiPreferences.getState().collapseChatSidebar;
  useUiPreferences.getState().setAppNavCollapsed(true);
  expect(useUiPreferences.getState().collapseChatSidebar).toBe(sidebar);

  vi.resetModules();
  const reloaded = (await import('../uiPreferences')).useUiPreferences;
  await vi.waitFor(() => expect(reloaded.getState().initialized).toBe(true));
  expect(reloaded.getState().appNavCollapsed).toBe(true);
  expect(reloaded.getState().collapseChatSidebar).toBe(sidebar);
});

it('falls back to workspace grouping when a saved value is not recognized', async () => {
  storage.set('user-preferences.json:ui_conversation_grouping', 'unsupported');
  const { useUiPreferences } = await import('../uiPreferences');
  await vi.waitFor(() =>
    expect(useUiPreferences.getState().initialized).toBe(true),
  );
  expect(useUiPreferences.getState().conversationGrouping).toBe('workspace');
});

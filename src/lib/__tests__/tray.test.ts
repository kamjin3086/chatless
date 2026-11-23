import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import type { MenuItemOptions } from '@tauri-apps/api/menu';
import type { TrayIconOptions } from '@tauri-apps/api/tray';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type NativeMenuItem = MenuItemOptions & {
  setText: (text: string) => Promise<void>;
};
type NativeSeparator = { item: 'Separator' };

const mocks = vi.hoisted(() => ({
  readLocale: vi.fn<() => Promise<string>>(),
  writeLocale: vi.fn(),
  newTray:
    vi.fn<(options: TrayIconOptions) => Promise<{ close: () => void }>>(),
  newItem: vi.fn<(options: MenuItemOptions) => Promise<NativeMenuItem>>(),
  newMenu:
    vi.fn<
      (options: {
        items: (NativeMenuItem | NativeSeparator)[];
      }) => Promise<unknown>
    >(),
  setText: vi.fn<(id: string | undefined, text: string) => Promise<void>>(),
  close: vi.fn(),
  invoke: vi.fn(),
  platform: vi.fn(),
  window: {
    isVisible: vi.fn(),
    isMinimized: vi.fn(),
    unminimize: vi.fn(),
    show: vi.fn(),
    setFocus: vi.fn(),
    hide: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('@/lib/storage', () => ({
  default: { getItem: mocks.readLocale, setItem: mocks.writeLocale },
}));
vi.mock('@tauri-apps/api/app', () => ({ defaultWindowIcon: async () => null }));
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: mocks.invoke,
}));
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: mocks.newMenu },
  MenuItem: { new: mocks.newItem },
  PredefinedMenuItem: { new: async (options: NativeSeparator) => options },
}));
vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: async () => 'tray-icon.png',
}));
vi.mock('@tauri-apps/api/image', () => ({
  Image: { fromPath: async () => ({}) },
}));
vi.mock('@tauri-apps/api/tray', () => ({ TrayIcon: { new: mocks.newTray } }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mocks.window,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: mocks.platform }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function menuItems() {
  return mocks.newMenu.mock.calls[0][0].items;
}

function menuLabels() {
  return menuItems().map((item) => ('item' in item ? item.item : item.text));
}

function selectMenuItem(id: string) {
  return mocks.newItem.mock.calls
    .find(([options]) => options.id === id)?.[0]
    .action?.(id);
}

const english = ['Show Window', 'New Chat', 'Separator', 'Settings', 'Quit'];
const chinese = ['显示窗口', '新建聊天', 'Separator', '设置', '退出'];

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.readLocale.mockResolvedValue('zh');
  mocks.platform.mockReturnValue('linux');
  mocks.newTray.mockResolvedValue({ close: mocks.close });
  mocks.newMenu.mockImplementation(async ({ items }) => ({ items }));
  mocks.newItem.mockImplementation(async (options) => {
    const item = {
      ...options,
      setText: async (text: string) => {
        await mocks.setText(item.id, text);
        item.text = text;
      },
    };
    return item;
  });
  mocks.window.isVisible.mockResolvedValue(true);
  mocks.window.isMinimized.mockResolvedValue(false);
});

describe('tray locale', () => {
  it('waits for the saved startup language and creates one Linux tray for concurrent callers', async () => {
    const saved = deferred<string>();
    mocks.readLocale.mockReturnValueOnce(saved.promise);
    const { trayManager } = await import('../tray');

    const first = trayManager.initialize();
    const second = trayManager.initialize();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(trayManager.isReady()).toBe(false);
    expect(mocks.newItem).not.toHaveBeenCalled();
    expect(mocks.newTray).not.toHaveBeenCalled();

    saved.resolve('en');
    await first;
    expect(trayManager.isReady()).toBe(true);
    expect(menuLabels()).toEqual(english);
    expect(
      menuItems().map((item) => ('item' in item ? item.item : item.id)),
    ).toEqual(['show', 'new_chat', 'Separator', 'settings', 'quit']);
    expect(mocks.newTray).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        menuOnLeftClick: true,
      }),
    );
  });

  it('reconciles a language change during native tray creation without making a new icon', async () => {
    const created = deferred<{ close: () => void }>();
    mocks.newTray.mockReturnValueOnce(created.promise);
    const { trayManager } = await import('../tray');
    const { useLocaleStore } = await import('@/store/localeStore');

    const initializing = trayManager.initialize();
    await vi.waitFor(() => expect(mocks.newTray).toHaveBeenCalledTimes(1));
    expect(menuLabels()).toEqual(chinese);
    useLocaleStore.getState().setLocale('en');
    created.resolve({ close: mocks.close });
    await initializing;

    expect(menuLabels()).toEqual(english);
    expect(mocks.newTray).toHaveBeenCalledTimes(1);
    expect(mocks.newMenu).toHaveBeenCalledTimes(1);
  });

  it('serializes rapid language switches on the existing menu and preserves its actions', async () => {
    const { trayManager } = await import('../tray');
    const { useLocaleStore } = await import('@/store/localeStore');
    await trayManager.initialize();

    const slowWrite = deferred<void>();
    mocks.setText.mockReturnValueOnce(slowWrite.promise);
    useLocaleStore.getState().setLocale('en');
    await vi.waitFor(() =>
      expect(mocks.setText).toHaveBeenCalledWith('show', 'Show Window'),
    );
    useLocaleStore.getState().setLocale('zh');
    await Promise.resolve();
    expect(mocks.setText).toHaveBeenCalledTimes(1);
    slowWrite.resolve(undefined);
    await vi.waitFor(() => {
      expect(mocks.setText).toHaveBeenCalledTimes(8);
      expect(menuLabels()).toEqual(chinese);
    });
    await trayManager.initialize();
    expect(mocks.newTray).toHaveBeenCalledTimes(1);
    expect(mocks.newMenu).toHaveBeenCalledTimes(1);

    selectMenuItem('show');
    await vi.waitFor(() =>
      expect(mocks.window.setFocus).toHaveBeenCalledTimes(1),
    );
    expect(mocks.window.emit).not.toHaveBeenCalled();
    selectMenuItem('new_chat');
    await vi.waitFor(() =>
      expect(mocks.window.emit).toHaveBeenCalledWith('create-new-chat'),
    );
    selectMenuItem('settings');
    await vi.waitFor(() =>
      expect(mocks.window.emit).toHaveBeenCalledWith('navigate', 'settings'),
    );
    expect(mocks.window.setFocus).toHaveBeenCalledTimes(3);
    expect(mocks.window.setFocus.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.window.emit.mock.invocationCallOrder[0],
    );
    expect(mocks.window.setFocus.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.window.emit.mock.invocationCallOrder[1],
    );

    selectMenuItem('quit');
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('exit', { code: 0 }),
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.window.setFocus).toHaveBeenCalledTimes(3);
  });

  it.each(['macos', 'windows'])(
    'keeps the %s left-click window toggle',
    async (platform) => {
      mocks.platform.mockReturnValue(platform);
      const { trayManager } = await import('../tray');
      await trayManager.initialize();

      const [{ action, menuOnLeftClick }] = mocks.newTray.mock.calls[0];
      expect(menuOnLeftClick).toBe(false);
      const position = new PhysicalPosition(0, 0);
      action?.({
        type: 'Click',
        id: 'tray',
        button: 'Left',
        buttonState: 'Up',
        position,
        rect: { position, size: new PhysicalSize(1, 1) },
      });
      await vi.waitFor(() =>
        expect(mocks.window.hide).toHaveBeenCalledTimes(1),
      );
    },
  );
});

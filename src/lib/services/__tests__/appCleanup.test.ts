import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppCleanupService } from '../appCleanup';

const mocks = vi.hoisted(() => ({
  preferences: { closeToTray: false, showCloseConfirmation: false },
  ready: vi.fn(), hide: vi.fn(), confirm: vi.fn(), save: vi.fn(),
  onCloseRequested: vi.fn(), onResized: vi.fn(),
}));
vi.mock('@/lib/database/services/DatabaseService', () => ({ DatabaseService: {} }));
vi.mock('@/store/uiPreferences', () => ({ useUiPreferences: { getState: () => mocks.preferences } }));
vi.mock('@/store/localeStore', () => ({ useLocaleStore: { getState: () => ({ t: (key: string) => key }) } }));
vi.mock('@/lib/tray', () => ({ trayManager: { isReady: mocks.ready } }));
vi.mock('@/lib/window/windowState', () => ({ savePersistedWindowState: mocks.save }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: mocks.confirm }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  hide: mocks.hide, onCloseRequested: mocks.onCloseRequested, onResized: mocks.onResized,
}) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('window', {});
  mocks.preferences.closeToTray = false;
  mocks.preferences.showCloseConfirmation = false;
  mocks.ready.mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function closeWindow() {
  const service = AppCleanupService.getInstance();
  const cleanup = vi.spyOn(service, 'cleanup').mockResolvedValue();
  await service.setupWindowCloseListener();
  const event = { preventDefault: vi.fn() };
  await mocks.onCloseRequested.mock.calls[0][0](event);
  return { cleanup, event };
}

describe('window close behavior', () => {
  it('hides to a working tray without confirmation or shutting down services', async () => {
    mocks.preferences.closeToTray = true;
    mocks.preferences.showCloseConfirmation = true;
    const { cleanup, event } = await closeWindow();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.hide).toHaveBeenCalledOnce();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });
  it('preserves normal close by default', async () => {
    const { cleanup, event } = await closeWindow();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.hide).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('falls back to normal close when no tray is available', async () => {
    mocks.preferences.closeToTray = true;
    mocks.ready.mockReturnValue(false);
    const { cleanup, event } = await closeWindow();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.hide).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('keeps the window alive when hiding fails', async () => {
    mocks.preferences.closeToTray = true;
    mocks.hide.mockRejectedValue(new Error('hide failed'));
    const { cleanup, event } = await closeWindow();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
  });
  it('honors cancellation of a normal close', async () => {
    mocks.preferences.showCloseConfirmation = true;
    mocks.confirm.mockResolvedValue(false);
    const { cleanup, event } = await closeWindow();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
  });
});

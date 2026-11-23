import { check, Update } from '@tauri-apps/plugin-updater';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  checkForUpdatesSilently,
  getUpdateAvailability,
  UPDATE_AVAILABILITY_EVENT,
} from '../update-notifier';

vi.mock('@tauri-apps/plugin-updater', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/plugin-updater')>()),
  check: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({ default: {} }));

const body = '## zh-CN\n中文\n\n## en-US\nEnglish\n';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.mocked(check).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('passes the updater body through both availability paths and the startup event', async () => {
  vi.mocked(check).mockResolvedValue(
    new Update({
      rid: 1,
      currentVersion: '0.8.2',
      version: '0.8.3',
      body,
      rawJson: {},
    }),
  );
  const listener = vi.fn();
  window.addEventListener(UPDATE_AVAILABILITY_EVENT, listener);

  const expected = { available: true, version: '0.8.3', body };
  expect(await getUpdateAvailability()).toEqual(expected);
  expect(await checkForUpdatesSilently()).toEqual(expected);
  expect(listener).toHaveBeenCalledOnce();
  expect(listener.mock.calls[0][0].detail).toEqual(expected);
});

it('does not dispatch availability when there is no update', async () => {
  vi.mocked(check).mockResolvedValue(null);
  const listener = vi.fn();
  window.addEventListener(UPDATE_AVAILABILITY_EVENT, listener);

  expect(await getUpdateAvailability()).toEqual({ available: false });
  expect(await checkForUpdatesSilently()).toEqual({ available: false });
  expect(listener).not.toHaveBeenCalled();
});

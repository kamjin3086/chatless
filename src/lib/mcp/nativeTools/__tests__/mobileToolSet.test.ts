import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { getToolsForGroup } from '../toolRegistry';
import { mobileUnsupportedReason } from '../mobileUnsupported';
import {
  ANDROID_CAPABILITIES,
  NO_ANDROID_CAPABILITIES,
  type AndroidCapabilities,
} from '@/lib/android/androidCapabilities';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }));

const ALL = Object.fromEntries(
  ANDROID_CAPABILITIES.map(({ id }) => [id, true]),
) as AndroidCapabilities;

function names(groupId: 'core', caps = NO_ANDROID_CAPABILITIES) {
  return getToolsForGroup(groupId, caps).map(
    ({ server, tool }) => `${server}__${tool.name}`,
  );
}

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
});

describe('the tool set the phone advertises', () => {
  it('keeps the desktop core intact', () => {
    vi.mocked(platform).mockReturnValue('linux');
    const all = names('core', ALL);

    expect(all).toContain('fs__ls');
    expect(all).toContain('shell__run');
    expect(all).toContain('web__search');
    expect(ANDROID_CAPABILITIES.length).toBeGreaterThan(0);
  });

  it('drops the desktop file and shell tools on Android', () => {
    vi.mocked(platform).mockReturnValue('android');
    const all = names('core', ALL);

    expect(all.filter((n) => n.startsWith('fs__'))).toHaveLength(0);
    expect(all.filter((n) => n.startsWith('shell__'))).toHaveLength(0);
    expect(all).toContain('web__search');
    expect(all).toContain('android_countdown__start');
    expect(all).toContain('android_directory__inventory');
  });

  it('only adds the capabilities this chat holds', () => {
    vi.mocked(platform).mockReturnValue('android');

    expect(names('core')).not.toContain('android_countdown__start');
    expect(names('core')).toContain('web__search');
  });
});

describe('the Android guard', () => {
  it('stays out of the way off the phone', () => {
    vi.mocked(platform).mockReturnValue('linux');

    expect(mobileUnsupportedReason('fs', 'list_dir')).toBeUndefined();
    expect(mobileUnsupportedReason('shell', 'run')).toBeUndefined();
  });

  it('names the alternative for a desktop call on Android', () => {
    vi.mocked(platform).mockReturnValue('android');

    expect(mobileUnsupportedReason('fs', 'list_dir')).toMatch(
      /filesystem backend/,
    );
    expect(mobileUnsupportedReason('shell', 'run')).toMatch(/shell backend/);
    expect(mobileUnsupportedReason('fs', 'list_dir')).toContain(
      'android_directory__inventory',
    );
    expect(mobileUnsupportedReason('web_search', 'search')).toBeUndefined();
    expect(
      mobileUnsupportedReason('android_directory', 'list'),
    ).toBeUndefined();
  });
});

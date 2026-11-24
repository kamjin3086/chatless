import { afterEach, describe, expect, it, vi } from 'vitest';
import { platform } from '@tauri-apps/plugin-os';
import { getRuntimePlatform, getShellGuidance } from '../runtimePlatform';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }));

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.0.0 Mobile Safari/537.36';
const DESKTOP_LINUX_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(platform).mockReset();
});

describe('getRuntimePlatform', () => {
  it('reads android off the OS plugin instead of folding it into linux', async () => {
    vi.mocked(platform).mockReturnValue('android' as never);
    await expect(getRuntimePlatform()).resolves.toBe('android');
  });

  it('calls an Android WebView android, though its UA says Linux', async () => {
    vi.mocked(platform).mockImplementation(() => {
      throw new Error('not inside Tauri');
    });
    vi.stubGlobal('navigator', { userAgent: ANDROID_UA });
    await expect(getRuntimePlatform()).resolves.toBe('android');
  });

  it('keeps a desktop Linux UA on linux', async () => {
    vi.mocked(platform).mockImplementation(() => {
      throw new Error('not inside Tauri');
    });
    vi.stubGlobal('navigator', { userAgent: DESKTOP_LINUX_UA });
    await expect(getRuntimePlatform()).resolves.toBe('linux');
  });
});

describe('getShellGuidance', () => {
  it('tells the phone there is no shell to call', () => {
    const g = getShellGuidance('android');

    expect(g.platformLabel).toBe('Android');
    expect(g.preferredShell).toBeUndefined();
    expect(g.toolNote).toBeUndefined();
    expect(Object.keys(g.commandExamples)).toHaveLength(0);

    const text = g.rules.join('\n');
    expect(text).toContain('Android phone');
    expect(text).toContain('no shell');
    expect(text).toContain('no home directory');
    expect(text).toContain('attach');
    expect(text).not.toContain('shell__run({');
  });

  it('leaves the desktop guidance as it was', () => {
    for (const p of ['windows', 'macos', 'linux'] as const) {
      const g = getShellGuidance(p);
      expect(g.preferredShell).toContain('shell__run');
      expect(g.toolNote).toBe(
        'Prefer fs__mkdir over a shell command when creating a directory.',
      );
      expect(Object.keys(g.commandExamples).length).toBeGreaterThan(0);
    }
  });
});

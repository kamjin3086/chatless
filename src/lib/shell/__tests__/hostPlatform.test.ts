import { describe, expect, it } from 'vitest';
import { resolveHostPlatform, syncHostPlatform } from '../hostPlatform';

describe('platform signals are ranked', () => {
  it('prefers what the app host reports', () => {
    expect(
      resolveHostPlatform({
        tauriPlatform: 'macos',
        nodePlatform: 'linux',
        userAgent: 'Windows NT 10.0',
      }),
    ).toBe('macos');
  });

  it('prefers the runtime over a browser string', () => {
    // This is the case that broke the acceptance run: a Windows user agent, a Linux
    // runner, and a shell plan that could not start a single command.
    expect(
      resolveHostPlatform({
        nodePlatform: 'linux',
        userAgent: 'Windows NT 10.0; Win64',
      }),
    ).toBe('linux');
    expect(
      resolveHostPlatform({
        nodePlatform: 'win32',
        userAgent: 'X11; Linux x86_64',
      }),
    ).toBe('windows');
  });

  it('falls back to the user agent, and says nothing when nothing is usable', () => {
    expect(resolveHostPlatform({ userAgent: 'Mac OS X' })).toBe('macos');
    expect(resolveHostPlatform({ userAgent: 'X11; Linux x86_64' })).toBe(
      'linux',
    );
    expect(resolveHostPlatform({})).toBeNull();
    expect(resolveHostPlatform({ nodePlatform: 'sunos' })).toBeNull();
  });

  it('normalises the spellings the two APIs use', () => {
    expect(resolveHostPlatform({ tauriPlatform: 'darwin' })).toBe('macos');
    expect(resolveHostPlatform({ tauriPlatform: 'windows' })).toBe('windows');
    expect(resolveHostPlatform({ nodePlatform: 'darwin' })).toBe('macos');
  });

  it('has a synchronous answer that still trusts the runtime', () => {
    expect(syncHostPlatform()).toBe(
      process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin'
          ? 'macos'
          : 'linux',
    );
  });
});

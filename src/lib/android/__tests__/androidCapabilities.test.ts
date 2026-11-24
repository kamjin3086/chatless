import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANDROID_CAPABILITIES,
  androidAllowsCall,
  androidCapabilities,
  androidPlatformCapabilities,
  androidTools,
  NO_ANDROID_CAPABILITIES,
  type AndroidCapabilities,
} from '../androidCapabilities';

const probes = vi.hoisted(() => ({
  platform: vi.fn(),
  document: vi.fn(),
  directory: vi.fn(),
  photos: vi.fn(),
}));
vi.mock('@/lib/utils/runtimePlatform', () => ({
  isAndroidTauri: probes.platform,
}));
vi.mock('@/lib/documents/android/androidDocumentAttachment', () => ({
  hasAndroidDocumentAttachment: probes.document,
}));
vi.mock('@/lib/documents/android/androidAuthorizedRoots', () => ({
  hasAndroidAuthorizedFolders: probes.directory,
}));
vi.mock('@/lib/android/androidPhotoBatch', () => ({
  hasAndroidPhotoBatchSelection: probes.photos,
}));

const everyCapability = Object.fromEntries(
  ANDROID_CAPABILITIES.map(({ id }) => [id, true]),
) as AndroidCapabilities;

beforeEach(() => {
  vi.resetAllMocks();
  probes.platform.mockReturnValue(true);
  probes.document.mockResolvedValue(false);
  probes.directory.mockResolvedValue(false);
  probes.photos.mockResolvedValue(false);
});

describe('Android capabilities', () => {
  it('asks every capability the catalog names about this chat', async () => {
    probes.document.mockResolvedValue(true);
    probes.directory.mockResolvedValue(true);

    expect(await androidCapabilities('chat-a')).toEqual({
      countdown: true,
      document: true,
      directory: true,
      photos: false,
    });
    expect(probes.document).toHaveBeenCalledExactlyOnceWith('chat-a');
    // Folders are app-level now: the probe does not ask about a chat at all (#228).
    expect(probes.directory).toHaveBeenCalledExactlyOnceWith();
    expect(probes.photos).toHaveBeenCalledExactlyOnceWith('chat-a');
  });

  it('offers nothing off Android and nothing in an empty chat', async () => {
    probes.platform.mockReturnValue(false);

    expect(androidPlatformCapabilities()).toEqual(NO_ANDROID_CAPABILITIES);
    expect(await androidCapabilities('chat-a')).toEqual(
      expect.objectContaining({ countdown: false }),
    );
    expect(androidTools(NO_ANDROID_CAPABILITIES)).toEqual([]);
  });

  it('advertises exactly the tools whose capability the gate recognises', () => {
    expect(androidPlatformCapabilities()).toEqual(everyCapability);

    const advertised = androidTools(everyCapability).map(
      ({ server, tool }) => `${server}__${tool.name}`,
    );
    const recognised = ANDROID_CAPABILITIES.flatMap(({ server, tools }) =>
      tools.map((tool) =>
        androidAllowsCall(everyCapability, server, tool.name)
          ? `${server}__${tool.name}`
          : `refused:${server}__${tool.name}`,
      ),
    );
    expect(advertised).toEqual(recognised);
    expect(new Set(advertised).size).toBe(advertised.length);
  });

  it('turns each capability off on its own', () => {
    for (const { id, server, tools } of ANDROID_CAPABILITIES) {
      const only = { ...NO_ANDROID_CAPABILITIES, [id]: true };

      expect(androidTools(only)).toEqual(
        tools.map((tool) => ({ server, tool })),
      );
      for (const tool of tools) {
        expect(
          androidAllowsCall(only, server, tool.name),
          `${id}: ${tool.name}`,
        ).toBe(true);
      }
    }
    expect(
      androidAllowsCall(NO_ANDROID_CAPABILITIES, 'android_photos', 'group'),
    ).toBe(false);
    expect(
      androidAllowsCall(NO_ANDROID_CAPABILITIES, 'android_countdown', 'start'),
    ).toBe(false);
  });

  it('refuses a name the catalog does not carry, even with everything on', () => {
    const offered = androidPlatformCapabilities();
    expect(androidAllowsCall(offered, 'android_photos', 'delete')).toBe(false);
    expect(androidAllowsCall(offered, 'android_countdown', 'set_alarm')).toBe(
      false,
    );
    expect(androidAllowsCall(offered, 'fs', 'read')).toBe(false);
  });
});

/**
 * #124: the settings routes render nothing outside Tauri because the provider list comes
 * from the Tauri store, so every "the toggle works" claim about provider settings was a
 * read-the-code claim. The fix is an in-memory stand-in for that store, reachable only from
 * a development build in a browser with a flag.
 *
 * Two things are worth testing and nothing else is: the rule that decides whether the stub
 * applies, and the store itself - because a stand-in that silently drops writes would look
 * exactly like the empty page it is supposed to replace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { devStore, devStoreApplies, devStoreEnabled } from '../devStore';
import { enterBrowser } from './browserStoreHarness';

describe('when the browser store stub applies', () => {
  it('needs the flag', () => {
    expect(
      devStoreApplies({
        nodeEnv: 'development',
        tauri: false,
        requested: false,
      }),
    ).toBe(false);
  });

  it('is refused in a production build, flag or not', () => {
    // The shipped app must have no stub to turn on: this is the whole safety property.
    expect(
      devStoreApplies({ nodeEnv: 'production', tauri: false, requested: true }),
    ).toBe(false);
    expect(
      devStoreApplies({ nodeEnv: 'production', tauri: true, requested: true }),
    ).toBe(false);
  });

  it('is refused where a real store exists', () => {
    // Inside Tauri the real store works; a stub there would shadow the user's data.
    expect(
      devStoreApplies({ nodeEnv: 'development', tauri: true, requested: true }),
    ).toBe(false);
  });

  it('applies to a development build in a browser with the flag', () => {
    expect(
      devStoreApplies({
        nodeEnv: 'development',
        tauri: false,
        requested: true,
      }),
    ).toBe(true);
    expect(
      devStoreApplies({ nodeEnv: 'test', tauri: false, requested: true }),
    ).toBe(true);
  });
});

describe('the in-memory store', () => {
  it('round-trips a value the way the Tauri store does', async () => {
    const store = devStore('fixture-roundtrip.json');
    await store.set('providers', [{ name: 'OpenAI' }]);
    await store.save();
    expect(await store.get('providers')).toEqual([{ name: 'OpenAI' }]);
    expect(await store.has('providers')).toBe(true);
  });

  it('answers absent keys with undefined, not null', async () => {
    const store = devStore('fixture-absent.json');
    expect(await store.get('nothing')).toBeUndefined();
    expect(await store.has('nothing')).toBe(false);
  });

  it('keeps each store file separate', async () => {
    const models = devStore('fixture-a.json');
    const parameters = devStore('fixture-b.json');
    await models.set('key', 'model');
    expect(await parameters.get('key')).toBeUndefined();
    expect(await parameters.keys()).toEqual([]);
  });

  it('lists, deletes and clears', async () => {
    const store = devStore('fixture-ops.json');
    await store.set('a', 1);
    await store.set('b', 2);
    expect((await store.keys()).sort()).toEqual(['a', 'b']);

    expect(await store.length()).toBe(2);

    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
    expect(await store.keys()).toEqual(['b']);
    expect(await store.length()).toBe(1);

    await store.clear();
    expect(await store.keys()).toEqual([]);
    expect(await store.length()).toBe(0);
  });

  it('hands back a copy, the way a JSON store does', async () => {
    // The real store serializes on write: a caller that mutates what it read must not be
    // mutating what is stored, or the stub would hide a bug the shipped app has.
    const store = devStore('fixture-copy.json');
    await store.set('provider', {
      name: 'OpenAI',
      url: 'https://example.test',
    });

    const read = await store.get<{ url: string }>('provider');
    read!.url = 'mutated';
    expect((await store.get<{ url: string }>('provider'))!.url).toBe(
      'https://example.test',
    );
  });
});

describe('on a page, with a browser around it', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('remembers the flag for the tab, so a dialog route keeps it', () => {
    enterBrowser('?devStore=1');
    expect(devStoreEnabled()).toBe(true);

    (globalThis as any).window.location.search = '';
    expect(devStoreEnabled()).toBe(true);
  });

  it('forgets it when asked to', () => {
    enterBrowser('?devStore=1');
    expect(devStoreEnabled()).toBe(true);
    (globalThis as any).window.location.search = '?devStore=0';
    expect(devStoreEnabled()).toBe(false);
    (globalThis as any).window.location.search = '';
    expect(devStoreEnabled()).toBe(false);
  });

  it('is off on a page that never asked', () => {
    enterBrowser('');
    expect(devStoreEnabled()).toBe(false);
  });

  it('is off inside Tauri even when asked', () => {
    enterBrowser('?devStore=1');
    (globalThis as any).window.__TAURI_INTERNALS__ = {};
    expect(devStoreEnabled()).toBe(false);
  });

  it('keeps what the storage layer writes, which is the whole point', async () => {
    enterBrowser('?devStore=1');
    const { StorageUtil } = await import('@/lib/storage');

    expect(
      await StorageUtil.setItem(
        'providers',
        [{ name: 'OpenAI' }],
        'dev-store-fixture.json',
      ),
    ).toBe(true);
    expect(
      await StorageUtil.getItem('providers', [], 'dev-store-fixture.json'),
    ).toEqual([{ name: 'OpenAI' }]);
  });

  it('still writes nothing in a production build', async () => {
    enterBrowser('?devStore=1');
    vi.stubEnv('NODE_ENV', 'production');
    const { StorageUtil } = await import('@/lib/storage');

    expect(
      await StorageUtil.setItem('providers', [], 'dev-prod-fixture.json'),
    ).toBe(false);
  });
});

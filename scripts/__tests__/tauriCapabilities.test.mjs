import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

function readTauriJson(path) {
  const file = new URL(`../../src-tauri/${path}`, import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

function mainWindowPermissions(platform) {
  const base = readTauriJson('tauri.conf.json');
  const override = readTauriJson(`tauri.${platform.toLowerCase()}.conf.json`);
  const selected =
    override.app?.security?.capabilities ?? base.app.security.capabilities;
  return readdirSync(new URL('../../src-tauri/capabilities/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => readTauriJson(`capabilities/${file}`))
    .filter(
      (capability) =>
        selected.includes(capability.identifier) &&
        capability.windows?.includes('main') &&
        (!capability.platforms || capability.platforms.includes(platform)),
    )
    .flatMap((capability) => capability.permissions);
}

it('keeps app-private storage and provider HTTP on Android without granting desktop actions', () => {
  const android = mainWindowPermissions('android');
  expect(android).toEqual(
    expect.arrayContaining([
      'sql:allow-execute',
      'store:default',
      'fs:scope-appconfig',
      expect.objectContaining({
        identifier: 'fs:scope',
        allow: expect.arrayContaining([
          { path: '$APPDATA' },
          { path: '$APPDATA/**/*' },
        ]),
      }),
      {
        identifier: 'http:default',
        allow: expect.arrayContaining([
          { url: 'https://*' },
          { url: 'http://localhost:*' },
          { url: 'http://127.0.0.1:*' },
        ]),
      },
    ]),
  );
  const desktopOnly =
    /^(core:(tray|menu):|core:window:allow-(hide|set-size|start-dragging)|updater:|window-state:|process:|shell:|upload:)/;
  expect(
    android
      .map((permission) =>
        typeof permission === 'string' ? permission : permission.identifier,
      )
      .filter((identifier) => desktopOnly.test(identifier)),
  ).toEqual([]);
  expect(
    android.find((permission) => permission.identifier === 'http:default')
      .allow,
  ).not.toContainEqual({ url: 'http://*:*' });

  for (const desktop of ['linux', 'macOS', 'windows']) {
    expect(mainWindowPermissions(desktop)).toEqual(
      expect.arrayContaining([
        'core:tray:default',
        'core:window:allow-start-dragging',
        'updater:default',
        'window-state:default',
        expect.objectContaining({
          identifier: 'http:default',
          allow: expect.arrayContaining([{ url: 'http://*:*' }]),
        }),
      ]),
    );
  }
});

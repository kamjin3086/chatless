#!/usr/bin/env node
/**
 * Refuse to build while a dev server holds the same output directory (2026-10-20).
 *
 * `next.config.ts` points `distDir` at `dist` for both `next dev` and `next build`, so a build
 * started while dev is running writes over the dev server's state: the build prints "Creating an
 * optimized production build ..." for a quarter of an hour and then dies, and dev afterwards
 * serves 500s until `dist` is deleted. This turn cost fifteen minutes and a corrupted dev server.
 *
 * Ten lines, checked before the build starts. Port 3000 is the dev URL from `tauri.conf.json`.
 */
import net from 'node:net';

const PORT = Number(process.env.CHATLESS_DEV_PORT || 3000);
const TIMEOUT_MS = 500;

const socket = net.connect({ port: PORT, host: '127.0.0.1' });
const done = (listening) => {
  socket.destroy();
  if (!listening) process.exit(0);
  console.error(
    `refusing to build: something is listening on :${PORT} (a dev server shares distDir with the build).\n` +
      'Stop `pnpm dev` / `pnpm tauri dev` first, then build. Deleting `dist` is what recovers a dev server that already lost this race.',
  );
  process.exit(1);
};
socket.setTimeout(TIMEOUT_MS);
socket.once('connect', () => done(true));
socket.once('timeout', () => done(false));
socket.once('error', () => done(false));

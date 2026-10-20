/**
 * `pnpm dev`, plus a warm-up of the routes the window lands on.
 *
 * Turbopack compiles a route on first request. Measured here: `/` takes ~11 s cold and `/chat`
 * ~80 s on a bad day, so opening the Tauri window first shows a blank page while the compiler
 * catches up. This starts the dev server, then requests the routes in order as soon as it answers,
 * so the compile overlaps with the cargo build instead of with the user's first look.
 *
 * Opt-in, because it changes nothing when you just want a dev server: `pnpm dev:warm`.
 * One warm request in flight at a time - parallel requests would compile in parallel and compete
 * for the same CPU the cargo build is using.
 */
import { spawn } from 'node:child_process';

const PORT = process.env.PORT || 3000;
const WARM_ROUTES = ['/', '/chat'];

const child = spawn('pnpm exec next dev --turbopack', [], { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

let warmed = false;
let inFlight = false;

async function tryWarm() {
  if (warmed || inFlight) return;
  inFlight = true;
  try {
    // A request to `/` returns once that route has compiled, which is the signal we want.
    const response = await fetch(`http://127.0.0.1:${PORT}${WARM_ROUTES[0]}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (response.ok) {
      warmed = true;
      clearInterval(timer);
      console.log(`[dev:warm] ${WARM_ROUTES[0]} ready`);
      for (const route of WARM_ROUTES.slice(1)) {
        await fetch(`http://127.0.0.1:${PORT}${route}`, {
          signal: AbortSignal.timeout(120_000),
        }).catch(() => {});
        console.log(`[dev:warm] ${route} ready`);
      }
    }
  } catch {
    // Not listening yet, or the compile failed - try again on the next tick.
  } finally {
    inFlight = false;
  }
}

const timer = setInterval(() => {
  void tryWarm();
  if (child.exitCode !== null) {
    clearInterval(timer);
    process.exit(child.exitCode);
  }
}, 300);

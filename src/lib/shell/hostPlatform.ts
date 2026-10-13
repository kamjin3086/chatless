/**
 * Which operating system is this app actually running on.
 *
 * The shell plan used to answer that question from `navigator.userAgent` alone. That is
 * a heuristic wearing a fact's clothes: in the agent acceptance harness the runner had
 * announced a Windows user agent on a Linux box, the plan picked `cmd.exe`, every shell
 * task failed to start, and an explicit request for bash was answered with a sentence
 * about Windows. The platform must come from the machine that will spawn the process,
 * so the signals are ranked and the user agent is last.
 */
import { type HostPlatform } from './commandPlan';

export interface PlatformSources {
  /** What the Tauri os plugin reports, when running inside Tauri. */
  tauriPlatform?: string | null;
  /** `process.platform`, present in any Node process including the harness. */
  nodePlatform?: string | null;
  userAgent?: string | null;
}

function normalise(raw: unknown): HostPlatform | null {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'win32' || value === 'windows') return 'windows';
  if (value === 'darwin' || value === 'macos') return 'macos';
  if (value === 'linux' || value === 'freebsd' || value === 'openbsd') {
    return 'linux';
  }
  return null;
}

/**
 * Ranked resolution. Anything earlier in the list wins, because it is closer to the
 * process being spawned: a real Tauri report beats Node, and Node beats a string a
 * browser announces about itself.
 */
export function resolveHostPlatform(
  sources: PlatformSources,
): HostPlatform | null {
  const fromTauri = normalise(sources.tauriPlatform);
  if (fromTauri) return fromTauri;

  const fromNode = normalise(sources.nodePlatform);
  if (fromNode) return fromNode;

  const ua = String(sources.userAgent ?? '').toLowerCase();
  if (!ua) return null;
  if (/windows nt|win64|win32|wow64/.test(ua)) return 'windows';
  if (/mac os x|macos|macintosh|darwin/.test(ua)) return 'macos';
  if (/linux|x11|android|freebsd/.test(ua)) return 'linux';
  return null;
}

let cached: HostPlatform | null = null;

async function readTauriPlatform(): Promise<string | null> {
  try {
    const mod: any = await import('@tauri-apps/plugin-os');
    return typeof mod?.platform === 'function' ? String(mod.platform()) : null;
  } catch {
    // Not running under Tauri (tests, plain browser): no signal, not an error.
    return null;
  }
}

/**
 * The platform to plan a command for. Cached, because the answer cannot change while the
 * process lives and the Tauri import is not free.
 */
export async function hostPlatform(): Promise<HostPlatform> {
  if (cached) return cached;
  const resolved = resolveHostPlatform({
    tauriPlatform: await readTauriPlatform(),
    nodePlatform:
      typeof process !== 'undefined' ? (process as any)?.platform : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  // Nothing said anything usable. Non-Windows is the safe guess: a wrong guess on this
  // side costs one failed command, while guessing Windows costs every shell call.
  cached = resolved ?? 'linux';
  return cached;
}

/**
 * The synchronous half of the same ranking: Node's own platform before a user agent,
 * and no Tauri import because the caller may be in a synchronous path. A plan built
 * this way is still right on a machine that only disagrees in its user agent - which is
 * exactly the harness bug this module exists to kill.
 */
export function syncHostPlatform(): HostPlatform {
  return (
    resolveHostPlatform({
      nodePlatform:
        typeof process !== 'undefined' ? (process as any)?.platform : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    }) ?? 'linux'
  );
}

/** Test seam: forget the cached answer. */
export function resetHostPlatformCache(): void {
  cached = null;
}

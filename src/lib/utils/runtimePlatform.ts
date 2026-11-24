import { isTauri } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';

export function isAndroidRuntime(): boolean {
  try {
    return platform() === 'android';
  } catch {
    return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  }
}

export function isAndroidTauri(): boolean {
  try {
    return isTauri() && platform() === 'android';
  } catch {
    return false;
  }
}

export function isMobileRuntime(): boolean {
  try {
    const os = platform();
    return os === 'android' || os === 'ios';
  } catch {
    // The OS plugin is not injected outside the Tauri WebView.
    return typeof navigator !== 'undefined' && /android|iphone|ipad/i.test(navigator.userAgent);
  }
}

export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'android' | 'unknown';

/**
 * Best-effort runtime platform detection.
 * - In Tauri: prefers @tauri-apps/plugin-os
 * - In browser/unknown env: falls back to navigator.userAgent heuristics
 */
export async function getRuntimePlatform(): Promise<RuntimePlatform> {
  // 1) Tauri plugin-os (best signal)
  try {
    const mod: any = await import('@tauri-apps/plugin-os');
    const p = typeof mod.platform === 'function' ? mod.platform() : undefined;
    const v = String(p || '').toLowerCase();
    if (v === 'windows') return 'windows';
    if (v === 'macos' || v === 'darwin') return 'macos';
    if (v === 'android') return 'android';
    if (v === 'ios') return 'android';
    if (v === 'linux') return 'linux';
  } catch {
    // ignore
  }

  // 2) Browser heuristics
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('windows')) return 'windows';
      if (ua.includes('mac os') || ua.includes('macintosh') || ua.includes('darwin')) return 'macos';
      // An Android WebView says "Linux; Android 14" in the same breath, so this
      // has to be checked before the bare `linux` below, or the phone reports a
      // desktop Linux and the model starts planning `bash` commands.
      if (ua.includes('android')) return 'android';
      if (ua.includes('iphone') || ua.includes('ipad')) return 'android';
      if (ua.includes('linux')) return 'linux';
    }
  } catch {
    // ignore
  }

  return 'unknown';
}

/**
 * Shell guidance goes straight into the system prompt, so it is written in
 * English: English instructions behaved most consistently across models.
 */
export function getShellGuidance(platform: RuntimePlatform): {
  platformLabel: string;
  /** Absent where there is no shell to call at all. */
  preferredShell?: string;
  rules: string[];
  /** Platform-specific command examples. */
  commandExamples: Record<string, string>;
  /** The desktop filesystem tools are always there; the phone's are conditional. */
  toolNote?: string;
} {
  if (platform === 'windows') {
    return {
      platformLabel: 'Windows',
      preferredShell: 'shell__run requires an explicit shell: "cmd" or "powershell"',
      rules: [
        'The current platform is Windows.',
        'When calling shell__run, always pass the shell parameter explicitly: shell="cmd" or shell="powershell" (never wrap the command in cmd.exe /c or powershell -Command yourself).',
        'cmd fits: dir /b, &&, .bat/.cmd and other cmd semantics.',
        'powershell fits: Get-ChildItem, Remove-Item, $env: and other PowerShell semantics.',
      ],
      commandExamples: {
        'cmd: list a directory': 'shell__run({ shell: "cmd", command: "dir \\"path\\" /b" })',
        'cmd: copy a file': 'shell__run({ shell: "cmd", command: "copy \\"source\\" \\"target\\"" })',
        'powershell: list a directory': 'shell__run({ shell: "powershell", command: "Get-ChildItem -Path \\"path\\"" })',
        'powershell: delete a directory': 'shell__run({ shell: "powershell", command: "Remove-Item -Path \\"path\\" -Recurse -Force" })',
        'run python': 'shell__run({ shell: "cmd", command: "python \\"script path\\"" })',
        'run node': 'shell__run({ shell: "cmd", command: "node \\"script path\\"" })',
      },
      toolNote: 'Prefer fs__mkdir over a shell command when creating a directory.',
    };
  }
  if (platform === 'macos') {
    return {
      platformLabel: 'macOS',
      preferredShell: 'shell__run uses shell: "bash"',
      rules: [
        'The current platform is macOS.',
        'When calling shell__run, always pass shell="bash" (do not guess, do not add another layer of wrapping).',
        'Quote paths that contain spaces with double quotes.',
      ],
      commandExamples: {
        'list a directory': 'shell__run({ shell: "bash", command: "ls -la \\"path\\"" })',
        'create a directory': 'shell__run({ shell: "bash", command: "mkdir -p \\"path\\"" })',
        'delete a directory': 'shell__run({ shell: "bash", command: "rm -rf \\"path\\"" })',
        'read a file': 'shell__run({ shell: "bash", command: "cat \\"path\\"" })',
      },
      toolNote: 'Prefer fs__mkdir over a shell command when creating a directory.',
    };
  }
  if (platform === 'linux') {
    return {
      platformLabel: 'Linux',
      preferredShell: 'shell__run uses shell: "bash"',
      rules: [
        'The current platform is Linux.',
        'When calling shell__run, always pass shell="bash" (do not guess, do not add another layer of wrapping).',
        'Quote paths that contain spaces with double quotes.',
      ],
      commandExamples: {
        'list a directory': 'shell__run({ shell: "bash", command: "ls -la \\"path\\"" })',
        'create a directory': 'shell__run({ shell: "bash", command: "mkdir -p \\"path\\"" })',
        'delete a directory': 'shell__run({ shell: "bash", command: "rm -rf \\"path\\"" })',
        'read a file': 'shell__run({ shell: "bash", command: "cat \\"path\\"" })',
      },
      toolNote: 'Prefer fs__mkdir over a shell command when creating a directory.',
    };
  }
  if (platform === 'android') {
    return {
      platformLabel: 'Android',
      rules: [
        'This app runs on an Android phone or tablet - not a desktop, and not a Linux server.',
        'There is no shell here: do not call shell__run, do not run ls / cat / mkdir / find, and do not ssh somewhere to reach the user\'s files.',
        'There is no home directory and no "~". Paths like ~/Downloads, ~\Download or C:\\Users do not exist on this device.',
        'Files are reachable only through the tools this chat gives you (the folder, photo and document tools). A folder is readable only after the user hands it over from the attachment menu.',
        'An authorized folder is named by the user, not by the file system. Call android_directory__inventory with no arguments to see which folders exist and what they are called; pass `root` only with a name from that list - never a path, and never an empty string.',
        'Every entry carries a `path` under its folder, so nested folders are visible. To read inside one subfolder, pass `under` with that name path (for example "合同/2024") or a folder handle from a previous result; a wrong name answers with the subfolders that exist. A listing stopped at its entry limit says so: read subfolders one at a time instead of reading the whole folder again.',
        'When the user asks about a directory you cannot see, say which folder you need and ask them to attach it. Do not guess paths, and do not retry a path that just failed.',
      ],
      commandExamples: {},
    };
  }
  return {
    platformLabel: 'Unknown',
    preferredShell: 'unknown',
    rules: [
      'The platform is unknown: prefer the filesystem tools. If a command is unavoidable, determine the platform before choosing a shell.',
    ],
    commandExamples: {},
    toolNote: 'Prefer fs__mkdir over a shell command when creating a directory.',
  };
}

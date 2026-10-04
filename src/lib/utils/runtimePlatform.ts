export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'unknown';

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
  preferredShell: string;
  rules: string[];
  /** Platform-specific command examples. */
  commandExamples: Record<string, string>;
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
    };
  }
  return {
    platformLabel: 'Unknown',
    preferredShell: 'unknown',
    rules: [
      'The platform is unknown: prefer the filesystem tools. If a command is unavoidable, determine the platform before choosing a shell.',
    ],
    commandExamples: {},
  };
}

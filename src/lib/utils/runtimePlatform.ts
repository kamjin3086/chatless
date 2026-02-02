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

export function getShellGuidance(platform: RuntimePlatform): {
  platformLabel: string;
  preferredShell: string;
  rules: string[];
  /** 平台特定的命令示例 */
  commandExamples: Record<string, string>;
} {
  if (platform === 'windows') {
    return {
      platformLabel: 'Windows',
      preferredShell: 'shell__run 需显式指定 shell: "cmd" 或 "powershell"',
      rules: [
        '当前是 Windows 系统。',
        '调用 shell__run 时，必须显式传入 shell 参数：shell="cmd" 或 shell="powershell"（不要手写 cmd.exe /c 或 powershell -Command）。',
        'cmd 适合：dir /b、&&、.bat/.cmd 等 cmd 语义。',
        'powershell 适合：Get-ChildItem、Remove-Item、$env: 等 PowerShell 语义。',
      ],
      commandExamples: {
        'cmd 列目录（简洁）': 'shell__run({ shell: "cmd", command: "dir \\"路径\\" /b" })',
        'cmd 复制文件': 'shell__run({ shell: "cmd", command: "copy \\"源\\" \\"目标\\"" })',
        'PowerShell 列目录': 'shell__run({ shell: "powershell", command: "Get-ChildItem -Path \\"路径\\"" })',
        'PowerShell 删除目录': 'shell__run({ shell: "powershell", command: "Remove-Item -Path \\"路径\\" -Recurse -Force" })',
        '运行 Python': 'shell__run({ shell: "cmd", command: "python \\"脚本路径\\"" })',
        '运行 Node': 'shell__run({ shell: "cmd", command: "node \\"脚本路径\\"" })',
      },
    };
  }
  if (platform === 'macos') {
    return {
      platformLabel: 'macOS',
      preferredShell: 'shell__run 使用 shell: "bash"',
      rules: [
        '当前是 macOS 系统。',
        '调用 shell__run 时，必须显式传入 shell="bash"（不要猜测/不要包多层）。',
        '路径含空格用双引号包裹。',
      ],
      commandExamples: {
        '列目录': 'shell__run({ shell: "bash", command: "ls -la \\"路径\\"" })',
        '创建目录': 'shell__run({ shell: "bash", command: "mkdir -p \\"路径\\"" })',
        '删除目录': 'shell__run({ shell: "bash", command: "rm -rf \\"路径\\"" })',
        '读文件': 'shell__run({ shell: "bash", command: "cat \\"路径\\"" })',
      },
    };
  }
  if (platform === 'linux') {
    return {
      platformLabel: 'Linux',
      preferredShell: 'shell__run 使用 shell: "bash"',
      rules: [
        '当前是 Linux 系统。',
        '调用 shell__run 时，必须显式传入 shell="bash"（不要猜测/不要包多层）。',
        '路径含空格用双引号包裹。',
      ],
      commandExamples: {
        '列目录': 'shell__run({ shell: "bash", command: "ls -la \\"路径\\"" })',
        '创建目录': 'shell__run({ shell: "bash", command: "mkdir -p \\"路径\\"" })',
        '删除目录': 'shell__run({ shell: "bash", command: "rm -rf \\"路径\\"" })',
        '读文件': 'shell__run({ shell: "bash", command: "cat \\"路径\\"" })',
      },
    };
  }
  return {
    platformLabel: 'Unknown',
    preferredShell: 'unknown',
    rules: [
      '当前平台未知：优先使用 filesystem 工具；如必须执行命令，请先确定平台后再选择 shell。',
    ],
    commandExamples: {},
  };
}


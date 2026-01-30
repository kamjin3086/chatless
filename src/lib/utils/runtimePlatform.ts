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
      preferredShell: 'PowerShell',
      rules: [
        '当前是 Windows 系统，使用 PowerShell 命令',
        '必须用 powershell -Command "..." 执行 PowerShell cmdlet',
        '路径用双引号包裹，内部单引号用于字符串',
        '❌ 禁止 Unix 命令: mkdir -p, rm -rf, cat, ls, curl, wget',
      ],
      commandExamples: {
        '创建目录': 'powershell -Command "New-Item -ItemType Directory -Path \'路径\' -Force"',
        '删除目录': 'powershell -Command "Remove-Item -Path \'路径\' -Recurse -Force"',
        '删除文件': 'powershell -Command "Remove-Item -Path \'路径\' -Force"',
        '复制文件': 'powershell -Command "Copy-Item -Path \'源\' -Destination \'目标\'"',
        '移动文件': 'powershell -Command "Move-Item -Path \'源\' -Destination \'目标\'"',
        '列目录': 'powershell -Command "Get-ChildItem -Path \'路径\'"',
        '读文件': 'powershell -Command "Get-Content -Path \'路径\'"',
        '下载文件': 'powershell -Command "Invoke-WebRequest -Uri \'URL\' -OutFile \'保存路径\'"',
        '运行Python': 'python "脚本路径"',
        '运行Node': 'node "脚本路径"',
      },
    };
  }
  if (platform === 'macos') {
    return {
      platformLabel: 'macOS',
      preferredShell: 'zsh/bash',
      rules: [
        '当前是 macOS 系统，使用 Unix 命令',
        '路径含空格用双引号包裹',
        '支持: mkdir -p, rm -rf, cat, grep, ls, curl 等',
      ],
      commandExamples: {
        '创建目录': 'mkdir -p "路径"',
        '删除目录': 'rm -rf "路径"',
        '删除文件': 'rm -f "路径"',
        '复制文件': 'cp "源" "目标"',
        '移动文件': 'mv "源" "目标"',
        '列目录': 'ls -la "路径"',
        '读文件': 'cat "路径"',
        '下载文件': 'curl -L -o "保存路径" "URL"',
        '运行Python': 'python3 "脚本路径"',
        '运行Node': 'node "脚本路径"',
      },
    };
  }
  if (platform === 'linux') {
    return {
      platformLabel: 'Linux',
      preferredShell: 'bash',
      rules: [
        '当前是 Linux 系统，使用 Unix 命令',
        '路径含空格用双引号包裹',
        '支持: mkdir -p, rm -rf, cat, grep, ls, curl, wget 等',
      ],
      commandExamples: {
        '创建目录': 'mkdir -p "路径"',
        '删除目录': 'rm -rf "路径"',
        '删除文件': 'rm -f "路径"',
        '复制文件': 'cp "源" "目标"',
        '移动文件': 'mv "源" "目标"',
        '列目录': 'ls -la "路径"',
        '读文件': 'cat "路径"',
        '下载文件': 'curl -L -o "保存路径" "URL"',
        '运行Python': 'python3 "脚本路径"',
        '运行Node': 'node "脚本路径"',
      },
    };
  }
  return {
    platformLabel: 'Unknown',
    preferredShell: 'unknown',
    rules: [
      '当前平台未知：优先使用 filesystem 工具',
    ],
    commandExamples: {},
  };
}


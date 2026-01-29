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
} {
  if (platform === 'windows') {
    return {
      platformLabel: 'Windows',
      preferredShell: 'PowerShell',
      rules: [
        '优先生成 PowerShell 兼容命令（而不是 bash/zsh）。',
        '路径用双引号包裹（例如 `"C:\\Users\\User\\file.txt"`），避免空格导致失败。',
        '路径风格：Windows 绝对路径以盘符开头（如 `C:/Users/...` 或 `D:/...`）；本项目内部常用 `/` 作为分隔符（推荐 `C:/...` 这种写法，避免 `\\` 转义）。',
        '若涉及管道/重定向/变量，使用 PowerShell 语法（例如 `$env:VAR`、`Get-ChildItem`、`Set-Content`）。',
      ],
    };
  }
  if (platform === 'macos') {
    return {
      platformLabel: 'macOS',
      preferredShell: 'bash/zsh',
      rules: [
        '优先生成 POSIX shell（bash/zsh）命令。',
        '路径含空格要用双引号包裹（例如 `"/Users/name/My Documents/file.txt"`）。',
      ],
    };
  }
  if (platform === 'linux') {
    return {
      platformLabel: 'Linux',
      preferredShell: 'bash',
      rules: [
        '优先生成 bash 命令。',
        '路径含空格要用双引号包裹。',
      ],
    };
  }
  return {
    platformLabel: 'Unknown',
    preferredShell: 'unknown',
    rules: [
      '当前平台未知：生成命令前先用最少工具探测（或改用 filesystem 直接操作）。',
    ],
  };
}


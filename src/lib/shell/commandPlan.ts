/**
 * How a shell command is turned into a real process.
 *
 * `run` (blocking) and `start` (background) must behave identically: the whole
 * command line goes to one interpreter, chosen explicitly by the model or by
 * the platform default. No argument splitting and no guessing an interpreter
 * from keywords: a command that works in `run` has to work in `start`.
 */

export type ShellKind = 'cmd' | 'powershell' | 'bash';
export type ShellMode = ShellKind | 'auto' | 'pwsh';
export type HostPlatform = 'windows' | 'macos' | 'linux';

export const SHELL_MODES: readonly ShellMode[] = ['auto', 'cmd', 'powershell', 'pwsh', 'bash'];

export interface CommandPlan {
  /** Executable to spawn. */
  file: string;
  /** Arguments, including the untouched command line as a single argument. */
  args: string[];
  /** Interpreter the plan resolved to. */
  shell: ShellKind;
  /** True when the caller did not pick one and the platform default was used. */
  autoSelected: boolean;
}

export type CommandPlanResult =
  | { ok: true; plan: CommandPlan }
  | { ok: false; code: string; message: string; hints: string[] };

export function detectPlatform(userAgent?: string): HostPlatform {
  const ua = String(userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')).toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  return 'linux';
}

export function defaultShellFor(platform: HostPlatform): ShellKind {
  return platform === 'windows' ? 'cmd' : 'bash';
}

/**
 * Validates the `shell` argument and builds the spawn plan. Invalid values and
 * unsupported platform combinations come back as structured results, so the
 * model can correct itself instead of the call failing as an exception.
 */
export function planCommand(params: { command: unknown; shell?: unknown; platform?: HostPlatform }): CommandPlanResult {
  const platform = params.platform ?? detectPlatform();
  const command = String(params.command ?? '');
  if (!command.trim()) {
    return { ok: false, code: 'INVALID_ARGUMENTS', message: 'command is required', hints: [] };
  }

  const rawMode = String(params.shell ?? '').trim().toLowerCase();
  if (rawMode && !SHELL_MODES.includes(rawMode as ShellMode)) {
    return {
      ok: false,
      code: 'SHELL_INVALID',
      message:
        `shell 参数不合法：${String(params.shell)}。允许值：auto/cmd/powershell/pwsh/bash。` +
        '注意：shell 是命令解释器类型，不是运行时（不要填 node/python）。',
      hints: [
        '想运行 Node：command 写 "node your-script.js"，shell 保持默认（Windows 为 cmd）',
        '包含 cd / && / | / 重定向等语法时，整行命令会原样交给解释器，无需自行加引号包裹',
      ],
    };
  }

  const mode = (rawMode || 'auto') as ShellMode;
  const autoSelected = mode === 'auto';
  const shell: ShellKind = mode === 'auto' ? defaultShellFor(platform) : mode === 'pwsh' ? 'powershell' : mode;

  if (platform === 'windows' && shell === 'bash') {
    return {
      ok: false,
      code: 'SHELL_UNSUPPORTED',
      message: 'Windows 上不支持 shell=bash。请改用 shell="cmd" 或 shell="powershell"。',
      hints: ['cmd 适合 dir /b、&&、.bat/.cmd', 'powershell 适合 Get-ChildItem、Remove-Item、$env:'],
    };
  }
  if (platform !== 'windows' && shell !== 'bash') {
    return {
      ok: false,
      code: 'SHELL_UNSUPPORTED',
      message: 'macOS/Linux 上不支持 shell=cmd/powershell。请改用 shell="bash"。',
      hints: ['macOS/Linux 用 bash -lc 执行整行命令'],
    };
  }

  if (shell === 'cmd') {
    return { ok: true, plan: { file: 'cmd.exe', args: ['/d', '/s', '/c', command], shell, autoSelected } };
  }
  if (shell === 'powershell') {
    // `pwsh` exists on the PATH only on some machines; powershell.exe ships with
    // Windows. Keep the explicit pwsh request when the caller made it.
    const file = mode === 'pwsh' ? 'pwsh' : 'powershell.exe';
    return {
      ok: true,
      plan: { file, args: ['-NoProfile', '-NonInteractive', '-Command', command], shell, autoSelected },
    };
  }
  return { ok: true, plan: { file: 'bash', args: ['-lc', command], shell, autoSelected } };
}

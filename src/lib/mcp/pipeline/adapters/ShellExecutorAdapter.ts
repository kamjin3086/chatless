import { getProcessSandbox } from '@/lib/skills/sandbox';
import { SHELL_EXECUTOR_SERVER_NAME } from '@/lib/mcp/nativeTools/shellExecutor';
import { buildWindowsNodeInstallHint, getAgentExperienceConfig } from '@/lib/mcp/experience/agentExperienceConfig';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';
import { shouldUseScriptMode, parseScriptRequest, executeScript } from '@/lib/shell/scriptExecutor';
import { buildFatalErrorHints } from '@/lib/mcp/pipeline/toolResultDiagnostics';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

function normalizeEscapedQuotesForParsing(input: string): string {
  const s = String(input || '');
  // 兼容“多一层转义”的命令：如果命令里大量出现 \" 但几乎没有 "，
  // 大概率是模型把引号又转义了一次。此处仅用于解析与分词，不改变语义。
  if (s.includes('\\"') && !s.includes('"')) {
    return s.replace(/\\"/g, '"');
  }
  if (s.includes("\\'") && !s.includes("'")) {
    return s.replace(/\\'/g, "'");
  }
  return s;
}

/**
 * 将一行命令拆成 argv，支持单/双引号。
 * - 目的：避免 `python -c "..."` / `node -e "..."` 被错误按空格拆碎
 * - 注意：这里做的是“参数级”拆分，不执行 shell 语义（不展开变量/通配符）
 */
function splitCommandLine(input: string): string[] {
  const s = String(input || '').trim();
  if (!s) return [];

  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }

    // 仅在双引号内处理反斜杠转义（兼容 \"）
    if (ch === '\\' && inDouble) {
      escape = true;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue; // 去掉引号本身
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue; // 去掉引号本身
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }

    cur += ch;
  }

  if (escape) cur += '\\';
  if (cur) out.push(cur);
  return out;
}

export class ShellExecutorAdapter implements ToolAdapter {
  readonly server = SHELL_EXECUTOR_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === SHELL_EXECUTOR_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const args = invocation.args || {};
    const command = typeof (args as any).command === 'string' ? String((args as any).command) : '';
    if (!command.trim()) throw new Error('command is required');
    const shellModeRaw = typeof (args as any).shell === 'string' ? String((args as any).shell) : '';

    const sandbox = getProcessSandbox();
    const isAvailable = await sandbox.isAvailable();
    if (!isAvailable) throw new Error('Shell executor is not available');

    const workingDir = typeof (args as any).workingDir === 'string' ? String((args as any).workingDir) : undefined;
    const timeoutMs = typeof (args as any).timeout === 'number' ? (args as any).timeout : 30000;

    // ========== 脚本模式（最高优先级）==========
    // 如果命令是脚本格式（代码块或 JSON），直接执行脚本
    if (shouldUseScriptMode(command)) {
      const scriptReq = parseScriptRequest(command);
      if (scriptReq) {
        console.log(`[ShellExecutor] 脚本模式: ${scriptReq.language}, ${scriptReq.code.length} chars`);
        
        const result = await executeScript({
          ...scriptReq,
          workingDir,
          timeoutMs,
        });
        
        return {
          success: result.success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration: result.duration,
          error: result.error,
          mode: 'script',
          scriptPath: result.scriptPath,
        };
      }
    }

    // ========== 原生命令处理 ==========
    // AI 应根据平台生成正确的原生命令（Unix 或 PowerShell）
    const normalizedForParsing = normalizeEscapedQuotesForParsing(command);
    const parts = splitCommandLine(normalizedForParsing);
    if (parts.length === 0) throw new Error('command is required');
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    // 统一 allowlist：shell_executor 的 allowedWorkingDirs 以 filesystem allowlist 为准（+ appData 默认工作区）
    try {
      const st = useFilesystemAllowlistStore.getState();
      await st.load();
      const dirs = (st.directories || []).map((d) => String(d.path || '').replace(/\\/g, '/'));
      // 确保会话 @WorkDir 也在允许范围
      try {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        const wd = useConversationAttachmentStore.getState().getWorkingDir(invocation.conversationId);
        if (wd) dirs.unshift(String(wd).replace(/\\/g, '/'));
      } catch {
        // ignore
      }
      sandbox.setAllowedWorkingDirs(dirs);
    } catch {
      // ignore: best-effort
    }

    const base = cmd.toLowerCase();
    const needsNodeRuntime = base === 'node' || base === 'npm' || base === 'pnpm' || base === 'npx' || base === 'yarn';
    if (needsNodeRuntime) {
      const env = await sandbox.checkEnvironment('node');
      if (!env.available) {
        const cfg = await getAgentExperienceConfig();
        const hint = [env.error, env.installHint, env.downloadUrl].filter(Boolean).join('\n');
        const plan = buildWindowsNodeInstallHint(cfg.windowsRuntimeInstallStrategy);
        throw new Error(
          [`Node.js 运行时不可用，无法执行：${cmd}`, hint || '', plan].filter(Boolean).join('\n').trim()
        );
      }
    }

    const tryExecute = async (c: string) =>
      sandbox.execute({
        command: c,
        args: cmdArgs,
        workingDir,
        timeoutMs,
      }, {
        executionId: `shell:${invocation.assistantMessageId}:${invocation.ensureCardId()}`,
        startTime: Date.now(),
        conversationId: invocation.conversationId,
      });

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isWindows = ua.includes('win');
    const isMac = ua.includes('mac');
    const isLinux = ua.includes('linux') && !isWindows && !isMac;
    const base2 = base;
    const shellMode = String(shellModeRaw || '').trim().toLowerCase();

    // 建设前期：避免 auto 带来的不确定性，强制要求显式指定 shell
    if (!shellMode) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        duration: 0,
        error: 'shell is required',
        errorDetails: {
          code: 'SHELL_NOT_SPECIFIED',
          message: 'shell 参数缺失。请显式指定 shell（Windows: cmd/powershell；macOS/Linux: bash）。',
          hints: [
            'Windows + cmd 语法（dir /b、&&、.bat/.cmd）→ shell: "cmd"',
            'Windows + PowerShell 语法（Get-ChildItem、Remove-Item、$env:）→ shell: "powershell"',
            'macOS/Linux → shell: "bash"',
          ],
        },
      };
    }

    // 显式 shell（确定性最高）：不做 fallback，只按指定执行
    if (isWindows && shellMode === 'cmd') {
      const r = await sandbox.execute({
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', normalizedForParsing],
        workingDir,
        timeoutMs,
      }, {
        executionId: `shell:${invocation.assistantMessageId}:${invocation.ensureCardId()}`,
        startTime: Date.now(),
        conversationId: invocation.conversationId,
      });
      return {
        success: r.success,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        duration: r.duration,
        error: r.error,
        note: '已按 shell=cmd 执行。',
      };
    }
    if (isWindows && (shellMode === 'powershell' || shellMode === 'pwsh')) {
      const r = await sandbox.execute({
        command: 'powershell.exe',
        args: ['-NoProfile', '-Command', normalizedForParsing],
        workingDir,
        timeoutMs,
      }, {
        executionId: `shell:${invocation.assistantMessageId}:${invocation.ensureCardId()}`,
        startTime: Date.now(),
        conversationId: invocation.conversationId,
      });
      return {
        success: r.success,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        duration: r.duration,
        error: r.error,
        note: '已按 shell=powershell 执行。',
      };
    }

    if ((isMac || isLinux) && shellMode === 'bash') {
      const r = await sandbox.execute(
        { command: 'bash', args: ['-lc', normalizedForParsing], workingDir, timeoutMs },
        {
          executionId: `shell:${invocation.assistantMessageId}:${invocation.ensureCardId()}`,
          startTime: Date.now(),
          conversationId: invocation.conversationId,
        }
      );
      return {
        success: r.success,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        duration: r.duration,
        error: r.error,
        note: '已按 shell=bash 执行。',
      };
    }

    // 平台/执行器不匹配：明确返回错误（不做 fallback）
    if (isWindows && shellMode === 'bash') {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        duration: 0,
        error: 'bash is not supported on Windows',
        errorDetails: {
          code: 'SHELL_UNSUPPORTED',
          message: 'Windows 上不支持 shell=bash。请改用 shell="cmd" 或 shell="powershell"。',
          hints: ['cmd 适合 dir /b、&&、.bat/.cmd', 'powershell 适合 Get-ChildItem、Remove-Item、$env:'],
        },
      };
    }
    if ((isMac || isLinux) && (shellMode === 'cmd' || shellMode === 'powershell' || shellMode === 'pwsh')) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        duration: 0,
        error: 'cmd/powershell is not supported on this platform',
        errorDetails: {
          code: 'SHELL_UNSUPPORTED',
          message: 'macOS/Linux 上不支持 shell=cmd/powershell。请改用 shell="bash"。',
          hints: ['macOS/Linux → shell: "bash"（用 -lc 执行整行命令）'],
        },
      };
    }

    let result = await tryExecute(cmd);

    // Windows: 一些命令（npm/pnpm/npx/yarn）通常是 *.cmd shim；后端不一定能用裸名解析到
    const programNotFound = String((result as any).error || '').toLowerCase().includes('program not found');
    if (isWindows && programNotFound && !cmd.includes('.') && (base2 === 'npm' || base2 === 'pnpm' || base2 === 'npx' || base2 === 'yarn')) {
      result = await tryExecute(`${cmd}.cmd`);
    }

    let note: string | undefined;
    if (!workingDir && (base === 'npm' || base === 'pnpm' || base === 'yarn' || base === 'npx')) {
      note =
        '提示：未提供 workingDir。若命令依赖项目目录（如安装依赖/运行脚本），建议显式传入工作目录以避免在默认 appData 目录执行。';
    }

    const out = {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      error: result.error,
      note,
    } as any;

    // 更好的错误指引：program not found（系统会自动包裹内置命令，但仍可能遇到 PATH/沙箱限制）
    if (out.success === false) {
      const msg = String(out.error || out.stderr || '').trim();
      const hints = buildFatalErrorHints({ server: 'shell', tool: 'run' } as any, msg);
      if (programNotFound && isWindows) {
        hints.unshift('Windows 上部分命令是系统内置命令：请直接写原命令（系统会自动处理）。若仍失败，多半是 PATH/沙箱限制或工作目录不允许。');
      }
      out.errorDetails = { code: 'SHELL_COMMAND_FAILED', message: msg || 'command failed', hints };
    }
    return out;
  }
}


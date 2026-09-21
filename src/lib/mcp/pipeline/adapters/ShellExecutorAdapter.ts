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
    const toolName = String(invocation.tool || '').toLowerCase();
    const sandboxForManaged = getProcessSandbox();

    // Background processes: start / logs / stop / list.
    if (toolName === 'start') {
      const command = typeof (args as any).command === 'string' ? String((args as any).command).trim() : '';
      if (!command) throw new Error('command is required');
      const parts = splitCommandLine(command);
      if (parts.length === 0) throw new Error('command is required');
      // Same id namespace the pipeline registers for cancellation, so stopping
      // a run also stops the processes it started.
      const executionId = `shell:${invocation.assistantMessageId}:${invocation.ensureCardId()}`;
      try {
        const started = await sandboxForManaged.startManagedProcess({
          executionId,
          command: parts[0],
          args: parts.slice(1),
          workingDir: typeof (args as any).workingDir === 'string' ? String((args as any).workingDir) : undefined,
        });
        return {
          ok: true,
          executionId: started.executionId,
          pid: started.pid,
          command,
          name: typeof (args as any).name === 'string' ? String((args as any).name) : undefined,
          message: '进程已在后台启动。用 shell__logs 读取输出，用 shell__stop 停止。',
        };
      } catch (error) {
        return { ok: false, error: { code: 'START_FAILED', message: error instanceof Error ? error.message : String(error) } };
      }
    }

    if (toolName === 'logs') {
      const executionId = String((args as any).executionId || '').trim();
      if (!executionId) return { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'executionId is required' } };
      const limit = typeof (args as any).limit === 'number' ? Number((args as any).limit) : undefined;
      try {
        return { ok: true, ...(await sandboxForManaged.readManagedProcess(executionId, limit)) };
      } catch (error) {
        return { ok: false, error: { code: 'LOGS_FAILED', message: error instanceof Error ? error.message : String(error) } };
      }
    }

    if (toolName === 'stop') {
      const executionId = String((args as any).executionId || '').trim();
      if (!executionId) return { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'executionId is required' } };
      try {
        const stopped = await sandboxForManaged.stopManagedProcess(executionId);
        return { ok: true, ...stopped };
      } catch (error) {
        return { ok: false, error: { code: 'STOP_FAILED', message: error instanceof Error ? error.message : String(error) } };
      }
    }

    if (toolName === 'list') {
      try {
        return { ok: true, processes: await sandboxForManaged.listManagedProcesses() };
      } catch (error) {
        return { ok: false, error: { code: 'LIST_FAILED', message: error instanceof Error ? error.message : String(error) } };
      }
    }

    const command = typeof (args as any).command === 'string' ? String((args as any).command) : '';
    if (!command.trim()) throw new Error('command is required');
    const shellModeRaw =
      typeof (args as any).shell === 'string'
        ? String((args as any).shell)
        : typeof (args as any).shell_type === 'string'
          ? String((args as any).shell_type)
          : typeof (args as any).shellType === 'string'
            ? String((args as any).shellType)
            : '';

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

    const ALLOWED_SHELLS = new Set(['auto', 'cmd', 'powershell', 'pwsh', 'bash']);
    if (shellMode && !ALLOWED_SHELLS.has(shellMode)) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        duration: 0,
        error: `invalid shell: ${shellModeRaw}`,
        errorDetails: {
          code: 'SHELL_INVALID',
          message:
            `shell 参数不合法：${shellModeRaw}。` +
            `允许值：auto/cmd/powershell/pwsh/bash。` +
            `注意：shell 是“命令解释器类型”，不是运行时（不要填 node/python）。`,
          hints: [
            '想运行 Node：用 command 写 "node your-script.js"，shell 选 cmd/powershell/auto（Windows）或 bash/auto（macOS/Linux）',
            '包含 cd / && / | / 重定向 等 shell 语法时，建议用 shell=auto 或显式 cmd/powershell/bash',
          ],
        },
      };
    }

    // ========== auto 推断 ==========
    const inferWindowsShell = (raw: string): 'cmd' | 'powershell' => {
      const s = String(raw || '').trim();
      const sl = s.toLowerCase();

      // Windows PowerShell 5.x 不支持 `&&` / `||`；出现时优先用 cmd
      if (sl.includes('&&') || sl.includes('||')) {
        return 'cmd';
      }

      // 明确 PowerShell 语法/关键字
      if (
        sl.includes('$env:') ||
        /\bget-childitem\b/i.test(s) ||
        /\bremove-item\b/i.test(s) ||
        /\bcopy-item\b/i.test(s) ||
        /\bmove-item\b/i.test(s) ||
        /\bnew-item\b/i.test(s) ||
        /\binvoke-webrequest\b/i.test(s) ||
        /\bselect-string\b/i.test(s)
      ) {
        return 'powershell';
      }

      // 明确 cmd 语法（%VAR%、/b 这类开关、set VAR=...）
      if (/%[a-zA-Z0-9_]+%/.test(s) || /\bset\s+[a-zA-Z0-9_]+\s*=/i.test(s)) {
        return 'cmd';
      }
      if (/\bdir\s+\/[a-z]/i.test(s) || /\bcopy\s+\/[a-z]/i.test(s) || /\bdel\s+\/[a-z]/i.test(s)) {
        return 'cmd';
      }

      // 默认：PowerShell（更通用的交互/管道能力），但不保证兼容 cmd 的 /switch 写法
      return 'powershell';
    };

    const effectiveShell: 'cmd' | 'powershell' | 'bash' = (() => {
      const mode = shellMode || 'auto';
      if (mode === 'cmd') return 'cmd';
      if (mode === 'powershell' || mode === 'pwsh') return 'powershell';
      if (mode === 'bash') return 'bash';
      // auto
      if (isWindows) return inferWindowsShell(command);
      return 'bash';
    })();

    const autoNote =
      (!shellMode || shellMode === 'auto')
        ? `未显式指定 shell，已自动选择：${effectiveShell}`
        : undefined;

    // ========== 依赖检查（Shell 行内也尽量提示缺失运行时）==========
    // 之前仅在“直接执行 argv”路径检查 node 环境；但很多任务会用 `cd ... && node ...` 这类 shell 行。
    // 这里做一个轻量启发式：若整行命令中出现 node/npm/pnpm/npx/yarn，先检查 node 环境，避免用户看到晦涩的 “not recognized/program not found”。
    const usesNodeRuntimeInShellLine = /\b(node|npm|pnpm|npx|yarn)\b/i.test(command);
    if (usesNodeRuntimeInShellLine) {
      const env = await sandbox.checkEnvironment('node');
      if (!env.available) {
        const cfg = await getAgentExperienceConfig();
        const hint = [env.error, env.installHint, env.downloadUrl].filter(Boolean).join('\n');
        const plan = buildWindowsNodeInstallHint(cfg.windowsRuntimeInstallStrategy);
        return {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: '',
          duration: 0,
          error: `Node.js 运行时不可用，无法执行命令行中的 Node 相关指令`,
          errorDetails: {
            code: 'NODE_RUNTIME_NOT_AVAILABLE',
            message: [`命令包含 node/npm/pnpm/npx/yarn，但运行环境未检测到 Node.js。`, hint || '', plan].filter(Boolean).join('\n').trim(),
          },
        };
      }
    }

    // 显式 shell（确定性最高）：不做 fallback，只按指定执行
    // 对于 shell 模式，直接传递原始命令（command），不使用 normalizedForParsing
    // 因为 normalizedForParsing 会去掉引号，但 shell 需要完整的命令行语法
    if (isWindows && effectiveShell === 'cmd') {
      const r = await sandbox.execute({
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', command],
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
        note: [autoNote, '已按 shell=cmd 执行。'].filter(Boolean).join('\n'),
      };
    }
    if (isWindows && effectiveShell === 'powershell') {
      const r = await sandbox.execute({
        command: 'powershell.exe',
        args: ['-NoProfile', '-Command', command],
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
        note: [autoNote, '已按 shell=powershell 执行。'].filter(Boolean).join('\n'),
      };
    }

    if ((isMac || isLinux) && effectiveShell === 'bash') {
      const r = await sandbox.execute(
        { command: 'bash', args: ['-lc', command], workingDir, timeoutMs },
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
        note: [autoNote, '已按 shell=bash 执行。'].filter(Boolean).join('\n'),
      };
    }

    // 平台/执行器不匹配：明确返回错误（不做 fallback）
    if (isWindows && effectiveShell === 'bash') {
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
    if ((isMac || isLinux) && (effectiveShell === 'cmd' || effectiveShell === 'powershell')) {
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


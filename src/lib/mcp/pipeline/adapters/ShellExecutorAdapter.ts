import { getProcessSandbox } from '@/lib/skills/sandbox';
import { SHELL_EXECUTOR_SERVER_NAME } from '@/lib/mcp/nativeTools/shellExecutor';
import { buildWindowsNodeInstallHint, getAgentExperienceConfig } from '@/lib/mcp/experience/agentExperienceConfig';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';
import { shouldUseScriptMode, parseScriptRequest, executeScript } from '@/lib/shell/scriptExecutor';
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

    let result = await tryExecute(cmd);

    // Windows: 一些命令（npm/pnpm/npx/yarn）通常是 *.cmd shim；后端不一定能用裸名解析到
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isWindows = ua.includes('win');
    const programNotFound = String((result as any).error || '').toLowerCase().includes('program not found');
    if (isWindows && programNotFound && !cmd.includes('.') && (base === 'npm' || base === 'pnpm' || base === 'npx' || base === 'yarn')) {
      result = await tryExecute(`${cmd}.cmd`);
    }

    let note: string | undefined;
    if (!workingDir && (base === 'npm' || base === 'pnpm' || base === 'yarn' || base === 'npx')) {
      note =
        '提示：未提供 workingDir。若命令依赖项目目录（如安装依赖/运行脚本），建议显式传入工作目录以避免在默认 appData 目录执行。';
    }

    return {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      error: result.error,
      note,
    };
  }
}


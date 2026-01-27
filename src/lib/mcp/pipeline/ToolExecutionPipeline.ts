import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { shouldAutoAuthorize } from '@/lib/mcp/authorizationConfig';
import { getAgentExperienceConfig } from '@/lib/mcp/experience/agentExperienceConfig';
import { isShellCommandTrusted, useShellAuthStore } from '@/store/shellAuthStore';
import { resolveAllowlistPath } from '@/lib/filesystemAllowlist';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';
import { setFilesystemAllowedDirectories } from '@/lib/mcp/filesystemServerConfig';
import { markError, markPendingAuth, markSuccess } from './ToolCardUpdater';
import type { ToolAdapter } from './ToolAdapter';
import { ToolInvocation } from './ToolInvocation';

export type ToolExecutionPipelineDeps = {
  adapters: ToolAdapter[];
};

function isForcedApproval(server: string, tool: string, args?: Record<string, unknown>): boolean {
  const srv = String(server || '').toLowerCase();
  const tl = String(tool || '').toLowerCase();

  // filesystem：仅 delete 强制人工确认（你选择的策略）
  if (srv === 'filesystem') {
    return tl === 'delete_file' || tl === 'delete';
  }

  // shell_executor：涉及安装运行时/改环境变量/下载脚本等高风险动作，强制确认
  if (srv === 'shell_executor') {
    const cmd = typeof (args as any)?.command === 'string' ? String((args as any).command).toLowerCase() : '';
    if (!cmd) return false;
    if (cmd.includes('winget ') || cmd.includes('choco ')) return true;
    if (cmd.includes('setx ') || cmd.includes('set environmentvariable') || cmd.includes('set-itemproperty')) return true;
    // 下载脚本执行（curl|bash / iwr|iex 等）
    if (cmd.includes('| bash') || cmd.includes('| sh') || cmd.includes('|iex') || cmd.includes('| iex')) return true;
  }

  return false;
}

function needsAuthorization(server: string, tool: string, autoAuth: boolean, args?: Record<string, unknown>): boolean {
  const srv = String(server || '').toLowerCase();
  const tl = String(tool || '').toLowerCase();

  if (isForcedApproval(server, tool, args)) return true;

  // shell_executor：若用户已“信任该工作目录”，且命令属于低风险清单，则可免重复审批
  if (srv === 'shell_executor') {
    try {
      if (isShellCommandTrusted({ command: (args as any)?.command, workingDir: (args as any)?.workingDir })) {
        return false;
      }
    } catch {
      // ignore
    }
  }

  // user_fs：保持现有行为——仅写入需要确认（读/list 属于“在已授权目录内的低风险操作”）
  if (srv === 'user_fs') {
    return tl === 'write_user_file' && !autoAuth;
  }

  // skills_fs / skills：默认不需要人工确认（仅限技能包目录/内部工具）
  if (srv === 'skills_fs' || srv === 'skills' || srv === 'skill') {
    return false;
  }

  // filesystem：授权由 allowlist gate 统一管理，这里不参与（返回 false 以避免“全局 autoAuth”影响文件系统安全边界）
  if (srv === 'filesystem') {
    return false;
  }

  // 其余：按 server 粒度控制
  return !autoAuth;
}

function getFilesystemOp(tool: string): 'read' | 'write' | 'create' | 'delete' {
  const tl = String(tool || '').toLowerCase();
  if (tl === 'delete_file' || tl === 'delete') return 'delete';
  // MCP filesystem 常见工具名：read_file / list_directory / write_file
  if (tl === 'read_file' || tl === 'read' || tl === 'list_directory' || tl === 'list' || tl === 'dir') return 'read';
  if (tl === 'write_file' || tl === 'write') return 'write';
  if (tl === 'mkdir' || tl === 'create_directory' || tl === 'create') return 'create';
  return 'read';
}

/**
 * 统一工具执行管线：去重 -> 授权 -> 执行 -> 更新卡片 -> 返回结果
 *
 * 注意：follow-up / multi-tool gate 仍由现有 `continueWithToolResult` 承担，
 * 后续会在 `followup-gate` / `context-envelope` 阶段收敛。
 */
export class ToolExecutionPipeline {
  private coordinator = ToolCallCoordinator.getInstance();
  private adapters: ToolAdapter[];

  constructor(deps: ToolExecutionPipelineDeps) {
    this.adapters = deps.adapters;
  }

  private findAdapter(invocation: ToolInvocation): ToolAdapter | null {
    for (const a of this.adapters) {
      if (a.canHandle(invocation)) return a;
    }
    return null;
  }

  async run(invocation: ToolInvocation): Promise<unknown> {
    const { assistantMessageId, server, tool, args, callId } = invocation;
    if (this.coordinator.isMessageCancelled(assistantMessageId)) {
      return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
    }
    const cardId = invocation.ensureCardId();
    if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
      return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
    }
    const lockResult = invocation.lockKey
      ? { acquired: true, key: invocation.lockKey }
      : this.coordinator.tryAcquireToolCallLock({
          messageId: assistantMessageId,
          server,
          tool,
          args,
          callId,
          cardId,
          source: 'execute',
        });

    // 去重（若未拿到锁则直接返回）
    if (!lockResult.acquired) {
      return { skipped: true, reason: 'DUPLICATE_CALL', callKey: lockResult.key };
    }
    const callKey = lockResult.key;

    const adapter = this.findAdapter(invocation);
    if (!adapter) {
      const msg = `No adapter for tool: ${server}.${tool}`;
      markError({ assistantMessageId, server, tool, cardId }, msg);
      this.coordinator.markToolCallComplete(callKey, 'failed');
      return { error: 'NO_ADAPTER', message: msg };
    }

    // 预加载：shell 授权记忆（用于 needsAuthorization 的同步判断）
    try {
      if (String(server || '').toLowerCase() === 'shell_executor') {
        await useShellAuthStore.getState().load();
      }
    } catch {
      // ignore
    }

    // 授权 + filesystem allowlist gate（统一文件系统安全边界）
    let execInvocation: ToolInvocation = invocation;
    const srvLower = String(server || '').toLowerCase();

    if (srvLower === 'filesystem') {
      const inputPath = typeof (args as any)?.path === 'string' ? String((args as any).path) : '';
      const op = getFilesystemOp(tool);

      if (inputPath) {
        try {
          const allowlist = useFilesystemAllowlistStore.getState();
          await allowlist.load();
          // 会话级别名：@WorkDir（来自附件菜单）
          const dirsForResolve = [...allowlist.directories];
          try {
            const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
            const wd = useConversationAttachmentStore.getState().getWorkingDir(invocation.conversationId);
            if (wd) {
              dirsForResolve.unshift({
                id: `session:${invocation.conversationId}:workdir`,
                path: String(wd).replace(/\\/g, '/'),
                alias: 'WorkDir',
                permissions: { read: true, write: true, create: true, delete: false },
                source: 'workdir',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              } as any);
            }
          } catch {
            // ignore
          }

          const resolved = resolveAllowlistPath({ inputPath, directories: dirsForResolve as any });

          // 执行时必须使用绝对路径（MCP filesystem 不理解 @Alias）
          const execArgs = { ...(args || {}), path: resolved.absolutePath };
          execInvocation = new ToolInvocation({
            assistantMessageId: invocation.assistantMessageId,
            conversationId: invocation.conversationId,
            server: invocation.server,
            tool: invocation.tool,
            args: execArgs,
            provider: invocation.provider,
            model: invocation.model,
            historyForLlm: invocation.historyForLlm,
            originalUserContent: invocation.originalUserContent,
            callId: invocation.callId,
            cardId,
            lockKey: invocation.lockKey,
          });

          const forceApproval = op === 'delete';
          const hasDir = !!resolved.directory;
          const hasPerm = hasDir ? !!resolved.directory?.permissions?.[op] : false;
          const needAuth = forceApproval || !hasDir || !hasPerm;

          if (needAuth) {
            markPendingAuth({ assistantMessageId, server, tool, cardId });
            const authorized = await new Promise<boolean>((resolve) => {
              const authId = `${assistantMessageId}:${cardId}`;
              useAuthorizationStore.getState().addPendingAuthorization({
                id: authId,
                messageId: assistantMessageId,
                server,
                tool,
                args: args || {},
                createdAt: Date.now(),
                onApprove: () => resolve(true),
                onReject: () => resolve(false),
              });
            });

            if (this.coordinator.isMessageCancelled(assistantMessageId)) {
              this.coordinator.markToolCallComplete(callKey, 'failed');
              return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
            }
            if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
              this.coordinator.markToolCallComplete(callKey, 'failed');
              return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
            }
            if (!authorized) {
              markError({ assistantMessageId, server, tool, cardId }, '用户拒绝授权此文件系统操作');
              this.coordinator.markToolCallComplete(callKey, 'failed');
              return { error: 'AUTHORIZATION_DENIED', message: 'User denied authorization' };
            }

            // 用户确认后：把目录加入 allowlist（或补齐权限），并同步写入 mcp_servers.json 后重连
            try {
              const st = useFilesystemAllowlistStore.getState();
              await st.upsertDirectoryForPath({ absolutePath: resolved.absolutePath, op: op as any, source: 'manual' });
              const dirPaths = st.directories.map((d) => d.path);
              await setFilesystemAllowedDirectories({ directories: dirPaths, reconnect: true });
            } catch {
              // ignore: best-effort
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          markError({ assistantMessageId, server, tool, cardId }, msg);
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { error: 'FILESYSTEM_GATE_FAILED', message: msg };
        }
      }
    } else {
      const autoAuth = await shouldAutoAuthorize(server);
      if (needsAuthorization(server, tool, autoAuth, args || {})) {
        markPendingAuth({ assistantMessageId, server, tool, cardId });
        const authorized = await new Promise<boolean>((resolve) => {
          const authId = `${assistantMessageId}:${cardId}`;
          useAuthorizationStore.getState().addPendingAuthorization({
            id: authId,
            messageId: assistantMessageId,
            server,
            tool,
            args: args || {},
            createdAt: Date.now(),
            onApprove: () => resolve(true),
            onReject: () => resolve(false),
          });
        });
        if (this.coordinator.isMessageCancelled(assistantMessageId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
        }
        if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
        }
        if (!authorized) {
          markError({ assistantMessageId, server, tool, cardId }, '用户拒绝授权此工具调用');
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { error: 'AUTHORIZATION_DENIED', message: 'User denied authorization' };
        }

        // UX：shell_executor 同意后，若提供了 workingDir，则“记住该工作目录”（降低后续重复确认）
        try {
          const srv = String(server || '').toLowerCase();
          if (srv === 'shell_executor') {
            const wd = typeof (args as any)?.workingDir === 'string' ? String((args as any).workingDir) : '';
            const cmd = typeof (args as any)?.command === 'string' ? String((args as any).command) : '';
            if (wd.trim() && cmd.trim()) {
              // 仅对低风险命令进行“记忆”，高风险仍会被 isForcedApproval 拦下
              if (!isForcedApproval(server, tool, args || {}) && isShellCommandTrusted({ command: cmd, workingDir: wd })) {
                // already trusted: no-op
              } else {
                // 只记目录，不记具体命令；后续仍受 SAFE_EXECUTABLES 限制
                await useShellAuthStore.getState().addTrustedWorkingDir(wd);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }

    const cfg = await getAgentExperienceConfig();
    const maxRetries = typeof cfg.maxToolRetries === 'number' ? Math.max(0, Math.min(5, cfg.maxToolRetries)) : 0;

    const detectFailure = (result: unknown): string | undefined => {
      if (!result || typeof result !== 'object') return undefined;
      const r: any = result as any;
      // 通用：OpenAI / MCP 风格
      if (typeof r.ok === 'boolean' && r.ok === false) {
        return typeof r.error === 'string' ? r.error : (typeof r.message === 'string' ? r.message : 'tool returned ok=false');
      }
      // 进程执行风格（shell）
      if (typeof r.success === 'boolean' && r.success === false) {
        const parts: string[] = [];
        if (typeof r.error === 'string' && r.error) parts.push(r.error);
        if (typeof r.stderr === 'string' && r.stderr.trim()) parts.push(`stderr: ${r.stderr.trim().slice(0, 400)}`);
        if (typeof r.exitCode === 'number') parts.push(`exitCode: ${r.exitCode}`);
        return parts.join('\n') || 'command failed';
      }
      return undefined;
    };

    const isRetryable = (message: string): boolean => {
      const m = String(message || '').toLowerCase();
      // 常见瞬态失败：超时/网络抖动/后端忙
      if (m.includes('timeout') || m.includes('超时')) return true;
      if (m.includes('econnreset') || m.includes('etimedout') || m.includes('network')) return true;
      if (m.includes('502') || m.includes('503') || m.includes('429')) return true;
      // 偶发：资源占用/锁
      if (m.includes('ebusy') || m.includes('resource busy') || m.includes('temporarily')) return true;
      return false;
    };

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    let attempt = 0;
    let lastErr = '';
    while (attempt <= maxRetries) {
      if (this.coordinator.isMessageCancelled(assistantMessageId)) {
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId };
      }
      if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
      }

      try {
        const result = await adapter.execute(execInvocation);
        const failure = detectFailure(result);
        if (failure) {
          throw new Error(failure);
        }
        if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
        }
        markSuccess({ assistantMessageId, server, tool, cardId }, result);
        this.coordinator.markToolCallComplete(callKey, 'completed');
        return result;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
        }
        const canRetry = attempt < maxRetries && isRetryable(lastErr);
        if (canRetry) {
          attempt += 1;
          // 轻量退避，避免立即撞同样的错误
          await sleep(300 * attempt);
          continue;
        }

        // 最终失败：把错误概览返回给 follow-up，让 AI 调整路线/参数
        const summary = {
          error: 'TOOL_EXEC_FAILED',
          message: lastErr,
          attempts: attempt + 1,
          maxRetries,
        };
        markError({ assistantMessageId, server, tool, cardId }, lastErr);
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return summary;
      }
    }

    // 理论上不会走到这里
    const summary = { error: 'TOOL_EXEC_FAILED', message: lastErr || 'Unknown error', attempts: maxRetries + 1, maxRetries };
    markError({ assistantMessageId, server, tool, cardId }, summary.message);
    this.coordinator.markToolCallComplete(callKey, 'failed');
    return summary;
  }
}


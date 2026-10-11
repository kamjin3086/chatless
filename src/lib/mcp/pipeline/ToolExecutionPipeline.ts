import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { type ApprovalDecision, type PendingApprovalScope } from '@/store/authorizationStore';
import { EVERYDAY_DIRECTORY_PERMISSIONS } from '@/lib/filesystemAllowlist/permissions';
import { resolveAccess, setConversationAccess } from '@/lib/mcp/accessPolicy';
import { shouldAutoAuthorize } from '@/lib/mcp/authorizationConfig';
import { getAgentExperienceConfig } from '@/lib/mcp/experience/agentExperienceConfig';
import { findUnresolvedAliasInValues, resolveAllowlistPath } from '@/lib/filesystemAllowlist';
import { useFilesystemAllowlistStore } from '@/store/filesystemAllowlistStore';
import {
  grantCallScopedPaths,
  syncFilesystemAllowlistToBackend,
  type CallScopedGrant,
} from '@/lib/filesystemAllowlist/backendSync';
import { markError, markPendingAuth, markSuccess } from './ToolCardUpdater';
import type { ToolAdapter } from './ToolAdapter';
import { ToolInvocation } from './ToolInvocation';
import { appendWorkspaceToolStep } from '@/lib/agentWorkspace/manifestService';
import { buildFatalErrorHints, buildHelpfulNonOkMessage, detectFatalFailure, isNonFatalNonOkResult, markKnownFailure } from './toolResultDiagnostics';
import { isDirectorySemanticFsTool, isFilesystemServer, isShellServer, normalizeServerName } from '@/lib/mcp/toolNaming';
import { filesystemOp, isPlanOnlyAllowed, isReplayableRead } from './policy/toolRisk';
import { dirnameOf, hasFilesystemPaths, resolveFilesystemCall } from './policy/resolveCall';
import { buildAuthDeniedResult } from './present';
import { waitForCallApproval } from './approvalWait';
import { decideFilesystemCall, decideServerCall, planFilesystemPromotion, planShellPromotion } from './policy/policy';
import type { AllowlistDirectory } from '@/lib/filesystemAllowlist';

function normalizeSlashPath(p: unknown): string {
  if (typeof p === 'string') return p.trim().replace(/\\/g, '/');
  if (typeof p === 'number' || typeof p === 'boolean' || typeof p === 'bigint') return String(p).trim();
  return '';
}

export type ToolExecutionPipelineDeps = {
  adapters: ToolAdapter[];
};

function isDirectoryScopedFilesystemTool(tool: string): boolean {
  return isDirectorySemanticFsTool(tool);
}

/**
 * 统一工具执行管线：去重 -> 授权 -> 执行 -> 更新卡片 -> 返回结果
 *
 * 多工具顺序和下一模型步由 AgentLoopRunner 统一承担；Pipeline 只负责一次调用。
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

    if (invocation.planOnly && !isPlanOnlyAllowed(server, tool)) {
      const blocked = {
        ok: false,
        error: {
          code: 'PLAN_ONLY_BLOCKED',
          message: `Plan-only mode forbids tools with side effects: ${server}.${tool}`,
          server,
          tool,
        },
      };
      markError({ assistantMessageId, server, tool, cardId }, blocked.error.message);
      this.coordinator.markToolCallComplete(callKey, 'failed');
      return blocked;
    }

    // 授权 + filesystem allowlist gate（统一文件系统安全边界）
    let execInvocation: ToolInvocation = invocation;
    let revokeCallGrants: (() => Promise<void>) | undefined;
    // Session working directories and single approvals are granted for this
    // call only. They must never be written into the persisted allowlist.
    const callGrants: CallScopedGrant[] = [];
    let sessionWorkDir: string | undefined;
    const srvLower = normalizeServerName(server);

    if (isShellServer(srvLower)) {
      const prepared = await this.prepareShellCall({ invocation, server, tool, cardId, callKey, callId, assistantMessageId });
      if (prepared.kind === 'halted') return prepared.result;
      execInvocation = prepared.invocation;
      sessionWorkDir = prepared.sessionWorkDir;
    }


    if (isFilesystemServer(srvLower)) {
      const gate = await this.filesystemGate({ invocation, server, tool, cardId, callKey, callId, assistantMessageId });
      if (gate.kind === 'halted') return gate.result;
      execInvocation = gate.invocation;
      if (gate.sessionWorkDir) sessionWorkDir = gate.sessionWorkDir;
      callGrants.push(...gate.grants);
    } else {
      const gate = await this.serverGate({ invocation, execInvocation, server, tool, cardId, callKey, callId, assistantMessageId });
      if (gate.kind === 'halted') return gate.result;
    }

    // Register the grants for this call right before it can touch disk. They
    // are revoked in the finally block below, so an approval never outlives the
    // call it was given for.
    if (sessionWorkDir) {
      // The session folder is created on first real use. The model is about to
      // touch files or run a command with this directory as its cwd, so it has to
      // exist now - a chat that never gets here leaves no folder behind.
      //
      // When the user mounted their own directory, @WorkDir is that directory and
      // the session folder stays uncreated: no second folder next to their project.
      try {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        const attachments = useConversationAttachmentStore.getState();
        if (attachments.isSessionDirInUse(invocation.conversationId)
          && !attachments.isWorkspaceMaterialized(invocation.conversationId)) {
          const { ensureConversationWorkspaceMaterialized } = await import('@/lib/agentWorkspace/workspaceService');
          await ensureConversationWorkspaceMaterialized(invocation.conversationId);
        }
      } catch (error) {
        console.warn('[ToolExecutionPipeline] 准备工作目录失败:', error);
      }
      callGrants.push({
        path: sessionWorkDir,
        permissions: { read: true, write: true, create: true, delete: false },
      });
    }
    if (callGrants.length) {
      try {
        revokeCallGrants = await grantCallScopedPaths(callGrants, { runId: assistantMessageId, callId });
      } catch {
        // ignore: best-effort; the backend still re-checks the persistent allowlist
      }
    }

    try {
    const cfg = await getAgentExperienceConfig();
    // Only reads are replayable: a timeout after a write, shell command, or
    // unknown MCP operation does not tell us whether the side effect happened.
    const readOnlyRetry = isReplayableRead(server, tool);
    const maxRetries = readOnlyRetry && typeof cfg.maxToolRetries === 'number'
      ? Math.max(0, Math.min(5, cfg.maxToolRetries))
      : 0;

    const toolId = { server, tool };

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
        const raw = await adapter.execute(execInvocation);
        const result: any = raw as any;

        // ok=false 但包含部分失败细节：不异常重试；直接标记为 error 并把细节回灌给模型/用户
        if (result && typeof result === 'object' && typeof result.ok === 'boolean' && result.ok === false && isNonFatalNonOkResult(toolId, result)) {
          const extra = buildHelpfulNonOkMessage(toolId, result);
          const enriched = {
            ...result,
            error: {
              code: 'TOOL_PARTIAL_FAILURE',
              message: extra.message,
              hints: extra.hints,
              server,
              tool,
            },
          };

          markError({ assistantMessageId, server, tool, cardId }, extra.message);
          try {
            await appendWorkspaceToolStep({
              conversationId: invocation.conversationId,
              assistantMessageId,
              cardId,
              callId,
              server,
              tool,
              args: (execInvocation.args || args || {}) as any,
              result: enriched,
            });
          } catch {
            // ignore
          }
          this.coordinator.markToolCallComplete(callKey, 'completed');
          return enriched;
        }

        const failure = detectFatalFailure(toolId, result);
        if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId };
        }
        if (failure) {
          // A structured failure said exactly what went wrong. Passing it on
          // unchanged keeps stdout/stderr, exit codes and edit candidates
          // visible; re-throwing here used to erase them and reclassify a known
          // failure as an unknown side effect.
          const failed = markKnownFailure(toolId, result, failure);
          markError({ assistantMessageId, server, tool, cardId }, failure);
          try {
            await appendWorkspaceToolStep({
              conversationId: invocation.conversationId,
              assistantMessageId,
              cardId,
              callId,
              server,
              tool,
              args: (execInvocation.args || args || {}) as any,
              result: failed,
            });
          } catch {
            // ignore
          }
          this.coordinator.markToolCallComplete(callKey, 'failed');
          return failed;
        }
        markSuccess({ assistantMessageId, server, tool, cardId }, result);
        try {
          await appendWorkspaceToolStep({
            conversationId: invocation.conversationId,
            assistantMessageId,
            cardId,
            callId,
            server,
            tool,
            args: (execInvocation.args || args || {}) as any,
            result,
          });
        } catch {
          // ignore
        }
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

        // 最终失败：返回“可行动”的结构化错误，避免 AI 乱猜
        const hints = buildFatalErrorHints(toolId, lastErr);
        const summary = {
          ok: false,
          // 保持兼容：仍提供扁平字段（旧逻辑可能读取它们）
          error: 'TOOL_EXEC_FAILED',
          message: lastErr,
          attempts: attempt + 1,
          maxRetries,
          hints,
          // 新增：结构化错误（便于 UI/模型直接读懂）
          errorDetails: {
            code: readOnlyRetry ? 'TOOL_EXEC_FAILED' : 'TOOL_RESULT_UNKNOWN',
            message: lastErr,
            hints,
            attempts: attempt + 1,
            maxRetries,
            server,
            tool,
          },
          resultStatus: readOnlyRetry ? 'failed' : 'unknown',
        };
        markError({ assistantMessageId, server, tool, cardId }, lastErr);
        try {
          await appendWorkspaceToolStep({
            conversationId: invocation.conversationId,
            assistantMessageId,
            cardId,
            callId,
            server,
            tool,
            args: (execInvocation.args || args || {}) as any,
            result: summary,
          });
        } catch {
          // ignore
        }
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return summary;
      }
    }

    // 理论上不会走到这里
    const hints = buildFatalErrorHints(toolId, lastErr || 'Unknown error');
    const summary = {
      ok: false,
      error: 'TOOL_EXEC_FAILED',
      message: lastErr || 'Unknown error',
      attempts: maxRetries + 1,
      maxRetries,
      hints,
      errorDetails: {
        code: 'TOOL_EXEC_FAILED',
        message: lastErr || 'Unknown error',
        hints,
        attempts: maxRetries + 1,
        maxRetries,
        server,
        tool,
      },
    };
    markError({ assistantMessageId, server, tool, cardId }, summary.message);
    this.coordinator.markToolCallComplete(callKey, 'failed');
    return summary;
    } finally {
      await revokeCallGrants?.().catch(() => {});
    }
  }

  /**
   * One approval round-trip. Marks the card pending, waits for the answer, then
   * hands back either the answer or the result the caller must return: the
   * cancellation checks, the denial card and its workspace step used to be
   * written twice, once per branch, which is how they started to drift.
   */
  private async requestApproval(params: {
    assistantMessageId: string
    conversationId: string
    server: string
    tool: string
    cardId: string
    callKey: string
    callId?: string
    args: Record<string, unknown>
    scope?: Record<string, unknown>
    approvalScope?: PendingApprovalScope
    denyMessage: string
    denyFs?: { op?: string; inputPath?: string; resolvedPath?: string; suggestDir?: string }
  }): Promise<{ kind: 'approved'; answer: ApprovalDecision } | { kind: 'halted'; result: unknown }> {
    const { assistantMessageId, conversationId, server, tool, cardId, callKey, callId } = params;
    markPendingAuth({ assistantMessageId, server, tool, cardId });
    const approval = await waitForCallApproval({
      id: `${assistantMessageId}:${cardId}`,
      runId: assistantMessageId,
      conversationId,
      callId,
      server,
      tool,
      args: params.args,
      scope: params.scope,
      approvalScope: params.approvalScope,
    });

    if (this.coordinator.isMessageCancelled(assistantMessageId)) {
      this.coordinator.markToolCallComplete(callKey, 'failed');
      return { kind: 'halted', result: { skipped: true, reason: 'CANCELLED', messageId: assistantMessageId } };
    }
    if (this.coordinator.isToolCardCancelled(assistantMessageId, cardId)) {
      this.coordinator.markToolCallComplete(callKey, 'failed');
      return { kind: 'halted', result: { skipped: true, reason: 'CARD_CANCELLED', messageId: assistantMessageId, cardId } };
    }
    if (!approval.approved) {
      markError({ assistantMessageId, server, tool, cardId }, params.denyMessage);
      this.coordinator.markToolCallComplete(callKey, 'failed');
      const denied = buildAuthDeniedResult({
        server,
        tool,
        message: 'User denied authorization',
        conversationId,
        assistantMessageId,
        cardId,
        args: params.args,
        fs: params.denyFs,
      });
      try {
        await appendWorkspaceToolStep({
          conversationId,
          assistantMessageId,
          cardId,
          callId,
          server,
          tool,
          args: params.args,
          result: denied,
        });
      } catch {
        // ignore
      }
      return { kind: 'halted', result: denied };
    }
    return { kind: 'approved', answer: approval.decision };
  }

  /**
   * Refuses a call whose path or command still carries an unresolved `@Alias`.
   *
   * Passing it on is how a command like `cd @WorkDir` created a literal
   * `@WorkDir` folder, so this returns a structured result the model can act on
   * and never dispatches to an adapter.
   */
  /**
   * shell_executor 的前置解析：workingDir 与 command 里的 @WorkDir / @Alias 换成真实
   * 路径，好让审批卡片和后端看到同一个目录。解析本身是 best-effort，失败就保持原参数，
   * 交给后面的校验与授权处理；但替换后仍残留的别名既不是路径也不是命令，必须在这里挡掉，
   * 否则 `cd @WorkDir` 会创建出一个字面量目录。
   */
  /**
   * 文件系统门：把路径解析成真实目标、按 allowlist 与免问状态决定放行还是发审批卡片，
   * 再把用户的回答换成这一次调用真正需要的授予。判定本身在 policy/，这里只做读 store、
   * 等用户、落盘这些副作用。解析或授予失败统一回 FILESYSTEM_GATE_FAILED，与原实现一致：
   * 不把异常吞成"没这回事"。
   */
  /**
   * 非文件系统调用的门：shell 的信任来自访问策略（持久开关，或本会话此前在卡片上做的
   * 选择），其余服务器看全局自动授权。要问就把卡片发出去；答完之后 shell 的"以后都不问"
   * 与"本会话不再问"各自落到该落的地方，下一条命令会重新走一遍策略。
   */
  private async serverGate(params: {
    invocation: ToolInvocation
    execInvocation: ToolInvocation
    server: string
    tool: string
    cardId: string
    callKey: string
    callId?: string
    assistantMessageId: string
  }): Promise<{ kind: 'ready' } | { kind: 'halted'; result: unknown }> {
    const { invocation, execInvocation, server, tool, cardId, callKey, callId, assistantMessageId } = params;
    const args = invocation.args as Record<string, unknown> | undefined;
    const halt = (result: unknown) => ({ kind: 'halted' as const, result });

    const isShell = isShellServer(server);
    // Shell trust comes from the access policy: the persisted switch or the
    // choice this conversation's user already made on an approval card.
    const autoAuth = isShell
      ? (await resolveAccess('shell', invocation.conversationId)) === 'unrestricted'
      : await shouldAutoAuthorize(server);
    const effectiveArgs = (execInvocation.args || args || {}) as any;
    if (decideServerCall({ server, tool, autoAuthorize: autoAuth }) === 'ask') {
      const approval = await this.requestApproval({
        assistantMessageId, conversationId: invocation.conversationId,
        server, tool, cardId, callKey, callId,
        args: (effectiveArgs || {}) as Record<string, unknown>,
        approvalScope: isShell
          ? { kind: 'shell', command: String(effectiveArgs?.command || '') }
          : undefined,
        denyMessage: '用户拒绝授权此工具调用',
      });
      if (approval.kind === 'halted') return halt(approval.result);

      // A shell approval can end the questions for this session or for good;
      // the next command re-checks the policy, so nothing is bypassed.
      if (isShell) {
        const promotion = planShellPromotion({ answer: approval.answer });
        if (promotion.conversationUnrestricted) {
          setConversationAccess('shell', invocation.conversationId, 'unrestricted');
        }
        if (promotion.globalUnrestricted) {
          try {
            const { setGlobalAccess } = await import('@/lib/mcp/accessPolicy');
            await setGlobalAccess('shell', 'unrestricted');
          } catch (error) {
            console.warn('[ToolExecutionPipeline] persisting shell trust failed:', error);
          }
        }
      }
    }

    return { kind: 'ready' };
  }

  private async filesystemGate(params: {
    invocation: ToolInvocation
    server: string
    tool: string
    cardId: string
    callKey: string
    callId?: string
    assistantMessageId: string
  }): Promise<
    | { kind: 'ready'; invocation: ToolInvocation; sessionWorkDir?: string; grants: CallScopedGrant[] }
    | { kind: 'halted'; result: unknown }
  > {
    const { invocation, server, tool, cardId, callKey, callId, assistantMessageId } = params;
    const args = invocation.args as Record<string, unknown> | undefined;
    let nextInvocation = invocation;
    let sessionWorkDir: string | undefined;
    const grants: CallScopedGrant[] = [];
    const halt = (result: unknown) => ({ kind: 'halted' as const, result });

    const op = filesystemOp(tool);

    // 不带任何路径参数的文件系统调用不走解析、不读 allowlist、也不进审批——与原行为一致。
    if (hasFilesystemPaths(args)) {
      try {
        const allowlist = useFilesystemAllowlistStore.getState();
        await allowlist.load();
        // 会话级别名：@WorkDir（来自附件菜单）
        const dirsForResolve = [...allowlist.directories];
        let workingDir: string | undefined;
        try {
          const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
          const wd = useConversationAttachmentStore.getState().getWorkingDir(invocation.conversationId);
          if (wd) {
            workingDir = String(wd).replace(/\\/g, '/');
            sessionWorkDir = workingDir;
            dirsForResolve.unshift({
              id: `session:${invocation.conversationId}:workdir`,
              path: workingDir,
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

        // Keep the backend in step with the user's persistent settings only.
        // The session working directory travels as a call-scoped grant below,
        // so it never becomes a lasting backend authorization.
        try {
          await syncFilesystemAllowlistToBackend(allowlist.directories as any);
        } catch {
          // ignore: best-effort sync
        }

        const resolution = resolveFilesystemCall({
          invocation, cardId, directories: dirsForResolve as AllowlistDirectory[], workingDir,
        });

        // 别名没解析出来（未授权/拼错）或路径解析不了：直接给出结构化错误，
        // 不把原始字符串交给后端——那正是字面量 "@WorkDir" 目录的由来。
        if (resolution.kind === 'reject') {
          return halt(await this.rejectUnresolvedAlias({
            assistantMessageId, conversationId: invocation.conversationId, server, tool, cardId, callKey, callId,
            args: (args || {}) as any,
            alias: resolution.alias,
            reason: resolution.reason,
          }));
        }

        nextInvocation = resolution.invocation;

        // 主路径与其命中的目录：权限检查与授权卡片都从这里取。
        const primaryAbsolutePath = resolution.primaryPath;

        const forceApproval = op === 'delete';
        // The user's chosen trust level decides whether this call may ask.
        // "unrestricted" skips the prompt; the backend still validates every
        // path it receives.
        const accessLevel = await resolveAccess('fs', invocation.conversationId);
        const unrestricted = accessLevel === 'unrestricted';
        const policy = decideFilesystemCall({
          op, primaryPath: primaryAbsolutePath, directory: resolution.directory, unrestricted,
        });
        const needsCallGrant = policy.needsCallGrant;
        let approved = false;
        let decision: ApprovalDecision = 'once';

        if (policy.kind === 'ask') {
          // "以后都允许" is only meaningful for a folder we can grant, so a
          // delete reports its parent but never offers that choice.
          const approvableDirectory = policy.approvableDirectory;
          // 看着和策略里的 approvableDirectory 是同一个表达式，但它多一层归一，且只喂给
          // 模型可见的拒绍文案。复用策略那份要么改动授权路径（安全相关），要么改动模型
          // 文案（契约禁止），都比容忍这点重复更贵，所以两边各算各的。
          const suggestDir = normalizeSlashPath(resolution.directory?.path) || dirnameOf(primaryAbsolutePath);
          const approval = await this.requestApproval({
            assistantMessageId, conversationId: invocation.conversationId,
            server, tool, cardId, callKey, callId,
            args: (args || {}) as Record<string, unknown>,
            scope: { operation: op, path: primaryAbsolutePath, directory: approvableDirectory || undefined },
            approvalScope: approvableDirectory
              ? { kind: 'filesystem', op, path: primaryAbsolutePath, directory: approvableDirectory }
              : undefined,
            denyMessage: `用户拒绝授权此文件系统操作（${op}）：${suggestDir || primaryAbsolutePath}`,
            denyFs: { op, inputPath: resolution.requestedPath, resolvedPath: primaryAbsolutePath, suggestDir },
          });
          if (approval.kind === 'halted') return halt(approval.result);
          approved = true;
          decision = approval.answer;

          // Turn the user's choice into trust that lasts as long as they asked
          // for: "always" joins the persistent allowlist (never with delete),
          // "unrestricted" stops the questions for the rest of the session.
          const promotion = planFilesystemPromotion({
            answer: decision, approvableDirectory, isDelete: forceApproval,
          });
          if (promotion.rememberDirectory) {
            try {
              const { ensureAllowlistedDirectory } = await import('@/lib/filesystemAllowlist/autoAuthorize');
              await ensureAllowlistedDirectory({
                path: promotion.rememberDirectory,
                source: 'manual',
                permissions: EVERYDAY_DIRECTORY_PERMISSIONS,
              });
            } catch (error) {
              console.warn('[ToolExecutionPipeline] remembering directory failed:', error);
            }
          }
          if (promotion.conversationUnrestricted) {
            setConversationAccess('fs', invocation.conversationId, 'unrestricted');
          }
        }

        // Anything the persistent allowlist does not cover needs a grant for
        // this call, whether the user approved one call or turned prompts off.
        if (needsCallGrant && (approved || unrestricted)) {
          try {
            const hasDirArg = typeof (args as any)?.dir === 'string';
            const dirScopedByTool = isDirectoryScopedFilesystemTool(tool);
            // A delete is bound to the exact target. Writes and creates need
            // the containing directory because the file may not exist yet.
            const grantPath = hasDirArg || dirScopedByTool || op === 'delete'
              ? primaryAbsolutePath
              : dirnameOf(primaryAbsolutePath);
            grants.push({
              path: grantPath,
              permissions: {
                read: op === 'read' || op === 'delete',
                write: op === 'write',
                create: op === 'create',
                delete: op === 'delete',
              },
            });
          } catch {
            // ignore: best-effort
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markError({ assistantMessageId, server, tool, cardId }, msg);
        this.coordinator.markToolCallComplete(callKey, 'failed');
        const gateFailed = {
          ok: false,
          error: {
            code: 'FILESYSTEM_GATE_FAILED',
            message: msg,
            server,
            tool,
            args: args || {},
          },
        };
        try {
          await appendWorkspaceToolStep({
            conversationId: invocation.conversationId,
            assistantMessageId,
            cardId,
            callId,
            server,
            tool,
            args: args || {},
            result: gateFailed,
          });
        } catch {
          // ignore
        }
        return halt(gateFailed);
      }
    }

    return { kind: 'ready', invocation: nextInvocation, sessionWorkDir, grants };
  }

  private async prepareShellCall(params: {
    invocation: ToolInvocation
    server: string
    tool: string
    cardId: string
    callKey: string
    callId?: string
    assistantMessageId: string
  }): Promise<{ kind: 'ready'; invocation: ToolInvocation; sessionWorkDir?: string } | { kind: 'halted'; result: unknown }> {
    const { invocation, server, tool, cardId, callKey, callId, assistantMessageId } = params;
    const args = invocation.args as Record<string, unknown> | undefined;
    let nextInvocation = invocation;
    let sessionWorkDir: string | undefined;

    try {
      const allowlist = useFilesystemAllowlistStore.getState();
      await allowlist.load();
      const dirsForResolve = [...allowlist.directories];
      let shellWorkDir: string | undefined;
      try {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        const wd = useConversationAttachmentStore.getState().getWorkingDir(invocation.conversationId);
        if (wd) {
          shellWorkDir = String(wd).replace(/\\/g, '/');
          sessionWorkDir = shellWorkDir;
          dirsForResolve.unshift({
            id: `session:${invocation.conversationId}:workdir`,
            path: shellWorkDir,
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

      const execArgs: Record<string, unknown> = { ...(args || {}) };

      // 解析 workingDir 参数中的别名
      const workingDirInput = typeof (args as any)?.workingDir === 'string' ? String((args as any).workingDir) : '';
      if (workingDirInput) {
        const shellResolved = resolveAllowlistPath({ inputPath: workingDirInput, directories: dirsForResolve as any, workingDir: shellWorkDir });
        execArgs.workingDir = shellResolved.absolutePath;
      } else if (shellWorkDir) {
        // The tool description promises @WorkDir as the default. Resolving it
        // here, before the approval gate, means the card and the backend see
        // the same directory instead of the backend falling back silently.
        execArgs.workingDir = shellWorkDir;
      }

      // 解析 command 参数中的 @WorkDir / @Alias 别名
      const commandInput = typeof (args as any)?.command === 'string' ? String((args as any).command) : '';
      if (commandInput && commandInput.includes('@')) {
        let resolvedCommand = commandInput;
        // 替换 @WorkDir 别名（支持 @WorkDir、@WorkDir/、@WorkDir\）
        if (shellWorkDir) {
          // 使用全局替换，支持多种后缀形式
          resolvedCommand = resolvedCommand.replace(/@WorkDir(?=[\/\\]|$|\s|"|')/g, shellWorkDir);
        }
        // 替换其他 @Alias 别名（格式：@AliasName 或 @AliasName/path）
        for (const dir of dirsForResolve) {
          if (dir.alias && dir.path) {
            const aliasName = String(dir.alias);
            // 使用动态正则，匹配 @AliasName 后跟路径分隔符、空白、引号或字符串结尾
            const pattern = new RegExp(`@${aliasName}(?=[/\\\\]|$|\\s|"|')`, 'g'); // eslint-disable-line no-useless-escape
            resolvedCommand = resolvedCommand.replace(pattern, String(dir.path).replace(/\\/g, '/'));
          }
        }
        if (resolvedCommand !== commandInput) {
          execArgs.command = resolvedCommand;
        }
      }

      // An alias that survived substitution is not a path and not a command:
      // refuse it here so nothing creates a literal "@WorkDir" folder.
      const unresolved = findUnresolvedAliasInValues([
        execArgs.workingDir,
        typeof execArgs.command === 'string' ? execArgs.command : '',
      ]);
      if (unresolved) {
        return { kind: 'halted', result: await this.rejectUnresolvedAlias({
          assistantMessageId, conversationId: invocation.conversationId,
          server, tool, cardId, callKey, callId, args: (args || {}) as any, alias: unresolved,
          sessionWorkDir: shellWorkDir }) };
      }

      nextInvocation = new ToolInvocation({
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
        providerData: invocation.providerData,
        planOnly: invocation.planOnly,
      });
    } catch {
      // ignore: best-effort（解析失败则保持原参数，让后续校验/授权处理）
    }

    return { kind: 'ready', invocation: nextInvocation, sessionWorkDir };
  }

  private async rejectUnresolvedAlias(params: {
    assistantMessageId: string;
    conversationId: string;
    server: string;
    tool: string;
    cardId: string;
    callKey: string;
    callId?: string;
    args: Record<string, unknown>;
    alias: string;
    reason?: string;
    sessionWorkDir?: string;
  }): Promise<unknown> {
    const label = params.alias || '未知别名';
    const message = params.reason
      ? `${params.reason}（路径里的别名为 ${label}）`
      : `${label} 未被解析：该别名没有对应的已授权目录。`;
    const hint = params.sessionWorkDir
      ? `可以用相对路径，或直接用 @WorkDir（当前指向 ${params.sessionWorkDir}）。`
      : '可以用绝对路径，或让用户先附加一个目录再使用 @WorkDir。';

    const failure = {
      ok: false,
      error: {
        code: 'UNRESOLVED_ALIAS',
        message: `${message} ${hint}`,
        alias: params.alias || undefined,
        server: params.server,
        tool: params.tool,
      },
      resultStatus: 'failed' as const,
    };

    markError({ assistantMessageId: params.assistantMessageId, server: params.server, tool: params.tool,
      cardId: params.cardId }, failure.error.message);
    this.coordinator.markToolCallComplete(params.callKey, 'failed');
    try {
      await appendWorkspaceToolStep({
        conversationId: params.conversationId,
        assistantMessageId: params.assistantMessageId,
        cardId: params.cardId,
        callId: params.callId,
        server: params.server,
        tool: params.tool,
        args: params.args,
        result: failure,
      });
    } catch {
      // ignore
    }
    return failure;
  }
}


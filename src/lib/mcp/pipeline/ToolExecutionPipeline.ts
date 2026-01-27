import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { shouldAutoAuthorize } from '@/lib/mcp/authorizationConfig';
import { markError, markPendingAuth, markSuccess } from './ToolCardUpdater';
import type { ToolAdapter } from './ToolAdapter';
import { ToolInvocation } from './ToolInvocation';

export type ToolExecutionPipelineDeps = {
  adapters: ToolAdapter[];
};

function needsAuthorization(server: string, tool: string, autoAuth: boolean): boolean {
  const srv = String(server || '').toLowerCase();
  const tl = String(tool || '').toLowerCase();

  // user_fs：保持现有行为——仅写入需要确认（读/list 属于“在已授权目录内的低风险操作”）
  if (srv === 'user_fs') {
    return tl === 'write_user_file' && !autoAuth;
  }

  // skills_fs / skills：默认不需要人工确认（仅限技能包目录/内部工具）
  if (srv === 'skills_fs' || srv === 'skills' || srv === 'skill') {
    return false;
  }

  // 其余：按 server 粒度控制
  return !autoAuth;
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
      throw new Error(msg);
    }

    // 授权
    const autoAuth = await shouldAutoAuthorize(server);
    if (needsAuthorization(server, tool, autoAuth)) {
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
      if (!authorized) {
        markError({ assistantMessageId, server, tool, cardId }, '用户拒绝授权此工具调用');
        this.coordinator.markToolCallComplete(callKey, 'failed');
        return { error: 'AUTHORIZATION_DENIED', message: 'User denied authorization' };
      }
    }

    try {
      const result = await adapter.execute(invocation);
      markSuccess({ assistantMessageId, server, tool, cardId }, result);
      this.coordinator.markToolCallComplete(callKey, 'completed');
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      markError({ assistantMessageId, server, tool, cardId }, msg);
      this.coordinator.markToolCallComplete(callKey, 'failed');
      throw e;
    }
  }
}


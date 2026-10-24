/**
 * 等一次调用级审批：先落一条 pending 记录（Tauri 下走 invoke，浏览器下走本地库事务），
 * 把卡片交给授权 store，用户在卡片上答完才把结果交回去。
 *
 * 这里只有 IO 和等待，不参与"该不该问"的判定（那在 policy/），也不管卡片文案（那在 present/）。
 *
 * The pending card is registered before the persistence await. Stop calls
 * `rejectAuthorizationsByMessageId`, and a waiter that had not registered yet
 * used to escape that sweep: the run stayed locked and the next send in the
 * conversation was rejected. Registration also makes a late positive answer
 * observable, so it can be refused instead of executing a stopped call.
 */
import { useAuthorizationStore, type ApprovalDecision } from '@/store/authorizationStore';
import { DatabaseService } from '@/lib/database/services/DatabaseService';

export async function waitForCallApproval(params: {
  id: string; runId: string; conversationId: string; callId?: string; server: string; tool: string;
  args: Record<string, unknown>; scope?: Record<string, unknown>;
  approvalScope?: import('@/store/authorizationStore').PendingApprovalScope;
  /** True once Stop cancelled the run; a late approval must not execute. */
  isCancelled?: () => boolean;
}): Promise<{ approved: boolean; decision: ApprovalDecision }> {
  const db = DatabaseService.getInstance().getDbManager();
  const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const isCancelled = params.isCancelled ?? (() => false);

  if (isCancelled()) return { approved: false, decision: 'once' };

  let answer: { approved: boolean; decision: ApprovalDecision } | null = null;
  let persisted = false;
  let resolveAnswer!: (value: { approved: boolean; decision: ApprovalDecision }) => void;
  const settled = new Promise<{ approved: boolean; decision: ApprovalDecision }>((resolve) => {
    resolveAnswer = resolve;
  });

  const persistDecision = async (approved: boolean) => {
    if (tauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<boolean>('agent_decide_approval', { db: db.getConnectionUrl(), approvalId: params.id,
        status: approved ? 'approved' : 'rejected', decidedAt: Date.now() });
    }
    return db.executeTransaction(async (tx) => {
      await tx.execute("UPDATE agent_approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
        [approved ? 'approved' : 'rejected', Date.now(), params.id]);
      await tx.execute("UPDATE agent_runs SET status = 'running' WHERE id = ? AND status = 'waiting_approval'", [params.runId]);
      return true;
    });
  };

  const settle = (approved: boolean, decision: ApprovalDecision = 'once') => {
    if (answer) return;
    answer = { approved, decision: approved ? decision : 'once' };
    const store = useAuthorizationStore.getState();
    // Tests and older callers may provide only the registration side.
    if (typeof store.removeAuthorization === 'function') store.removeAuthorization(params.id);
    resolveAnswer(answer);
    if (persisted) void persistDecision(approved).catch(() => {});
  };

  useAuthorizationStore.getState().addPendingAuthorization({ id: params.id, messageId: params.runId,
    conversationId: params.conversationId,
    server: params.server, tool: params.tool, args: params.args, createdAt: Date.now(),
    scope: params.approvalScope,
    onApprove: (decision) => {
      // The card can still be visible for a tick after Stop; a positive answer
      // that arrives now is a rejection of the cancelled call.
      if (isCancelled()) settle(false);
      else settle(true, decision);
    },
    onReject: () => settle(false) });

  try {
    if (tauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('agent_request_approval', { db: db.getConnectionUrl(), approvalId: params.id,
        runId: params.runId, conversationId: params.conversationId, callId: params.callId,
        server: params.server, tool: params.tool, normalizedArgs: JSON.stringify(params.args),
        scope: JSON.stringify(params.scope || {}), createdAt: Date.now() });
    } else {
      await db.executeTransaction(async (tx) => {
        await tx.execute(`INSERT OR REPLACE INTO agent_approvals
          (id, run_id, conversation_id, call_id, server, tool, normalized_args, scope, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`, [params.id, params.runId, params.conversationId,
          params.callId || null, params.server, params.tool, JSON.stringify(params.args), JSON.stringify(params.scope || {}), Date.now()]);
        await tx.execute("UPDATE agent_runs SET status = 'waiting_approval', ended_at = NULL WHERE id = ?", [params.runId]);
      });
    }
  } catch {
    const store = useAuthorizationStore.getState();
    if (typeof store.removeAuthorization === 'function') store.removeAuthorization(params.id);
    settle(false);
    return settled;
  }

  // The row exists now. A decision taken while it was being written still has
  // to reach the durable record: Stop must not leave a `pending` approval
  // behind for a run that is already cancelled.
  persisted = true;
  if (isCancelled()) settle(false);
  // `settle` mutates this through a closure, so the compiler cannot see the
  // assignment on the direct path.
  const decided = answer as { approved: boolean; decision: ApprovalDecision } | null;
  if (decided) {
    try {
      await persistDecision(decided.approved);
    } catch {
      // The in-memory answer is what releases the run; a failed durable update
      // is a stale row, not a reason to block the conversation.
    }
  }
  return settled;
}

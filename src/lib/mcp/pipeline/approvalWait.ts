/**
 * 等一次调用级审批：先落一条 pending 记录（Tauri 下走 invoke，浏览器下走本地库事务），
 * 把卡片交给授权 store，用户在卡片上答完才把结果交回去。
 *
 * 这里只有 IO 和等待，不参与"该不该问"的判定（那在 policy/），也不管卡片文案（那在 present/）。
 */
import { useAuthorizationStore, type ApprovalDecision } from '@/store/authorizationStore';
import { DatabaseService } from '@/lib/database/services/DatabaseService';

export async function waitForCallApproval(params: {
  id: string; runId: string; conversationId: string; callId?: string; server: string; tool: string;
  args: Record<string, unknown>; scope?: Record<string, unknown>;
  approvalScope?: import('@/store/authorizationStore').PendingApprovalScope;
}): Promise<{ approved: boolean; decision: ApprovalDecision }> {
  const db = DatabaseService.getInstance().getDbManager();
  const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
  return new Promise<{ approved: boolean; decision: ApprovalDecision }>((resolve) => {
    const decide = (approved: boolean, decision: ApprovalDecision = 'once') => {
      void (async () => {
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
      })().then((changed) => resolve({
        approved: Boolean(changed) && approved,
        decision: approved ? decision : 'once',
      })).catch(() => resolve({ approved: false, decision: 'once' }));
    };
    useAuthorizationStore.getState().addPendingAuthorization({ id: params.id, messageId: params.runId,
      conversationId: params.conversationId,
      server: params.server, tool: params.tool, args: params.args, createdAt: Date.now(),
      scope: params.approvalScope,
      onApprove: (decision) => decide(true, decision), onReject: () => decide(false) });
  });
}

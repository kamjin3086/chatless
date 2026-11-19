import { DatabaseService } from '@/lib/database/services/DatabaseService';
import {
  useAuthorizationStore,
  type ApprovalDecision,
  type PendingApprovalScope,
} from '@/store/authorizationStore';
import { isConversationAutomatic, useConversationAccessStore } from '@/store/conversationAccessStore';

type ApprovalAnswer = { approved: boolean; decision: ApprovalDecision; revision: number };

/** Registers the card before writing the pending row so Stop can always reach the waiter. */
export async function waitForCallApproval(params: {
  id: string; runId: string; conversationId: string; callId?: string; server: string; tool: string;
  args: Record<string, unknown>; scope?: Record<string, unknown>;
  approvalScope?: PendingApprovalScope;
  isCancelled?: () => boolean;
}): Promise<ApprovalAnswer> {
  const isCancelled = params.isCancelled ?? (() => false);
  const revision = () => useConversationAccessStore.getState().revisions[params.conversationId] || 0;
  const rejected = (atRevision: number): ApprovalAnswer => ({ approved: false, decision: 'once', revision: atRevision });
  if (isCancelled()) return rejected(revision());

  const db = DatabaseService.getInstance().getDbManager();
  const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  let resolveAnswer!: (answer: ApprovalAnswer) => void;
  const answer = new Promise<ApprovalAnswer>((resolve) => { resolveAnswer = resolve; });
  let decided = false;
  let unsubscribe: (() => void) | undefined;
  const decide = (approved: boolean, decision: ApprovalDecision = 'once') => {
    if (decided) return;
    decided = true;
    const atRevision = revision();
    unsubscribe?.();
    useAuthorizationStore.getState().removeAuthorization?.(params.id);
    resolveAnswer(approved && !isCancelled()
      ? { approved: true, decision, revision: atRevision }
      : rejected(atRevision));
  };

  useAuthorizationStore.getState().addPendingAuthorization({ id: params.id, messageId: params.runId,
    conversationId: params.conversationId,
    server: params.server, tool: params.tool, args: params.args, createdAt: Date.now(),
    scope: params.approvalScope,
    onApprove: (decision) => decide(true, decision), onReject: () => decide(false) });

  if (!decided && params.approvalScope?.automaticEligible) {
    const checkAutomatic = () => {
      if (!decided && isConversationAutomatic(params.conversationId)) {
        useAuthorizationStore.getState().approveAuthorization(params.id);
      }
    };
    unsubscribe = useConversationAccessStore.subscribe(checkAutomatic);
    checkAutomatic();
  }

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
    decide(false);
    return rejected((await answer).revision);
  }

  // Record an answer only after the pending row exists. Letting the run finish
  // earlier could let a late request mark that finished run as waiting again.
  if (isCancelled()) decide(false);
  const proposed = await answer;
  const approved = proposed.approved && !isCancelled();
  try {
    const status = approved ? 'approved' : 'rejected';
    const changed = tauri
      ? await (await import('@tauri-apps/api/core')).invoke<boolean>('agent_decide_approval', {
        db: db.getConnectionUrl(), approvalId: params.id, status, decidedAt: Date.now(),
      })
      : await db.executeTransaction(async (tx) => {
        await tx.execute("UPDATE agent_approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
          [status, Date.now(), params.id]);
        await tx.execute("UPDATE agent_runs SET status = 'running' WHERE id = ? AND status = 'waiting_approval'", [params.runId]);
        return true;
      });
    if (changed && approved && !isCancelled()) return proposed;
  } catch {
    // An unrecorded approval never enables execution.
  }
  return rejected(proposed.revision);
}

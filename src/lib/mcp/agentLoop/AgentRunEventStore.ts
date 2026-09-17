import type { ConversationEvent } from '@/lib/mcp/pipeline/context/ConversationEventLog';
import { DatabaseService } from '@/lib/database/services/DatabaseService';
import { generateId } from '@/lib/utils/id';

export type AgentRunStatus = 'running' | 'waiting_input' | 'waiting_approval' | 'paused' | 'completed' | 'cancelled' | 'failed' | 'interrupted';

export class AgentRunEventStore {
  private static async db() {
    const svc = DatabaseService.getInstance();
    if (!svc.isInitialized()) {
      await svc.initialize();
    }
    return svc.getDbManager();
  }

  private static isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  private static async native<T>(command: string, args: Record<string, unknown>): Promise<T | undefined> {
    if (!this.isTauriRuntime()) return undefined;
    const db = await this.db();
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, { db: db.getConnectionUrl(), ...args });
  }

  static async ensureRun(params: {
    runId: string;
    conversationId: string;
    assistantMessageId: string;
  }): Promise<void> {
    const now = Date.now();
    const native = await this.native<void>('agent_create_run', {
      runId: params.runId,
      conversationId: params.conversationId,
      assistantMessageId: params.assistantMessageId,
      startedAt: now,
    });
    if (native !== undefined || this.isTauriRuntime()) return;
    const db = await this.db();
    await db.execute(
      `INSERT OR IGNORE INTO agent_runs (id, conversation_id, assistant_message_id, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
      [params.runId, params.conversationId, params.assistantMessageId, now],
    );
  }

  static async setRunStatus(runId: string, status: AgentRunStatus): Promise<void> {
    const endedAt = status === 'running' ? null : Date.now();
    const native = await this.native<void>('agent_set_run_status', { runId, status, endedAt });
    if (native !== undefined || this.isTauriRuntime()) return;
    const db = await this.db();
    await db.execute(
      `UPDATE agent_runs SET status = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?`,
      [status, endedAt, runId],
    );
  }

  static async getRunStatus(runId: string): Promise<AgentRunStatus | undefined> {
    const db = await this.db();
    const rows = await db.select<{ status: AgentRunStatus }>(
      `SELECT status FROM agent_runs WHERE id = ? LIMIT 1`,
      [runId],
    );
    return rows[0]?.status;
  }

  static async appendEvent(params: {
    runId: string;
    conversationId: string;
    seq: number;
    event: ConversationEvent;
  }): Promise<number> {
    const eventId = generateId();
    const createdAt = Date.now();
    const native = await this.native<number>('agent_append_event', {
      eventId,
      runId: params.runId,
      conversationId: params.conversationId,
      eventType: params.event.type,
      payload: JSON.stringify(params.event),
      createdAt,
    });
    if (native !== undefined || this.isTauriRuntime()) return native as number;
    const db = await this.db();
    const eventType = params.event.type;
    await db.execute(
      `INSERT INTO agent_run_events (id, run_id, conversation_id, seq, event_type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        params.runId,
        params.conversationId,
        params.seq,
        eventType,
        JSON.stringify(params.event),
        createdAt,
      ],
    );
    return params.seq;
  }

  static async loadEvents(runId: string): Promise<ConversationEvent[]> {
    const db = await this.db();
    const rows = await db.select<{ payload: string }>(
      // The migration repairs duplicate sequences, but deterministic fallback
      // ordering keeps a partially migrated legacy database explainable.
      `SELECT payload FROM agent_run_events WHERE run_id = ? ORDER BY seq ASC, created_at ASC, id ASC`,
      [runId],
    );
    const out: ConversationEvent[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.payload) as ConversationEvent);
      } catch (error) {
        throw new Error(`agent run ${runId} contains corrupt event data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return out;
  }

  static async markStaleRunsCancelled(conversationId: string): Promise<void> {
    const db = await this.db();
    const rows = await db.select<{ id: string }>(
      `SELECT id FROM agent_runs WHERE conversation_id = ? AND status = 'running'`,
      [conversationId],
    );
    if (rows.length === 0) return;
    const now = Date.now();
    await db.execute(
      `UPDATE agent_runs SET status = 'cancelled', ended_at = ? WHERE conversation_id = ? AND status = 'running'`,
      [now, conversationId],
    );
    for (const row of rows) {
      await this.appendCancelEvent(row.id, conversationId);
    }
  }

  /** 应用启动时：保留运行记录并标记为 interrupted（尚不支持精确断点恢复）。 */
  static async markAllStaleRunsCancelled(): Promise<string[]> {
    const db = await this.db();
    const rows = await db.select<{ id: string; conversation_id: string; assistant_message_id: string }>(
      `SELECT id, conversation_id, assistant_message_id FROM agent_runs WHERE status = 'running'`,
    );
    if (rows.length === 0) return [];
    const now = Date.now();
    await db.execute(
      `UPDATE agent_runs SET status = 'interrupted', ended_at = ? WHERE status = 'running'`,
      [now],
    );
    for (const row of rows) {
      await this.appendCancelEvent(row.id, row.conversation_id);
    }
    return rows.map((r) => r.assistant_message_id);
  }

  static async getCancelledAssistantMessageIds(conversationId: string): Promise<Set<string>> {
    const db = await this.db();
    const rows = await db.select<{ assistant_message_id: string }>(
      `SELECT assistant_message_id FROM agent_runs WHERE conversation_id = ? AND status IN ('cancelled', 'interrupted')`,
      [conversationId],
    );
    return new Set(rows.map((r) => r.assistant_message_id));
  }

  private static async getNextSeq(runId: string): Promise<number> {
    const db = await this.db();
    const rows = await db.select<{ m: number }>(
      `SELECT COALESCE(MAX(seq), 0) as m FROM agent_run_events WHERE run_id = ?`,
      [runId],
    );
    return (rows[0]?.m || 0) + 1;
  }

  static async appendCancelEvent(runId: string, conversationId: string): Promise<void> {
    const seq = await this.getNextSeq(runId);
    await this.appendEvent({
      runId,
      conversationId,
      seq,
      event: { type: 'context_change', kind: 'other', content: 'agent_run_cancelled' },
    });
  }
}

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

  static async ensureRun(params: {
    runId: string;
    conversationId: string;
    assistantMessageId: string;
  }): Promise<void> {
    const db = await this.db();
    const now = Date.now();
    await db.execute(
      `INSERT OR IGNORE INTO agent_runs (id, conversation_id, assistant_message_id, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
      [params.runId, params.conversationId, params.assistantMessageId, now],
    );
  }

  static async setRunStatus(runId: string, status: AgentRunStatus): Promise<void> {
    const db = await this.db();
    const endedAt = status === 'running' ? null : Date.now();
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
  }): Promise<void> {
    const db = await this.db();
    const eventType = params.event.type;
    await db.execute(
      `INSERT INTO agent_run_events (id, run_id, conversation_id, seq, event_type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(),
        params.runId,
        params.conversationId,
        params.seq,
        eventType,
        JSON.stringify(params.event),
        Date.now(),
      ],
    );
  }

  static async loadEvents(runId: string): Promise<ConversationEvent[]> {
    const db = await this.db();
    const rows = await db.select<{ payload: string }>(
      `SELECT payload FROM agent_run_events WHERE run_id = ? ORDER BY seq ASC`,
      [runId],
    );
    const out: ConversationEvent[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.payload) as ConversationEvent);
      } catch {
        // skip corrupt row
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

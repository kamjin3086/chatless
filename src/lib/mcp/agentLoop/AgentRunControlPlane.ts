import type { Message as LlmMessage } from '@/lib/llm/types';
import {
  ConversationEventLog,
  type ConversationEvent,
  type RenderMode,
} from '@/lib/mcp/pipeline/context/ConversationEventLog';
import { ContextWindowManager } from '@/lib/mcp/pipeline/context/ContextWindowManager';
import { AgentRunEventStore, type AgentRunStatus } from './AgentRunEventStore';

const contextWindowManager = new ContextWindowManager();

function contextWindowForModel(model: string): number {
  return /qwen3\.8[-_]?flash[-_]?next/i.test(String(model || '')) ? 262_144 : 8_192;
}

export class AgentRunControlPlane {
  readonly eventLog = new ConversationEventLog();
  private seq = 0;
  private cancelled = false;

  constructor(
    readonly runId: string,
    readonly conversationId: string,
    readonly assistantMessageId: string,
  ) {}

  async start(): Promise<void> {
    await AgentRunEventStore.ensureRun({
      runId: this.runId,
      conversationId: this.conversationId,
      assistantMessageId: this.assistantMessageId,
    });
    const existing = await AgentRunEventStore.loadEvents(this.runId);
    for (const event of existing) {
      this.eventLog.append(event);
      this.seq += 1;
    }
  }

  async record(event: ConversationEvent): Promise<void> {
    this.eventLog.append(event);
    this.seq += 1;
    await AgentRunEventStore.appendEvent({
      runId: this.runId,
      conversationId: this.conversationId,
      seq: this.seq,
      event,
    });
  }

  async compactHistory(messages: LlmMessage[], provider: string, model: string): Promise<LlmMessage[]> {
    const compacted = await contextWindowManager.compact(messages, {
      provider,
      model,
      contextWindowTokens: contextWindowForModel(model),
      reserveOutputTokens: 8_192,
      safetyMarginRatio: 0.08,
      keepLastN: 24,
      allowSummarize: true,
    });
    if (compacted.length < messages.length) {
      await this.record({
        type: 'context_change',
        kind: 'other',
        content: `compacted history: ${messages.length} -> ${compacted.length} messages`,
      });
    }
    return compacted;
  }

  markCancelled(): void {
    this.cancelled = true;
  }

  async recordCancelled(): Promise<void> {
    this.cancelled = true;
    await this.record({
      type: 'context_change',
      kind: 'other',
      content: 'agent_run_cancelled',
    });
  }

  buildLlmMessages(baseHistory: LlmMessage[], renderMode: RenderMode = 'text_wrapper'): LlmMessage[] {
    const projected = this.eventLog.renderForModel(renderMode);
    if (projected.length === 0) return baseHistory;
    // History builders may already contain the current user turn. Consume one
    // matching user event from the event projection to avoid sending it twice.
    const existingUsers = new Map<string, number>();
    for (const message of baseHistory) {
      if (message.role !== 'user') continue;
      existingUsers.set(message.content, (existingUsers.get(message.content) || 0) + 1);
    }
    const filtered = projected.filter((message) => {
      if (message.role !== 'user') return true;
      const count = existingUsers.get(message.content) || 0;
      if (count <= 0) return true;
      existingUsers.set(message.content, count - 1);
      return false;
    });
    return [...baseHistory, ...filtered];
  }

  /**
   * Assemble messages for one LLM round: stable prefix (never compacted) + compacted variable suffix.
   */
  async assembleRoundMessages(params: {
    prefixMessages: LlmMessage[];
    baseHistory: LlmMessage[];
    renderMode: RenderMode;
    provider: string;
    model: string;
  }): Promise<LlmMessage[]> {
    const variable = this.buildLlmMessages(params.baseHistory, params.renderMode);
    const compactedVariable = await this.compactHistory(variable, params.provider, params.model);
    return [...params.prefixMessages, ...compactedVariable];
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  async finish(status: AgentRunStatus): Promise<void> {
    await AgentRunEventStore.setRunStatus(this.runId, status);
  }
}

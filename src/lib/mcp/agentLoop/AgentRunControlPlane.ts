import type { Message as LlmMessage } from '@/lib/llm/types';
import {
  ConversationEventLog,
  type ConversationEvent,
  type RenderMode,
} from '@/lib/mcp/pipeline/context/ConversationEventLog';
import { ContextWindowManager } from '@/lib/mcp/pipeline/context/ContextWindowManager';
import { AgentRunEventStore, type AgentRunStatus } from './AgentRunEventStore';

const contextWindowManager = new ContextWindowManager();

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
      maxInputTokens: 96_000,
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
    return [...baseHistory, ...projected];
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

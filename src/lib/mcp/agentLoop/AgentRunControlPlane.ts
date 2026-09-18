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
  private writes: Promise<void> = Promise.resolve();
  private checkpoint: Awaited<ReturnType<typeof AgentRunEventStore.loadLatestCheckpoint>> = undefined;

  constructor(
    readonly runId: string,
    readonly conversationId: string,
    readonly assistantMessageId: string,
    readonly source?: { parentRunId?: string; runKind?: 'normal' | 'continuation' | 'regeneration' },
  ) {}

  async start(): Promise<void> {
    await AgentRunEventStore.ensureRun({
      runId: this.runId,
      conversationId: this.conversationId,
      assistantMessageId: this.assistantMessageId,
      parentRunId: this.source?.parentRunId,
      runKind: this.source?.runKind,
    });
    const existing = await AgentRunEventStore.loadEvents(this.runId);
    for (const event of existing) {
      this.eventLog.append(event);
      this.seq += 1;
    }
    const loadCheckpoint = (AgentRunEventStore as typeof AgentRunEventStore & {
      loadLatestCheckpoint?: typeof AgentRunEventStore.loadLatestCheckpoint;
    }).loadLatestCheckpoint;
    this.checkpoint = typeof loadCheckpoint === 'function'
      ? await loadCheckpoint.call(AgentRunEventStore, this.runId)
      : undefined;
  }

  record(event: ConversationEvent): Promise<void> {
    // Serialize sequence allocation and persistence. Failed writes poison the
    // queue so later events cannot hide a missing durable boundary.
    this.writes = this.writes.then(async () => {
      const expectedSeq = this.seq + 1;
      const assigned = await AgentRunEventStore.appendEvent({
        runId: this.runId, conversationId: this.conversationId, seq: expectedSeq, event,
      });
      // Older test adapters and third-party callers returned void.  The Rust
      // store returns the authoritative sequence; retain the expected value
      // only for that backwards-compatible in-memory path.
      this.seq = typeof assigned === 'number' ? assigned : expectedSeq;
      this.eventLog.append(event);
    });
    return this.writes;
  }

  commitModelStep(events: ConversationEvent[]): Promise<void> {
    if (!events.length) return Promise.resolve();
    const commit = (AgentRunEventStore as typeof AgentRunEventStore & {
      commitModelStep?: typeof AgentRunEventStore.commitModelStep;
    }).commitModelStep;
    if (typeof commit !== 'function') {
      return events.reduce((promise, event) => promise.then(() => this.record(event)), Promise.resolve());
    }
    this.writes = this.writes.then(async () => {
      const finalSeq = await commit.call(AgentRunEventStore, { runId: this.runId,
        conversationId: this.conversationId, events });
      this.seq = finalSeq;
      events.forEach((event) => this.eventLog.append(event));
    });
    return this.writes;
  }

  async compactHistory(messages: LlmMessage[], provider: string, model: string): Promise<LlmMessage[]> {
    return contextWindowManager.compact(messages, { provider, model, allowSummarize: true });
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
    // Repeated user text can be an intentional correction or repeated request.
    // The caller owns the boundary between base history and this run's events.
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
    contextWindowTokens?: number;
    reserveOutputTokens?: number;
    tools?: unknown;
  }): Promise<LlmMessage[]> {
    const variable = this.buildLlmMessages(params.baseHistory, params.renderMode);
    const compactedVariable = await contextWindowManager.compact(variable, {
      provider: params.provider, model: params.model,
      contextWindowTokens: params.contextWindowTokens,
      reserveOutputTokens: params.reserveOutputTokens,
      prefixMessages: params.prefixMessages, tools: params.tools,
      allowSummarize: true,
      checkpoint: this.checkpoint,
      onCheckpoint: async (checkpoint) => {
        const saveCheckpoint = (AgentRunEventStore as typeof AgentRunEventStore & {
          saveCheckpoint?: typeof AgentRunEventStore.saveCheckpoint;
        }).saveCheckpoint;
        if (typeof saveCheckpoint === 'function') {
          await saveCheckpoint.call(AgentRunEventStore, this.runId, checkpoint);
        }
        this.checkpoint = checkpoint;
      },
    });
    return [...params.prefixMessages, ...compactedVariable];
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  async finish(status: AgentRunStatus): Promise<void> {
    // Drain failure diagnostics queued by stream callbacks before closing the run.
    await this.writes.catch(() => {});
    await AgentRunEventStore.setRunStatus(this.runId, status);
  }
}

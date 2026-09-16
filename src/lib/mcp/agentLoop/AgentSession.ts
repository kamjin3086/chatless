import { AgentLoopRunner } from './AgentLoopRunner';
import { AgentRunEventStore } from './AgentRunEventStore';
import type { AgentLoopRunParams } from './types';

export type AgentRunStatus =
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentSessionEvent = {
  runId: string;
  status: AgentRunStatus;
  event?: unknown;
  error?: Error;
};

export type AgentSessionListener = (event: AgentSessionEvent) => void;

type RunRecord = {
  params: AgentLoopRunParams;
  status: AgentRunStatus;
  completion: Promise<void>;
  resolveCompletion: () => void;
  rejectCompletion: (error: unknown) => void;
  listeners: Set<AgentSessionListener>;
};

/**
 * Small session facade around the loop.  The UI can subscribe to this object
 * without owning execution state, and all steering/stop operations target one
 * run id.  Persistence remains in AgentRunEventStore and is intentionally not
 * duplicated here.
 */
export class AgentSession {
  private static instance: AgentSession | undefined;
  private readonly runs = new Map<string, RunRecord>();

  static getInstance(): AgentSession {
    if (!AgentSession.instance) AgentSession.instance = new AgentSession();
    return AgentSession.instance;
  }

  start(params: AgentLoopRunParams): string {
    const runId = String(params.assistantMessageId || '').trim();
    if (!runId) throw new Error('assistantMessageId is required');
    const existing = this.runs.get(runId);
    if (existing?.status === 'running') return runId;

    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const record: RunRecord = {
      params,
      status: 'running',
      completion,
      resolveCompletion,
      rejectCompletion,
      listeners: new Set(),
    };
    this.runs.set(runId, record);
    this.emit(record, { runId, status: 'running' });

    void AgentLoopRunner.run({
      ...params,
      runtimeHooks: {
        ...params.runtimeHooks,
        onAgentStart: async (info) => {
          await params.runtimeHooks?.onAgentStart?.(info);
          this.update(runId, 'running');
        },
        onStreamEvent: (event, info) => {
          params.runtimeHooks?.onStreamEvent?.(event, info);
          this.emit(record, { runId, status: record.status, event });
        },
        onStreamError: async (error, info) => {
          await params.runtimeHooks?.onStreamError?.(error, info);
          this.update(runId, 'failed', error);
        },
        onAgentEnd: async (info) => {
          await params.runtimeHooks?.onAgentEnd?.(info);
          const persisted = await AgentRunEventStore.getRunStatus(runId).catch(() => undefined);
          const status: AgentRunStatus = persisted === 'waiting_input' || persisted === 'waiting_approval' || persisted === 'paused'
            ? persisted
            : persisted === 'failed' || persisted === 'interrupted' || persisted === 'cancelled'
              ? persisted
              : record.status === 'failed' || record.status === 'cancelled' ? record.status : 'completed';
          this.update(runId, status);
        },
      },
    }).then(() => {
      if (record.status === 'running') this.update(runId, 'completed');
      record.resolveCompletion();
    }).catch((error) => {
      this.update(runId, 'failed', error instanceof Error ? error : new Error(String(error)));
      record.rejectCompletion(error);
    });

    return runId;
  }

  /** Start a run and await its terminal state for callers that need the old
   * action-style Promise while keeping the session facade as the owner. */
  async run(params: AgentLoopRunParams): Promise<void> {
    const runId = this.start(params);
    await this.wait(runId);
  }

  wait(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    return record?.completion || Promise.resolve();
  }

  steer(runId: string, input: string): boolean {
    const record = this.runs.get(runId);
    if (!record || record.status !== 'running') return false;
    return AgentLoopRunner.steer(runId, input);
  }

  respond(runId: string, _requestId: string, response: unknown): boolean {
    const text = typeof response === 'string' ? response : JSON.stringify(response);
    const record = this.runs.get(runId);
    if (!record) return false;
    if (record.status === 'running') return this.steer(runId, text);
    if (record.status !== 'waiting_input' && record.status !== 'waiting_approval' && record.status !== 'paused' && record.status !== 'interrupted') {
      return false;
    }
    this.update(runId, 'running');
    this.start(record.params);
    // The resumed loop registers on the next microtask.
    queueMicrotask(() => { AgentLoopRunner.steer(runId, text); });
    return true;
  }

  stop(runId: string): void {
    const record = this.runs.get(runId);
    if (!record) return;
    this.update(runId, 'cancelled');
    AgentLoopRunner.cancel({ assistantMessageId: runId });
  }

  async resume(runId: string): Promise<string | undefined> {
    const record = this.runs.get(runId);
    if (!record || record.status === 'running') return undefined;
    return this.start(record.params);
  }

  subscribe(runId: string, listener: AgentSessionListener): () => void {
    const record = this.runs.get(runId);
    if (!record) return () => {};
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  getStatus(runId: string): AgentRunStatus | undefined {
    return this.runs.get(runId)?.status;
  }

  private update(runId: string, status: AgentRunStatus, error?: Error): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.status = status;
    this.emit(record, { runId, status, error });
  }

  private emit(record: RunRecord, event: AgentSessionEvent): void {
    for (const listener of record.listeners) {
      try { listener(event); } catch { /* listeners must not affect execution */ }
    }
  }
}

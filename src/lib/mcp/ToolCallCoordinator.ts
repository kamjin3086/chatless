// Centralized tool call coordination to avoid duplicate executions
// and overlapping follow-up streams.

// #region agent log
const DEBUG_LOG_ENDPOINT = 'http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737';
function debugLog(location: string, message: string, data?: unknown, hypothesisId?: string) {
  fetch(DEBUG_LOG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, message, data, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId }) }).catch(() => {});
}
// #endregion

type ToolCallStatus = 'running' | 'completed' | 'failed';

type ToolCallLock = {
  status: ToolCallStatus;
  timestamp: number;
  cardId?: string;
  source?: 'event' | 'fallback' | 'execute';
};

type AcquireResult = {
  acquired: boolean;
  key: string;
  existing?: ToolCallLock;
};

const TOOL_CALL_TTL_MS = 30000;
const FOLLOWUP_DEBOUNCE_MS = 500;

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return '[unknown]';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((key) => `${key}:${stableStringify(obj[key])}`);
  return `{${parts.join(',')}}`;
}

export class ToolCallCoordinator {
  private static instance: ToolCallCoordinator | null = null;

  private toolCallLocks = new Map<string, ToolCallLock>();
  private followupLocks = new Map<string, number>();

  static getInstance(): ToolCallCoordinator {
    if (!ToolCallCoordinator.instance) {
      ToolCallCoordinator.instance = new ToolCallCoordinator();
    }
    return ToolCallCoordinator.instance;
  }

  private buildToolCallKey(
    messageId: string,
    server: string,
    tool: string,
    args?: Record<string, unknown>,
    callId?: string
  ): string {
    if (callId && typeof callId === 'string' && callId.trim().length > 0) {
      // Native tool calling 下，优先使用 provider 返回的 tool_call_id 作为幂等键（避免 args 片段/顺序差异导致重复执行）
      return `${messageId}:${server}.${tool}:callId=${callId.trim()}`;
    }
    return `${messageId}:${server}.${tool}:${stableStringify(args || {})}`;
  }

  tryAcquireToolCallLock(params: {
    messageId: string;
    server: string;
    tool: string;
    args?: Record<string, unknown>;
    callId?: string;
    cardId?: string;
    source?: ToolCallLock['source'];
  }): AcquireResult {
    const { messageId, server, tool, args, callId, cardId, source } = params;
    const key = this.buildToolCallKey(messageId, server, tool, args, callId);
    const now = Date.now();
    const existing = this.toolCallLocks.get(key);

    if (existing && now - existing.timestamp < TOOL_CALL_TTL_MS) {
      // #region agent log
      debugLog('ToolCallCoordinator.ts:tryAcquireToolCallLock:reject', 'Tool call lock rejected', {
        key,
        existingStatus: existing.status,
        ageMs: now - existing.timestamp,
      }, 'H4');
      // #endregion
      return { acquired: false, key, existing };
    }

    this.toolCallLocks.set(key, {
      status: 'running',
      timestamp: now,
      cardId,
      source,
    });

    // #region agent log
    debugLog('ToolCallCoordinator.ts:tryAcquireToolCallLock:acquire', 'Tool call lock acquired', {
      key,
      source,
    }, 'H4');
    // #endregion

    this.cleanupToolCallLocks(now);
    return { acquired: true, key };
  }

  markToolCallComplete(key: string, status: ToolCallStatus): void {
    const now = Date.now();
    const existing = this.toolCallLocks.get(key);
    this.toolCallLocks.set(key, {
      status,
      timestamp: now,
      cardId: existing?.cardId,
      source: existing?.source,
    });

    // #region agent log
    debugLog('ToolCallCoordinator.ts:markToolCallComplete', 'Tool call lock marked complete', {
      key,
      status,
    }, 'H4');
    // #endregion

    this.cleanupToolCallLocks(now);
  }

  tryAcquireFollowupLock(messageId: string, windowMs: number = FOLLOWUP_DEBOUNCE_MS): boolean {
    const now = Date.now();
    const last = this.followupLocks.get(messageId);
    if (last && now - last < windowMs) {
      // #region agent log
      debugLog('ToolCallCoordinator.ts:tryAcquireFollowupLock:reject', 'Follow-up lock rejected', {
        messageId,
        ageMs: now - last,
      }, 'H6');
      // #endregion
      return false;
    }
    this.followupLocks.set(messageId, now);
    this.cleanupFollowupLocks(now);

    // #region agent log
    debugLog('ToolCallCoordinator.ts:tryAcquireFollowupLock:acquire', 'Follow-up lock acquired', {
      messageId,
    }, 'H6');
    // #endregion
    return true;
  }

  private cleanupToolCallLocks(now: number): void {
    if (this.toolCallLocks.size < 200) return;
    for (const [key, lock] of this.toolCallLocks.entries()) {
      if (now - lock.timestamp > TOOL_CALL_TTL_MS) {
        this.toolCallLocks.delete(key);
      }
    }
  }

  private cleanupFollowupLocks(now: number): void {
    if (this.followupLocks.size < 200) return;
    const cutoff = now - 60000;
    for (const [key, ts] of this.followupLocks.entries()) {
      if (ts < cutoff) this.followupLocks.delete(key);
    }
  }
}


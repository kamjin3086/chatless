/**
 * Per-level cost and latency accounting (#101).
 *
 * Observes; changes nothing. The user is being asked to trust a level they cannot see, so
 * every number here answers a question they can ask: which level actually went out, on which
 * carrier, how long it took, and how much of the output was thinking. Where a provider does
 * not report usage, that is recorded as "not reported" rather than as zero - a router that
 * says nothing and a model that thinks for free are different facts, and averaging them into
 * the same 0 is how a dashboard starts lying.
 *
 * This module is pure by design: aggregation and parsing are the parts worth testing. Storage
 * lives in `thinkingTelemetryStore`, and the capture point is the interpreter, which is the
 * one place that knows both the level that was applied and when the stream finished.
 */
import {
  THINKING_LEVEL_ORDER,
  type ThinkingCarrier,
  type ThinkingLevel,
  thinkingWireFor,
} from './thinkingLevels';

export interface ThinkingUsage {
  promptTokens?: number;
  completionTokens?: number;
  /** Tokens spent thinking. `undefined` means the provider did not say. */
  reasoningTokens?: number;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Pull the numbers out of whatever shape this provider used.
 *
 * Three vocabularies are in daily use: OpenAI's `prompt_tokens` family, the newer
 * `input_tokens` / `output_tokens_details` spelling, and Gemini's `usageMetadata`. Each
 * candidate is tried in order so a gateway that mixes them still lands on real numbers.
 */
export function parseThinkingUsage(usage: unknown): ThinkingUsage {
  if (!usage || typeof usage !== 'object') return {};
  const u = usage as Record<string, any>;
  const details = [u.completion_tokens_details, u.output_tokens_details].filter(
    (d) => d && typeof d === 'object',
  );

  const result: ThinkingUsage = {};
  const prompt =
    num(u.prompt_tokens) ?? num(u.input_tokens) ?? num(u.promptTokenCount);
  if (prompt !== undefined) result.promptTokens = prompt;
  const completion =
    num(u.completion_tokens) ??
    num(u.output_tokens) ??
    num(u.candidatesTokenCount) ??
    num(u.output_token_count);
  if (completion !== undefined) result.completionTokens = completion;
  for (const detail of details) {
    const reasoning =
      num(detail.reasoning_tokens) ?? num(detail.reasoningTokens);
    if (reasoning !== undefined) {
      result.reasoningTokens = reasoning;
      break;
    }
  }
  if (result.reasoningTokens === undefined) {
    const thoughts = num(u.thoughtsTokenCount) ?? num(u.thinking_tokens);
    if (thoughts !== undefined) result.reasoningTokens = thoughts;
  }
  return result;
}

export interface ThinkingTurnRecord extends ThinkingUsage {
  at: number;
  provider: string;
  model: string;
  level: ThinkingLevel;
  /** False when nothing went on the wire: `auto`, unverified, or a level the model lacks. */
  sent: boolean;
  carrier: ThinkingCarrier | null;
  durationMs: number;
  /** Did the provider report any usage at all. Separate from a reported zero. */
  usageReported: boolean;
  conversationId?: string;
  messageId?: string;
}

/**
 * Fold one more model request into the answer it belongs to.
 *
 * An agent-loop reply is several requests under one message id, and a user reading "what did
 * this answer cost" means the whole answer, not the last round. Times and tokens add up; a
 * round that reported nothing never overwrites a count that was reported; the level kept is
 * the one that actually went on the wire, since rounds share a level anyway and the first
 * round is not special.
 */
export function mergeThinkingTurn(
  existing: ThinkingTurnRecord,
  incoming: ThinkingTurnRecord,
): ThinkingTurnRecord {
  const sum = (a: number | undefined, b: number | undefined) =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    ...existing,
    at: Math.min(existing.at, incoming.at),
    level: !existing.sent && incoming.sent ? incoming.level : existing.level,
    sent: existing.sent || incoming.sent,
    carrier: existing.carrier ?? incoming.carrier,
    durationMs: existing.durationMs + incoming.durationMs,
    usageReported: existing.usageReported || incoming.usageReported,
    promptTokens: sum(existing.promptTokens, incoming.promptTokens),
    completionTokens: sum(existing.completionTokens, incoming.completionTokens),
    reasoningTokens: sum(existing.reasoningTokens, incoming.reasoningTokens),
    conversationId: existing.conversationId ?? incoming.conversationId,
    messageId: existing.messageId ?? incoming.messageId,
  };
}

export function buildThinkingTurn(args: {
  provider: string;
  model: string;
  level: ThinkingLevel | undefined;
  startedAt: number;
  endedAt: number;
  usage: unknown;
  conversationId?: string;
  messageId?: string;
}): ThinkingTurnRecord {
  const level: ThinkingLevel = args.level ?? 'auto';
  // The wire answer, not the stored wish: an unverified model or a tier it does not
  // advertise sends nothing, and telemetry that credited those turns with a level would
  // contradict the control on screen (#100).
  const wire = thinkingWireFor(args.provider, args.model, level);
  const usage = parseThinkingUsage(args.usage);
  const usageReported =
    usage.promptTokens !== undefined ||
    usage.completionTokens !== undefined ||
    usage.reasoningTokens !== undefined;
  return {
    at: args.endedAt,
    provider: args.provider,
    model: args.model,
    level: wire ? level : 'auto',
    sent: wire !== null,
    carrier: wire ? wire.carrier : null,
    durationMs: Math.max(0, args.endedAt - args.startedAt),
    usageReported,
    ...(usage.promptTokens !== undefined
      ? { promptTokens: usage.promptTokens }
      : {}),
    ...(usage.completionTokens !== undefined
      ? { completionTokens: usage.completionTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined
      ? { reasoningTokens: usage.reasoningTokens }
      : {}),
    ...(args.conversationId ? { conversationId: args.conversationId } : {}),
    ...(args.messageId ? { messageId: args.messageId } : {}),
  };
}

export interface ThinkingLevelAggregate {
  level: ThinkingLevel;
  sent: boolean;
  turns: number;
  /** Turns whose provider reported usage. Everything else is excluded from the totals. */
  usageTurns: number;
  /** How many of those turns actually carried a reasoning count. */
  reasoningTurns: number;
  totalMs: number;
  avgMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

/**
 * Compare levels over recent turns.
 *
 * Rows come back in the documented level order, not by arrival, because a table whose order
 * changes with the last message cannot be read. Totals ignore turns that reported nothing -
 * an average over turns where half the providers stayed silent would quietly flatter
 * whichever level happened to be used on chatty endpoints.
 */
export function aggregateThinkingTurns(
  turns: ThinkingTurnRecord[],
): ThinkingLevelAggregate[] {
  const byLevel = new Map<ThinkingLevel, ThinkingTurnRecord[]>();
  for (const turn of turns) {
    const list = byLevel.get(turn.level) ?? [];
    list.push(turn);
    byLevel.set(turn.level, list);
  }
  const rows: ThinkingLevelAggregate[] = [];
  for (const level of THINKING_LEVEL_ORDER) {
    const group = byLevel.get(level);
    if (!group || group.length === 0) continue;
    const withUsage = group.filter((t) => t.usageReported);
    const sum = (pick: (t: ThinkingTurnRecord) => number | undefined) =>
      withUsage.reduce((total, t) => total + (pick(t) ?? 0), 0);
    const totalMs = group.reduce((total, t) => total + t.durationMs, 0);
    rows.push({
      level,
      sent: group.some((t) => t.sent),
      turns: group.length,
      usageTurns: withUsage.length,
      reasoningTurns: group.filter((t) => t.reasoningTokens !== undefined)
        .length,
      totalMs,
      avgMs: Math.round(totalMs / group.length),
      promptTokens: sum((t) => t.promptTokens),
      completionTokens: sum((t) => t.completionTokens),
      reasoningTokens: sum((t) => t.reasoningTokens),
    });
  }
  return rows;
}

/** What a finished run has to say about itself, resolved at finish time. */
export interface ThinkingRunContext {
  provider: string;
  model: string;
  /** The level the run asked for; anything that is not a level means `auto`. */
  level: unknown;
  conversationId?: string;
  messageId?: string;
}

/**
 * Collect one run's cost, from the moment the request is built to its completion.
 *
 * A getter for the context, not a snapshot: the interpreter only settles which provider form
 * applies (a custom aggregator may be speaking as OpenAI-compatible) and which level survived
 * parameter policy after this watcher is created, and reading too early is how telemetry
 * ends up describing the request the user selected rather than the one that left.
 */
export function createThinkingTurnWatcher(args: {
  startedAt?: number;
  now?: () => number;
  context: () => ThinkingRunContext;
}): {
  startedAt: number;
  noteUsage: (usage: unknown) => void;
  finish: () => ThinkingTurnRecord;
} {
  const now = args.now ?? (() => Date.now());
  const startedAt = args.startedAt ?? now();
  let usage: unknown;
  return {
    startedAt,
    noteUsage(incoming: unknown): void {
      // Providers may send several frames; the last one with numbers is the bill.
      if (incoming && typeof incoming === 'object') usage = incoming;
    },
    finish(): ThinkingTurnRecord {
      const c = args.context();
      return buildThinkingTurn({
        provider: c.provider,
        model: c.model,
        level:
          typeof c.level === 'string' ? (c.level as ThinkingLevel) : undefined,
        startedAt,
        endedAt: now(),
        usage,
        ...(c.conversationId ? { conversationId: c.conversationId } : {}),
        ...(c.messageId ? { messageId: c.messageId } : {}),
      });
    },
  };
}

/**
 * `1m 05s` rather than `65000ms`: the point of the aggregate is comparison, and a column of
 * five-digit milliseconds cannot be compared at a glance. Zero keeps its own shape so a
 * sub-second turn is visibly different from a missing one.
 */
export function formatThinkingDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

/** Token counts, or the em dash that means "the provider did not say". */
export function formatThinkingTokens(tokens: number | undefined): string {
  if (tokens === undefined || !Number.isFinite(tokens)) return '—';
  return Math.round(tokens).toLocaleString('en-US');
}

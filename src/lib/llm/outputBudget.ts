/**
 * 单次请求的输出上限。
 *
 * 只做两件事：
 *  - 用户显式设了值 → 下发（并按上下文窗口收敛）；
 *  - 没设 → **不下发**，交给服务端决定。
 *
 * 早先的实现会在窗口已知时自动下发一个"自适应上限"（8K 窗口→2048、大窗口→8192）。
 * 那等于我们替模型决定了单次能说多久：262K 窗口的模型也被压到 8192，而 8K 窗口下又
 * 会因为预留过大让正常一轮判成超预算。上限不是必须由客户端决定的量，去掉这个猜测。
 *
 * 例外是协议必填的场景（Anthropic 的 `max_tokens` 是必填字段），由 Provider 适配层
 * 兜一个值，不在这里伪装成"用户设置"。
 */

/** 手动模式下滑块的默认值，同时作为"协议必填时兜底"和规划预留的上限。 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/** 规划预留时的下限。 */
export const MIN_ADAPTIVE_OUTPUT_TOKENS = 2048;

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

/**
 * @param contextWindow Model's total context window, when the provider reports
 *   it or the user set it. Unknown means "no clamp".
 * @param userMaxTokens Value the user configured. Absent means "do not send".
 * @returns The `max_tokens` to send, or undefined to send nothing.
 */
export function resolveOutputBudget(params: {
  contextWindow?: number | null;
  userMaxTokens?: number | null;
}): number | undefined {
  const requested = positiveInt(params.userMaxTokens);
  if (!requested) return undefined;
  const window = positiveInt(params.contextWindow);
  return window ? Math.min(requested, window) : requested;
}

/**
 * 压缩历史时为输出预留多少 token（只影响"要不要压缩"的判断，不影响请求体）。
 * 窗口未知时用下限即可——未知窗口不会触发压缩，见 ContextWindowManager。
 */
export function resolveOutputReserve(params: { contextWindow?: number | null }): number {
  const window = positiveInt(params.contextWindow);
  if (!window) return MIN_ADAPTIVE_OUTPUT_TOKENS;
  return Math.max(
    MIN_ADAPTIVE_OUTPUT_TOKENS,
    Math.min(DEFAULT_MAX_OUTPUT_TOKENS, Math.floor(window / 4)),
  );
}

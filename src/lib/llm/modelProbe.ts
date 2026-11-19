/**
 * The settings health probe: "is this model usable from this endpoint at all".
 *
 * It is deliberately small - one user turn, an eight-token cap - and it is not a
 * correctness test. The verdict therefore answers one question: did the endpoint
 * deliver a completion for this model? Two answers count as yes, and the probe
 * used to call both of them failures (#151):
 *
 * - the model answered (`answered`);
 * - the answer stopped at the probe's own eight-token cap (`truncated`) - the
 *   request arrived and the model replied, which is exactly what a reasoning model
 *   on a slow aggregator does before it has written a single visible word.
 *
 * Only "the endpoint refused/broke" and "an empty completion" are failures. The
 * openai-compatible provider reports truncation as `IncompleteResponseError`, so
 * the classification is the provider's, not a substring of a message.
 */
import { isIncompleteResponse } from './providers/incompleteResponse';

export const MODEL_PROBE_PROMPT = "Respond with only the word 'OK'";
export const MODEL_PROBE_MAX_OUTPUT_TOKENS = 8;

function estimateOutputTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

const MODEL_PROBE_INPUT_TOKENS = estimateOutputTokens(MODEL_PROBE_PROMPT);

/** What the button may cost at most: the prompt plus the output cap. */
export const MODEL_PROBE_TOKEN_BOUND =
  MODEL_PROBE_INPUT_TOKENS + MODEL_PROBE_MAX_OUTPUT_TOKENS;

export type ModelProbeStatus = 'answered' | 'truncated' | 'empty' | 'failed';

export interface ModelProbeResult {
  /** Reachability: `answered` and `truncated` are both reachable. */
  ok: boolean;
  status: ModelProbeStatus;
  durationMs: number;
  /** Input plus the output the probe could at most have produced. */
  tokenEstimate: number;
  /** Set for `truncated`: the `finish_reason` the endpoint sent. */
  finishReason?: string;
  /** Set when not ok: the provider's own explanation, user-readable where it can be. */
  message?: string;
}

type ChatFn = (
  provider: string,
  model: string,
  messages: Array<{ role: 'user'; content: string }>,
  options: Record<string, unknown>,
) => Promise<{ content?: string } | null | undefined>;

export interface ProbeModelDeps {
  /** Injected by tests; the app passes nothing and the real `chat` is loaded. */
  chat?: ChatFn;
  now?: () => number;
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const withMessage = error as { userMessage?: unknown; message?: unknown };
    if (
      typeof withMessage.userMessage === 'string' &&
      withMessage.userMessage
    ) {
      return withMessage.userMessage;
    }
    if (typeof withMessage.message === 'string' && withMessage.message) {
      return withMessage.message;
    }
  }
  return '测试失败';
}

export async function probeModel(
  provider: string,
  model: string,
  deps: ProbeModelDeps = {},
): Promise<ModelProbeResult> {
  const now = deps.now ?? (() => Date.now());
  const chat: ChatFn =
    deps.chat ?? ((await import('@/lib/llm')).chat as unknown as ChatFn);

  const inputTokenEstimate = MODEL_PROBE_INPUT_TOKENS;
  const startedAt = now();

  try {
    const result = await chat(
      provider,
      model,
      [{ role: 'user', content: MODEL_PROBE_PROMPT }],
      {
        temperature: 0,
        maxTokens: MODEL_PROBE_MAX_OUTPUT_TOKENS,
        stream: true,
      },
    );
    const durationMs = now() - startedAt;
    const content = String(result?.content ?? '').trim();

    if (!content) {
      return {
        ok: false,
        status: 'empty',
        message: '响应内容为空，可能为不兼容的返回格式',
        durationMs,
        tokenEstimate: inputTokenEstimate + 1,
      };
    }
    return {
      ok: true,
      status: 'answered',
      durationMs,
      tokenEstimate: inputTokenEstimate + estimateOutputTokens(content),
    };
  } catch (error) {
    const durationMs = now() - startedAt;

    if (isIncompleteResponse(error)) {
      const finishReason =
        typeof (error as { finishReason?: unknown }).finishReason === 'string'
          ? (error as { finishReason: string }).finishReason
          : 'length';
      return {
        ok: true,
        status: 'truncated',
        finishReason,
        durationMs,
        // The cap is the most the probe can have spent on output.
        tokenEstimate: inputTokenEstimate + MODEL_PROBE_MAX_OUTPUT_TOKENS,
      };
    }

    return {
      ok: false,
      status: 'failed',
      message: messageOf(error),
      durationMs,
      tokenEstimate: inputTokenEstimate,
    };
  }
}

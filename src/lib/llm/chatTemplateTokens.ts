/**
 * Chat-template control tokens.
 *
 * An OpenAI-compatible server can hand back the model's *raw template output*
 * instead of a parsed message (llama.cpp started with a mismatched chat
 * template, a gateway that renders the prompt itself, a model that was asked to
 * continue a preformatted prompt, ...). The model then keeps writing after its
 * own end-of-turn token and invents the following turns of the conversation.
 * The client used to accept that invented turn as the answer: a user who sent
 * "你很厉害哦" was told "你的消息好像没发完" - about a truncated message the
 * model had made up itself, because its leaked `<|im_start|>user` turn had no
 * end.
 *
 * Two consumers share these lists:
 *   - `providers/thinking/turnBoundary.ts` cuts the *stream* at the first
 *     turn boundary and drops everything after it;
 *   - `mcp/toolInstruction/filter.ts` strips leftovers from text that is
 *     displayed or persisted (including messages stored before this fix).
 *
 * The GPT-OSS harmony tokens (`<|start|>`, `<|end|>`, `<|channel|>`,
 * `<|message|>`, `<|constrain|>`, `<|call|>`, `<|return|>`) are deliberately
 * absent: this app parses those on purpose as its text tool-call format, so
 * treating them as template noise would break GPT-OSS tool calls.
 */

/**
 * Tokens that end the assistant turn. Everything after the first one is the
 * model writing turns that were never requested.
 */
export const TURN_END_TOKENS = [
  '<|im_end|>', // ChatML (Qwen, Yi, many fine-tunes)
  '<|eot_id|>', // Llama 3
  '<|eom_id|>', // Llama 3.1 end-of-message (expects a tool result)
  '<|eot|>', // several server templates
  '<|end_of_turn|>', // Gemma
  '<|endoftext|>', // GPT-2 / Qwen base
  '<|end_of_text|>', // Llama 3 base
  '<|end▁of▁sentence|>', // DeepSeek
  '<｜end▁of▁sentence｜>', // DeepSeek, fullwidth bars
] as const;

/**
 * Tokens that open a turn. At the very start of a stream they are template
 * noise (`<|im_start|>assistant`); once text has been produced they mean the
 * model has moved on to another turn.
 */
export const TURN_OPEN_TOKENS = [
  '<|im_start|>', // ChatML
  '<|start_header_id|>', // Llama 3
] as const;

/** Header markers that are never worth showing, wherever they appear. */
export const HEADER_TOKENS = ['<|end_header_id|>'] as const;

/** Stripped from text but never treated as the end of a turn. */
export const STRIP_ONLY_TOKENS = [...TURN_OPEN_TOKENS, ...HEADER_TOKENS];

/** Every template token this app knows about. */
export const ALL_TEMPLATE_TOKENS = [...TURN_END_TOKENS, ...STRIP_ONLY_TOKENS];

/**
 * Passed as an OpenAI-compatible `stop` list when the caller configured none.
 *
 * Stopping server-side prevents the continuation from being generated at all,
 * and a sequence that never appears in honest output is a no-op. Capped at
 * four entries because llama.cpp accepts at most four.
 */
export const TURN_BOUNDARY_STOP_SEQUENCES = [
  '<|im_end|>',
  '<|eot_id|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A template token, plus the role word a leaked template puts right after it
 * (`<|im_start|>assistant\n`). The role word is only removed together with the
 * token, so ordinary prose is never touched.
 */
const TEMPLATE_TOKEN_PATTERN = new RegExp(
  `(?:${ALL_TEMPLATE_TOKENS.map(escapeRegExp).join('|')})[^\\S\\n]*(?:(?:user|assistant|system|developer|tool)\\b[^\\S\\n]*:?[^\\S\\n]*)?\\n*`,
  'g',
);

export function containsTemplateTokens(text: string): boolean {
  if (!text) return false;
  return ALL_TEMPLATE_TOKENS.some((token) => text.includes(token));
}

/** Removes chat-template control tokens from text that is shown to the user. */
export function stripTemplateTokens(text: string): string {
  if (!containsTemplateTokens(text)) return text;
  return text.replace(TEMPLATE_TOKEN_PATTERN, '');
}

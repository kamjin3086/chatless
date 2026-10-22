/**
 * What may leave this app as a request option.
 *
 * The options bag a provider receives is this app's working set: the parameters the user
 * chose, the provider-native fields they typed, and our own bookkeeping - the scheduler
 * lease, request ids, the `chat()` markers, telemetry ids, the resolved context window,
 * and `streaming`, which is a flag this app interprets while the wire says `stream`.
 *
 * Providers build a request body out of that bag, and copying it wholesale is exactly what
 * made NVIDIA NIM answer `400 Validation: Unsupported parameter(s): __schedulerLease,
 * __requestId, streaming` (#151). A denylist inside each provider is how the next internal
 * key gets out, so the boundary is stated once, as a rule about the key's origin:
 *
 * - keys this app owns (`__*`, ids, flags, the resolved window) are never wire fields;
 * - names this app invented for a parameter (`maxTokens`, `topP`, ...) are translated by
 *   the provider that understands them, reading the original bag, so the generic name
 *   must not survive alongside the wire name - a strict server rejects it as unknown;
 * - payloads this app shapes and each provider re-shapes (`tools`, `extensions`, ...) are
 *   rebuilt by the provider from the original bag, never forwarded.
 *
 * Everything else is a wire field already - `temperature`, `max_tokens`, `top_p`,
 * `reasoning_effort`, a provider-native `thinking` object, a field from the advanced-JSON
 * box - and passes through untouched.
 *
 * This file does not say which fields a provider supports or what each one is called; that
 * is `provider-field-support.ts`'s table. The rule here is narrower and answers a
 * different question: which names belong to this app, and therefore never reach a server.
 *
 * Four of the names below are also a wire field in some protocol - `stop` and `tools` for
 * OpenAI, `options` and `format` for Ollama. They stay on the list on purpose: the provider
 * writes that field itself, from the original bag, and the app's copy must still not
 * travel, or a server that spells it differently sees both.
 */

/**
 * Options this app reads, or that a provider renames, so they are never wire names.
 *
 * `__`-prefixed keys need no entry here. For everything else this list is the whole
 * answer, and a new app-side name that is added without it will leak: the check in
 * `__tests__/wireOptions.test.ts` keeps it in step with the dialogs' field table, which is
 * the other place these names are written down.
 */
const APP_ONLY_KEYS: ReadonlySet<string> = new Set([
  // Bookkeeping: our ids, our flags, our resolved numbers.
  'conversationId',
  'messageId',
  'contextWindowTokens',
  'thinkingModelSuffixes',
  'thinkingLevel',
  'streaming',
  // Parameter names this app invented; each provider maps them to its own field.
  'maxTokens',
  'maxOutputTokens',
  'topP',
  'topK',
  'minP',
  'frequencyPenalty',
  'presencePenalty',
  'stop',
  'stopSequences',
  // The generic output format. Ollama reads it from the original bag and writes the
  // top-level `format` field itself; every other provider must not forward the app name.
  'format',
  'numPredict',
  'numCtx',
  'repeatLastN',
  'repeatPenalty',
  // App-shaped payloads that providers rebuild in their own shape.
  'tools',
  'toolChoice',
  'parallelToolCalls',
  'extensions',
  'mcpServers',
  'options',
]);

/**
 * True for a key that describes the request to this app rather than to the server.
 * `__`-prefixed keys are internal by convention (`__schedulerLease`, `__requestId`,
 * `__signal`, `__priority`, `__internal`, `__silentMode`), so that half of the rule needs no
 * maintenance; the named half is the list above.
 */
export function isAppOnlyOption(key: string): boolean {
  return key.startsWith('__') || APP_ONLY_KEYS.has(key);
}

/** A copy of `options` with only the keys that may become wire fields. */
export function toWireOptions(
  options: Record<string, unknown> | undefined | null,
): Record<string, any> {
  const wire: Record<string, any> = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    if (isAppOnlyOption(key)) continue;
    wire[key] = value;
  }
  return wire;
}

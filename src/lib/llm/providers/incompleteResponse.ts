/**
 * A completion the endpoint delivered but did not finish.
 *
 * `finish_reason: length` (or `content_filter`) is not a transport failure: the
 * request arrived, the model answered, and the answer stopped early. Callers that
 * only ask "is this endpoint alive" (the settings health probe, #151) must be able
 * to tell that apart from a refused or broken request, so the reason travels as a
 * typed error instead of a string the caller has to parse.
 */
export class IncompleteResponseError extends Error {
  readonly code = 'INCOMPLETE_RESPONSE';
  readonly finishReason: string;

  constructor(
    finishReason: string,
    message = `Response incomplete: ${finishReason}`,
  ) {
    super(message);
    this.name = 'IncompleteResponseError';
    this.finishReason = finishReason;
  }
}

/**
 * Code-based so it survives a bundled/proxied copy of this module; the message is
 * never the discriminator.
 */
export function isIncompleteResponse(
  error: unknown,
): error is IncompleteResponseError {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof IncompleteResponseError) return true;
  return (error as { code?: unknown }).code === 'INCOMPLETE_RESPONSE';
}

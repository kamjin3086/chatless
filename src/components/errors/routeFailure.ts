/**
 * What a failed render must keep visible: the route and the error text. Kept as a pure
 * function so the visible-detail rule is testable without a browser.
 */
export interface RouteFailureDetails {
  message: string;
  stack?: string;
  componentStack?: string;
  route: string;
}

export function describeRouteFailure(
  error: unknown,
  route: string,
  componentStack?: string | null,
): RouteFailureDetails {
  const failure = error instanceof Error ? error : new Error(String(error));
  const message = failure.message.trim() || failure.name;
  return {
    message,
    stack: failure.stack,
    componentStack: componentStack?.trim() || undefined,
    route: route || '/',
  };
}

/** On the chat route itself there is nowhere "back" to; retry is the useful action. */
export function canReturnToChat(pathname: string): boolean {
  return pathname !== '/chat';
}

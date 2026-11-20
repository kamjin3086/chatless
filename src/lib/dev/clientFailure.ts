const ROUTES = new Set([
  '/',
  '/chat',
  '/settings',
  '/prompts',
  '/knowledge',
  '/history',
  '/extensions',
  '/resources',
]);

const ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'NotFoundError',
  'InvalidStateError',
  'HierarchyRequestError',
  'ChunkLoadError',
  'ModuleParseError',
  'AbortError',
]);

/** Keep only known routes and generated bundle positions. Error messages, eval
 * frames, query strings and function names can all contain user or provider data. */
export function describeClientFailure(
  reason: unknown,
  pathname: string,
  kind: 'error' | 'rejection' | 'render',
) {
  const route = pathname.replace(/\/$/u, '') || '/';
  const error =
    reason instanceof Error || reason instanceof DOMException ? reason : null;
  const name = error && ERROR_NAMES.has(error.name) ? error.name : 'Unknown';
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const locations = [
    ...stack
      .slice(0, 8192)
      .matchAll(
        /(?:\/_next\/static\/chunks\/|webpack-internal:\/{2,3}(?:\([\w-]+\)\/)?\.\/)([\w./%-]+\.[jt]sx?):(\d+):(\d+)/gu,
      ),
  ]
    .slice(0, 6)
    .map(([, chunk, line, column]) => `${chunk}:${line}:${column}`);
  return {
    kind,
    route: ROUTES.has(route) ? route : '[other]',
    name,
    locations,
  };
}

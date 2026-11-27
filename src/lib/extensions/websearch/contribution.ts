/**
 * Web search as a contribution (third pilot, plan §10 phase 2 flow).
 *
 * Takes the three `web`-server tools out of the hand-written CORE group. The
 * difference from the two previous pilots is WHERE the user's choice lives:
 * web search has a real persisted setting (`isWebSearchEnabled` in the web
 * search store), and today it suppresses INJECTION only - a call that
 * arrives while the setting is off still reaches the adapter and answers
 * with the adapter's own error. That is preserved by modeling the toggle as
 * the availability predicate, NOT as extension enablement: injection follows
 * the toggle, execution routing deliberately ignores availability (A08), so
 * a late call behaves exactly as before.
 *
 * The predicate makes the group DETECTABLE, so injection keeps the core-group
 * semantics it had: toggle on = tools in every step, toggle off = gone from
 * the next step, no sticky residue (`stickyWhenLoaded: false`).
 *
 * The store read arrives through assembly injection - this file stays free
 * of store imports (§4.2). `download` keeps its unregistered risk: it writes
 * to disk and must not inherit the read class of search/fetch.
 */
import {
  WEB_SEARCH_SERVER_NAME,
  WEB_SEARCH_TOOLS,
} from '@/lib/mcp/nativeTools/webSearch';
import type { BuiltinExtension } from '../contracts';

export interface WebSearchDeps {
  /** The persisted user setting; false hides the tools from the next step. */
  isWebSearchEnabled(): boolean;
}

const READ_WEB_TOOLS = new Set(['search', 'fetch']);

export function createWebSearchExtension(
  deps: WebSearchDeps,
): BuiltinExtension {
  return {
    id: 'web_search',
    defaultEnabled: true,
    toolGroups: [
      {
        id: 'web_search',
        replaces: 'web_search',
        // Group copy for the catalog. The tools kept their own verbatim
        // descriptions (that is the text the model matches against); this
        // line is new because the old text lived on the core group,
        // describing fs+shell+web together.
        name: 'Web search',
        description: 'Internet search and page fetch (user-enabled capability)',
        server: WEB_SEARCH_SERVER_NAME,
        stickyWhenLoaded: false,
        tools: WEB_SEARCH_TOOLS.map((definition) => ({
          definition,
          // From the one risk table (web_search row registers search/fetch
          // read); download writes to disk and stays `unknown`, approval as
          // before (ADR 0003).
          risk: READ_WEB_TOOLS.has(definition.name)
            ? ('read' as const)
            : ('unknown' as const),
        })),
        availability: () => deps.isWebSearchEnabled(),
        loadAdapter: async () => {
          // Executor stays a core pipeline adapter; the bridge loads it on
          // first execution, never during discovery (A04).
          const mod = await import(
            '@/lib/mcp/pipeline/adapters/WebSearchAdapter'
          );
          return new mod.WebSearchAdapter();
        },
      },
    ],
  };
}

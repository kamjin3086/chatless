/**
 * Build-time validation and derived capability views (internal-extension plan §5.3/§5.4).
 *
 * Everything here is pure: the registry validates static contributions and
 * answers questions about them. It does not load adapters, does not consult
 * stores directly (enablement and availability arrive as injected callbacks)
 * and keeps no second copy of any tool fact - every view is derived on demand
 * from the validated contributions, so "single source of truth" cannot drift
 * from itself.
 */
import {
  TOOL_GROUPS,
  TOOLS_DISCOVER_SERVER_NAME,
} from '@/lib/mcp/nativeTools/toolRegistry';
import { RESERVED_MCP_SERVER_NAMES } from '@/lib/mcp/serverNamePolicy';
import {
  isBuiltinServer,
  normalizeServerName,
  normalizeToolName,
} from '@/lib/mcp/toolNaming';
import { toolRisk } from '@/lib/mcp/pipeline/policy/toolRisk';
import { EXTENSION_SLUG_RE } from './contracts';
import type {
  AvailabilityContext,
  BuiltinExtension,
  ExtensionId,
  ToolGroupContribution,
} from './contracts';

export type RegistryIssueCode =
  | 'duplicate-extension'
  | 'duplicate-group'
  | 'duplicate-tool'
  | 'reserved-server'
  | 'reserved-group'
  | 'invalid-replaces'
  | 'empty-group'
  | 'invalid-id'
  | 'missing-adapter'
  | 'risk-drift';

export interface RegistryIssue {
  code: RegistryIssueCode;
  message: string;
}

export class ExtensionRegistryError extends Error {
  readonly issues: readonly RegistryIssue[];
  constructor(issues: readonly RegistryIssue[]) {
    super(
      `extension registry rejected: ${issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`,
    );
    this.name = 'ExtensionRegistryError';
    this.issues = issues;
  }
}

/**
 * Live core namespaces an optional contribution may not squat on (§5.3: core
 * groups cannot be overridden). Derived from TOOL_GROUPS itself so the set can
 * never rot against the hand-written catalog; alias spellings are folded with
 * the same normalization the pipeline uses (`file-system` === `fs`).
 *
 * Namespaces may be taken over only through an explicit `replaces`
 * declaration (the knowledge pilot: `replaces: 'knowledge'`), which must name
 * a core or migrated namespace; everything else uses fresh ids/servers.
 */
const CORE_GROUP_IDS = new Set<string>(
  TOOL_GROUPS.map((g) => normalizeServerName(g.id)),
);
const CORE_SERVER_NAMES = new Set<string>(
  TOOL_GROUPS.flatMap((g) => g.tools.map((t) => normalizeServerName(t.server))),
);
CORE_SERVER_NAMES.add(TOOLS_DISCOVER_SERVER_NAME);

/**
 * Namespaces whose hand-written group has left TOOL_GROUPS but whose server is
 * still spoken by core registrations: `knowledge` (pipeline adapter,
 * conversation grant bucket, replay table) and `prompt` (approval branch in
 * policy.ts on the `system` server, risk-table row, tool-card presentation
 * branch). They stay reserved and are handed over only via `replaces`.
 * Cleanup condition: retire when those registrations sit behind the
 * contribution (phase 4 review).
 *
 * A handover names the retired core GROUP and owns two slots: its group id
 * and its server name (`prompt`/`system`, `knowledge`/`knowledge`). Each
 * migrated name is liftable only through its own slot under `replaces` - a
 * contribution may keep its own group id while taking over the handover's
 * server, but it cannot borrow one handover's slot for the other's name.
 */
const MIGRATED_CORE_HANDOVERS: Record<
  string,
  { groupId: string; server: string }
> = {
  knowledge: { groupId: 'knowledge', server: 'knowledge' },
  prompt: { groupId: 'prompt', server: 'system' },
};
const MIGRATED_CORE_NAMESPACES = new Set(Object.keys(MIGRATED_CORE_HANDOVERS));
// The migrated namespaces stay reserved (they are still spoken by core
// registrations) and are handed over only via `replaces`. Cleanup condition
// (phase 4 review): when conversationAccessStore's grant bucket,
// toolRisk's replay membership and the pipeline adapter registrations sit
// behind the contribution, drop them from the reserved sets and retire the
// MIGRATED list.
for (const handover of Object.values(MIGRATED_CORE_HANDOVERS)) {
  CORE_GROUP_IDS.add(handover.groupId);
  CORE_SERVER_NAMES.add(handover.server);
}

export interface BuildRegistryOptions {
  /**
   * Where persisted enablement exists it is injected here. Return undefined to
   * fall back to the extension's `defaultEnabled`. No tool-GROUP-level persisted
   * enablement exists today - the web-search toggle (webSearchStore) is a
   * per-tool flag and MCP `enabled` (mcp_servers.json) is per external server -
   * so the default stays "use the static default". See the Phase 0 audit record
   * attached to PR A's description.
   */
  isEnabled?: (extensionId: ExtensionId) => boolean | undefined;
}

/**
 * Four states, one vocabulary (external review 2026-11-26, adopted):
 *
 * - **Registered** - `group()/groups()`: identity exists and the namespace is
 *   protected (external MCP cannot take it). Carries no runtime judgment.
 * - **Available** - `enabledGroups()` ∩ availability predicates, surfaced as
 *   `availableGroups()/availableGroup()`: enabled AND current platform /
 *   session / data conditions hold. Prompt INJECTION consumes it: history
 *   (sticky loads, pending requests) may only decide disclosure of still-
 *   available groups - it can never revive an unavailable one. The
 *   `tools__search` catalog deliberately consumes the ENABLED view instead:
 *   discovery reveals that a capability exists so the model can request a
 *   mount; gated there, an unmounted capability could never be discovered.
 * - **Exposed** - the tools actually injected for this model step; derived,
 *   not stored in the registry (promptBuilder owns it). Detection is a
 *   predicate-only signal: a contribution group without a predicate is
 *   injected from load records (discovery hit, then sticky), never merely
 *   because it is constantly available.
 * - **Authorized** - the concrete call passed core approval and the
 *   executor's own data-scope check. Execution routing (ContributionAdapter)
 *   matches identity within `enabledGroups()`; availability deliberately
 *   does not gate execution - an unmounted knowledge call must still reach
 *   the executor's scope error, which is the pre-migration user-visible
 *   behavior (A08), and a disabled extension routes to no adapter at all
 *   (A05).
 */
export interface ExtensionRegistry {
  readonly extensions: ReadonlyMap<ExtensionId, BuiltinExtension>;
  group(id: string): ToolGroupContribution | undefined;
  groups(): readonly ToolGroupContribution[];
  /**
   * Groups whose extension is enabled (persisted hook or static default),
   * sync - the executor-routing view. Deliberately excludes availability
   * predicates: whether a capability currently holds for a conversation is not
   * whether its executor exists (an unmounted knowledge call must still reach
   * the executor's own scope error, as before the migration). A disabled
   * extension contributes nothing here, which is A05 at the routing seam.
   */
  enabledGroups(): readonly ToolGroupContribution[];
  /** Registered-state name claim (four states): a contributed server name is
   * owned by that group - external MCP configs may not take it, and the
   * executor bridge routes it. Full groups view: disabled or not, the name
   * stays claimed while registered. */
  serverClaim(server: string): { groupId: string } | undefined;
  /** Single-group Availability check (enabled + predicate, §5.4 isolation).
   * For prompt blocks and any one-off "is this capability live for this
   * conversation right now" question - the deduplicated authority behind the
   * knowledge mount query (replaces the per-callsite store/SQL lookups). */
  availableGroup(
    id: string,
    ctx?: { conversationId?: string },
  ): Promise<ToolGroupContribution | undefined>;
  /** Sticky session loading after a discovery hit; unknown ids stick (the
   * hand-written groups this replaced did). Normalized lookup, default true. */
  isSticky(groupId: string): boolean;
  /**
   * The Availability view (see four states above): enabled extension AND group
   * availability predicate. Prompt injection consumes it; the catalog uses the
   * enabled view (discovery vs injection split, see the four-states note).
   * Execution routing uses identity within `enabledGroups()` instead
   * (A08/A05 split above).
   *
   * An availability predicate that throws hides only its own group (§5.4
   * failure isolation): predicates read persisted conversation state in PR B,
   * and one flaky store must not blank the whole capability view.
   */
  availableGroups(
    ctx?: AvailabilityContext,
  ): Promise<readonly ToolGroupContribution[]>;
  /** Normalized tool names for a server, for callers that route by tool. */
  knownTools(server: string): ReadonlySet<string>;
}

function issue(
  issues: RegistryIssue[],
  code: RegistryIssueCode,
  message: string,
): void {
  issues.push({ code, message });
}

/**
 * Validate static contributions and return the derived views.
 *
 * Throws `ExtensionRegistryError` on any issue: the manifest is static, so a
 * violation is a programming error and must fail at program start / build,
 * never silently at first call.
 */
export function buildExtensionRegistry(
  extensions: readonly BuiltinExtension[],
  options: BuildRegistryOptions = {},
): ExtensionRegistry {
  const issues: RegistryIssue[] = [];
  const byId = new Map<ExtensionId, BuiltinExtension>();
  const groupsById = new Map<string, ToolGroupContribution>();
  const ownerByGroupId = new Map<string, BuiltinExtension>();
  const seenServerTool = new Set<string>();

  for (const ext of extensions) {
    if (!EXTENSION_SLUG_RE.test(ext.id)) {
      issue(
        issues,
        'invalid-id',
        `extension id "${ext.id}" must match ${EXTENSION_SLUG_RE}`,
      );
    }
    if (byId.has(ext.id)) {
      issue(
        issues,
        'duplicate-extension',
        `extension id "${ext.id}" contributed twice`,
      );
      continue;
    }
    byId.set(ext.id, ext);

    for (const group of ext.toolGroups) {
      const where = `extension "${ext.id}" group "${group.id}"`;
      const nServer = normalizeServerName(group.server);
      const nGroupId = normalizeServerName(group.id);
      const nReplaces = group.replaces
        ? normalizeServerName(group.replaces)
        : '';
      const nTool = normalizeToolName;
      if (!EXTENSION_SLUG_RE.test(group.id)) {
        issue(
          issues,
          'invalid-id',
          `${where}: group id must match ${EXTENSION_SLUG_RE}`,
        );
      }
      if (!nServer || !EXTENSION_SLUG_RE.test(nServer)) {
        issue(
          issues,
          'invalid-id',
          `${where}: server name "${group.server}" must match ${EXTENSION_SLUG_RE} after normalization`,
        );
      }
      if (
        group.replaces &&
        !MIGRATED_CORE_NAMESPACES.has(nReplaces) &&
        !CORE_GROUP_IDS.has(nReplaces)
      ) {
        issue(
          issues,
          'invalid-replaces',
          `${where}: replaces "${group.replaces}" is not a core or migrated namespace`,
        );
      }
      // A contribution may squat on a migrated namespace only by taking it over
      // by name (knowledge pilot); everything else stays reserved (§5.3).
      // Each migrated name is liftable only through its OWN slot of the named
      // handover: the server slot lifts the server name, the group-id slot
      // lifts the group id. A contribution may bring its own group id while
      // taking over the handover's server (the pilot fixtures do this), but
      // it can never borrow one handover's slot for the other name - that is
      // what the review round 2 pair-mixing finding boils down to.
      const handover = MIGRATED_CORE_HANDOVERS[nReplaces];
      const takesServer = (name: string) => name === handover?.server;
      const takesGroup = (name: string) => name === handover?.groupId;
      if (
        !takesServer(nServer) &&
        (RESERVED_MCP_SERVER_NAMES.has(group.server) ||
          isBuiltinServer(nServer) ||
          CORE_SERVER_NAMES.has(nServer))
      ) {
        // Core / builtin server namespace - squatting here would let an
        // optional contribution shadow a core capability (§5.3). External MCP
        // servers are refused the same names (serverNamePolicy).
        issue(
          issues,
          'reserved-server',
          `${where}: server "${group.server}" is a core/builtin namespace (takeover needs an explicit replaces of that namespace)`,
        );
      }
      if (!takesGroup(nGroupId) && CORE_GROUP_IDS.has(nGroupId)) {
        issue(
          issues,
          'reserved-group',
          `${where}: group id collides with a live core group`,
        );
      }
      if (group.tools.length === 0) {
        issue(issues, 'empty-group', `${where}: contributes no tools`);
      }
      if (!group.loadAdapter) {
        // A visible group with no executor is exactly the ghost capability the
        // phase 3 acceptance forbids ("seen by the model, unexecutable").
        // Knowledge's existing adapter will be pointed at by the PR B pilot.
        issue(
          issues,
          'missing-adapter',
          `${where}: no loadAdapter, group could be visible but unexecutable`,
        );
      }
      if (groupsById.has(nGroupId)) {
        issue(
          issues,
          'duplicate-group',
          `${where}: group id already contributed (merging is not defined)`,
        );
      } else {
        groupsById.set(nGroupId, group);
        ownerByGroupId.set(nGroupId, ext);
      }

      const seenToolHere = new Set<string>();
      for (const tool of group.tools) {
        const rawName =
          typeof tool.definition.name === 'string' ? tool.definition.name : '';
        const name = nTool(rawName);
        const label = `${where} tool "${rawName}"`;
        if (!rawName) {
          issue(issues, 'invalid-id', `${label}: missing name`);
        }
        if (seenToolHere.has(name)) {
          issue(
            issues,
            'duplicate-tool',
            `${label}: duplicated within the group`,
          );
        }
        seenToolHere.add(name);
        const pairKey = `${nServer}\u0000${name}`;
        if (seenServerTool.has(pairKey)) {
          issue(
            issues,
            'duplicate-tool',
            `${label}: already contributed for server "${nServer}"`,
          );
        }
        seenServerTool.add(pairKey);

        // ADR 0003: one risk table, two predicates. The declaration must equal
        // what the table already answers; a new name that wants `read` has to
        // land in READ_TOOLS as a deliberate, reviewed edit (a new fs-tool
        // name is exactly where filesystemOp() fail-opens to read today, and a
        // silent 'read' claim here would paper over that same hole).
        const tableRisk = toolRisk(nServer, name);
        if (tableRisk !== tool.risk) {
          issue(
            issues,
            'risk-drift',
            `${label}: declares "${tool.risk}" but the risk table answers "${tableRisk}"`,
          );
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new ExtensionRegistryError(issues);
  }

  const groups = Object.freeze([...groupsById.values()]);
  const toolsByServer = new Map<string, ReadonlySet<string>>();
  for (const g of groups) {
    const key = normalizeServerName(g.server);
    const merged = new Set(toolsByServer.get(key) ?? []);
    for (const t of g.tools) merged.add(normalizeToolName(t.definition.name));
    toolsByServer.set(key, merged);
  }

  // One enabled+predicate implementation (review dedup): the Availability
  // judgment must not drift between the set view and the single-group view.
  // Predicates run concurrently (each is an independent data-presence check -
  // the knowledge one hits SQLite - a serial loop would add per-extension
  // latency to the prompt build); a failing predicate hides only its own group.
  const groupAvailable = async (
    g: ToolGroupContribution,
    ctx: { conversationId?: string },
  ): Promise<boolean> => {
    const owner = ownerByGroupId.get(g.id);
    if (!owner) return false;
    if (!(options.isEnabled?.(owner.id) ?? owner.defaultEnabled)) return false;
    if (!g.availability) return true;
    try {
      return await g.availability(ctx);
    } catch {
      return false; // §5.4: a failing predicate hides its own group, nothing more
    }
  };

  return {
    extensions: byId,
    group: (id) => groupsById.get(normalizeServerName(id)),
    isSticky: (id) =>
      groupsById.get(normalizeServerName(id))?.stickyWhenLoaded !== false,
    groups: () => groups,
    enabledGroups: () =>
      groups.filter((g) => {
        const owner = ownerByGroupId.get(g.id);
        return (
          !!owner && (options.isEnabled?.(owner.id) ?? owner.defaultEnabled)
        );
      }),
    serverClaim: (server) => {
      const n = normalizeServerName(server);
      const g = groups.find((x) => normalizeServerName(x.server) === n);
      return g ? { groupId: g.id } : undefined;
    },
    async availableGroup(id, ctx = {}) {
      const g = groupsById.get(normalizeServerName(id));
      if (!g) return undefined;
      return (await groupAvailable(g, ctx)) ? g : undefined;
    },
    async availableGroups(ctx = {}) {
      const flags = await Promise.all(
        groups.map((g) => groupAvailable(g, ctx)),
      );
      return groups.filter((_g, i) => flags[i]);
    },
    knownTools: (server) =>
      toolsByServer.get(normalizeServerName(server)) ?? new Set(),
  };
}

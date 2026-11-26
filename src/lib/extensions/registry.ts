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
 * Inheriting an existing builtin group (the knowledge pilot takes over the
 * `knowledge` group) is deliberately NOT possible yet: it needs an explicit
 * `replaces` channel, which arrives with the consumer rewiring in PR B together
 * with the audit record of what it replaces. Until then contributions use new
 * ids/servers only.
 */
const CORE_GROUP_IDS = new Set<string>(
  TOOL_GROUPS.map((g) => normalizeServerName(g.id)),
);
const CORE_SERVER_NAMES = new Set<string>(
  TOOL_GROUPS.flatMap((g) => g.tools.map((t) => normalizeServerName(t.server))),
);
CORE_SERVER_NAMES.add(TOOLS_DISCOVER_SERVER_NAME);

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

export interface ExtensionRegistry {
  readonly extensions: ReadonlyMap<ExtensionId, BuiltinExtension>;
  group(id: string): ToolGroupContribution | undefined;
  groups(): readonly ToolGroupContribution[];
  /**
   * The single availability view: enabled extension AND group availability.
   * Discovery, injection and execution must consume this same function so no
   * "visible but unexecutable" ghost capability can exist (plan §10 phase 3).
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
        RESERVED_MCP_SERVER_NAMES.has(group.server) ||
        isBuiltinServer(nServer) ||
        CORE_SERVER_NAMES.has(nServer)
      ) {
        // Core / builtin server namespace - squatting here would let an
        // optional contribution shadow a core capability (§5.3). External MCP
        // servers are refused the same names (serverNamePolicy).
        issue(
          issues,
          'reserved-server',
          `${where}: server "${group.server}" is a core/builtin namespace (takeover needs the PR B replaces channel)`,
        );
      }
      if (CORE_GROUP_IDS.has(normalizeServerName(group.id))) {
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
      if (groupsById.has(group.id)) {
        issue(
          issues,
          'duplicate-group',
          `${where}: group id already contributed (merging is not defined)`,
        );
      } else {
        groupsById.set(group.id, group);
        ownerByGroupId.set(group.id, ext);
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

  return {
    extensions: byId,
    group: (id) => groupsById.get(id),
    groups: () => groups,
    async availableGroups(ctx = {}) {
      const out: ToolGroupContribution[] = [];
      for (const g of groups) {
        const owner = ownerByGroupId.get(g.id);
        if (!owner) continue;
        const enabled = options.isEnabled?.(owner.id) ?? owner.defaultEnabled;
        if (!enabled) continue;
        if (g.availability) {
          let ok = false;
          try {
            ok = await g.availability(ctx);
          } catch {
            ok = false; // §5.4: a failing predicate hides its own group, nothing more
          }
          if (!ok) continue;
        }
        out.push(g);
      }
      return out;
    },
    knownTools: (server) =>
      toolsByServer.get(normalizeServerName(server)) ?? new Set(),
  };
}

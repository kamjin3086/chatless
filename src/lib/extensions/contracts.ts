/**
 * Contribution contract for builtin extensions (internal-extension plan §5).
 *
 * A contribution is data only - it describes a capability, it never runs policy.
 * Every decision derived from contributions happens in `registry.ts` (build time)
 * and in the existing tool pipeline (run time), per ADR 0001: the pipeline owns
 * side effects and the policy layer stays pure.
 *
 * The risk vocabulary is imported from the one risk table (ADR 0003). A
 * contribution may declare an intent, and the registry cross-checks that intent
 * against the table at build time; it can never invent a classification of its
 * own or grow a second approval path.
 */
import type { McpTool } from '@/lib/mcp/McpClient';
import type { ToolRisk } from '@/lib/mcp/pipeline/policy/toolRisk';
import type { ToolAdapter } from '@/lib/mcp/pipeline/ToolAdapter';

export type ExtensionId = string;

/**
 * Context a group's availability is computed in. Availability is a per-call
 * predicate on purpose: today's knowledge group is "enabled iff the
 * conversation has a knowledge base" (promptBuilder recomputes it every model
 * step), and the contract must be able to express that without a persisted
 * global toggle - see Phase 0 audit finding on enable-state semantics.
 */
export interface AvailabilityContext {
  conversationId?: string;
}

/** Display metadata fed to the existing tool-card presentation layer (§5.2). */
export interface ExtensionToolPresentation {
  titleKey?: string;
  /** Closed set from §5.2 - the card layer must not grow branches per extension. */
  kind?: 'generic' | 'query' | 'path' | 'url' | 'shell';
  detailArg?: string;
}

export interface ExtensionToolContribution {
  /** Existing McpTool shape; names must satisfy the existing normalization. */
  definition: McpTool;
  /**
   * Declared risk, cross-checked against `toolRisk()` at registry build time.
   * A new tool that wants `read` must already be in the risk table, exactly as
   * a hand-written registration would (ADR 0003: registration is security work).
   */
  risk: ToolRisk;
  presentation?: ExtensionToolPresentation;
}

export interface ToolGroupContribution {
  /** Group id string, not the legacy static union - that union is what this contract retires. */
  id: string;
  /**
   * Declares that this group takes over an existing core group/server of the
   * same name (the knowledge pilot: `replaces: 'knowledge'`). The only channel
   * allowed to squat on a migrated core namespace (§5.3); without it the
   * reserved checks reject the contribution.
   */
  replaces?: string;
  /**
   * Sticky session loading after `tools__search` picked it up (§5.3 semantics
   * today: knowledge recomputes per step and must NOT stick, because a revoked
   * mount must not keep its tools visible). Default true.
   */
  stickyWhenLoaded?: boolean;
  name: string;
  description: string;
  server: string;
  tools: ExtensionToolContribution[];
  /**
   * Computed per model step at runtime; absence means the group is available
   * whenever its extension is enabled. May read persisted conversation state
   * but must not mutate anything (ADR 0001).
   */
  availability?: (ctx: AvailabilityContext) => boolean | Promise<boolean>;
  /** Required (§5.2): a group without an executor is a visible-but-unexecutable ghost.
   * Lazy loading (§5.3): called on first execution, never during discovery. */
  loadAdapter: () => Promise<ToolAdapter>;
}

export interface BuiltinExtension {
  id: ExtensionId;
  /**
   * Static default for the enablement view. Where a persisted enablement
   * exists it is injected into the registry as a hook; no tool-GROUP-level
   * persisted toggle exists today (the web-search toggle is per-tool, MCP
   * `enabled` is per external server). A contribution may not persist state
   * by itself.
   */
  defaultEnabled: boolean;
  toolGroups: ToolGroupContribution[];
}

/** Slugs are lowercase with separators; they double as storage and i18n key fragments. */
export const EXTENSION_SLUG_RE = /^[a-z][a-z0-9._-]*$/;

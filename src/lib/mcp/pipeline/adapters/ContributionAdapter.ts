import { normalizeServerName, normalizeToolName } from '@/lib/mcp/toolNaming';
import { getExtensionRegistry } from '@/lib/extensions/assembly';
import type { ExtensionRegistry } from '@/lib/extensions/registry';
import type { ToolGroupContribution } from '@/lib/extensions/contracts';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

/**
 * Phase 3 executor wiring (plan §10): a contributed group's `loadAdapter`
 * factory IS its executor. Routing matches the declared TOOL IDENTITY
 * (normalized server + tool must be in the group's declared tools), so two
 * groups sharing one server never dispatch to the wrong adapter, and an
 * undeclared tool on a contributed server routes to no adapter at all -
 * NO_ADAPTER before any approval card, like a disabled extension or a
 * retired server (A05).
 *
 * The factory runs at most once per group, on first execution, and its
 * adapter is cached here (A04: discovery and prompt building never load it).
 * A failed load is retried on the next execution (A13 init-failure).
 *
 * Availability deliberately does NOT gate execution: an unmounted knowledge
 * call must reach the executor's own scope error, which is the user-visible
 * behavior from before the migration (A08). The post-load re-check below is
 * the enablement race guard (external review P0-5).
 */
export class ContributionAdapter implements ToolAdapter {
  readonly server = 'extensions';
  private readonly loaded = new Map<string, Promise<ToolAdapter>>();

  constructor(
    private readonly registry: () => ExtensionRegistry = getExtensionRegistry,
  ) {}

  private owningGroup(
    invocation: ToolInvocation,
  ): ToolGroupContribution | undefined {
    const server = normalizeServerName(invocation.server);
    const tool = normalizeToolName(invocation.tool);
    return this.registry()
      .enabledGroups()
      .find(
        (g) =>
          normalizeServerName(g.server) === server &&
          g.tools.some((t) => normalizeToolName(t.definition.name) === tool),
      );
  }

  canHandle(invocation: ToolInvocation): boolean {
    return this.owningGroup(invocation) !== undefined;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const group = this.owningGroup(invocation);
    if (!group) return this.noAdapter(invocation);
    let adapter = this.loaded.get(group.id);
    if (!adapter) {
      adapter = group.loadAdapter();
      this.loaded.set(group.id, adapter);
      // A13: a failed initialization must be retryable - cache the rejection
      // only for concurrent callers sharing this attempt, then drop it (a
      // stale chunk 404 after an update must not disable the capability for
      // the whole session).
      adapter.catch(() => {
        if (this.loaded.get(group.id) === adapter) this.loaded.delete(group.id);
      });
    }
    const loaded = await adapter;
    // Race guard (external review P0-5): the extension may have been disabled
    // mid-load, or the server+tool identity may have moved to another group.
    // The SAME group must still own this identity before the loaded adapter
    // may execute - a late load must not run for a capability that is gone
    // or dispatch through a stale group's adapter.
    if (this.owningGroup(invocation)?.id !== group.id) {
      return this.noAdapter(invocation);
    }
    return loaded.execute(invocation);
  }

  /** Same vocabulary as the pipeline's own no-adapter path; ok:false marks
   * the card failed instead of recording the miss as a success. */
  private noAdapter(invocation: ToolInvocation) {
    return {
      ok: false,
      error: 'NO_ADAPTER',
      message: `no enabled extension contributes ${String(invocation.server || '?')}__${String(invocation.tool || '?')}`,
    };
  }
}

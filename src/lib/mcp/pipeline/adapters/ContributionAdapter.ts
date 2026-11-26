import { normalizeServerName } from '@/lib/mcp/toolNaming';
import { getExtensionRegistry } from '@/lib/extensions/assembly';
import type { ExtensionRegistry } from '@/lib/extensions/registry';
import type { ToolGroupContribution } from '@/lib/extensions/contracts';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

/**
 * Phase 3 executor wiring (plan §10): a contributed group's `loadAdapter`
 * factory IS its executor. The bridge claims a server exactly when an enabled
 * extension contributes it, so a disabled extension rejects at routing -
 * NO_ADAPTER before any approval card (A05, same shape as retired servers).
 *
 * The factory runs at most once per server, on first execution, and its
 * adapter is cached here (A04: discovery and prompt building never load it).
 *
 * Availability deliberately does NOT gate execution: an unmounted knowledge
 * call must reach the executor's own scope error, which is the user-visible
 * behavior from before the migration.
 *
 * One claim per server: if two groups ever contribute the same server (the
 * registry allows it while tool pairs stay unique), the first one owns
 * execution - harmless today with a single contribution, worth revisiting
 * when a second contributor lands.
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
    return this.registry()
      .enabledGroups()
      .find((g) => normalizeServerName(g.server) === server);
  }

  canHandle(invocation: ToolInvocation): boolean {
    return this.owningGroup(invocation) !== undefined;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const group = this.owningGroup(invocation);
    if (!group) {
      // Race only (the registry is a singleton; a test-injected registry could
      // flip between canHandle and execute). ok:false makes the pipeline's
      // fatal-failure detection mark the card failed, matching its own
      // no-adapter path instead of recording the miss as a success.
      return {
        ok: false,
        error: 'NO_ADAPTER',
        message: `no enabled extension contributes server "${invocation.server}"`,
      };
    }
    const server = normalizeServerName(group.server);
    let adapter = this.loaded.get(server);
    if (!adapter) {
      adapter = group.loadAdapter();
      this.loaded.set(server, adapter);
      // A13: a failed initialization must be retryable - cache the rejection
      // only for concurrent callers sharing this attempt, then drop it (a
      // stale chunk 404 after an update must not disable the capability for
      // the whole session).
      adapter.catch(() => {
        if (this.loaded.get(server) === adapter) this.loaded.delete(server);
      });
    }
    return (await adapter).execute(invocation);
  }
}

/**
 * Web search pilot (third contribution): the toggle is availability, not
 * enablement, and the write tool keeps its unregistered risk.
 */
import { describe, expect, it } from 'vitest';
import { buildExtensionRegistry } from '@/lib/extensions/registry';
import { createWebSearchExtension } from '../contribution';
import { ContributionAdapter } from '@/lib/mcp/pipeline/adapters/ContributionAdapter';
import { toolRisk } from '@/lib/mcp/pipeline/policy/toolRisk';

function registryWith(enabled: boolean) {
  return buildExtensionRegistry([
    createWebSearchExtension({ isWebSearchEnabled: () => enabled }),
  ]);
}

function invocation(tool: string) {
  return {
    server: 'web',
    tool,
    args: {},
    conversationId: 'c1',
    id: `call-${tool}`,
  } as never;
}

describe('web search contribution', () => {
  it('carries the three legacy tools with the table risks (download is NOT a read)', () => {
    const group = registryWith(true).group('web_search')!;
    expect(group.server).toBe('web');
    expect(group.tools.map((t) => t.definition.name).sort()).toEqual([
      'download',
      'fetch',
      'search',
    ]);
    for (const t of group.tools) {
      expect(t.risk, t.definition.name).toBe(
        toolRisk('web', t.definition.name),
      );
    }
    expect(toolRisk('web', 'download')).toBe('unknown');
  });

  it('the toggle drives availability: off hides from the next step, routing is untouched', async () => {
    const on = registryWith(true);
    const off = registryWith(false);
    expect(await on.availableGroup('web_search', {})).toBeDefined();
    expect(await off.availableGroup('web_search', {})).toBeUndefined();
    // A08: a late call with the toggle off still reaches the executor's own
    // answer (the bridge routes the enabled view, not availability) - same
    // as pre-migration, where the static adapter answered regardless of the
    // setting. Routing must NOT return NO_ADAPTER here.
    const bridge = new ContributionAdapter(() => off);
    expect(bridge.canHandle(invocation('search'))).toBe(true);
  });

  it('is detectable but never sticky: predicate groups inject from availability alone', async () => {
    const reg = registryWith(true);
    expect(reg.group('web_search')!.availability).toBeDefined();
    expect(reg.isSticky('web_search')).toBe(false);
  });
});

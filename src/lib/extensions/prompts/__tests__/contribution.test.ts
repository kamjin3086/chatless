/**
 * Prompt management pilot (second contribution, plan §10 phase 2 flow).
 *
 * The pilot's contract-level assertions: the contribution passes the shipped
 * registry build with the hand-written group gone, keeps the pre-migration
 * runtime semantics (always-available, sticky, read risks from the table),
 * and routes through the bridge exactly like knowledge does - with writes
 * still landing in core approval, untouched.
 */
import { describe, expect, it } from 'vitest';
import { getExtensionRegistry } from '@/lib/extensions/assembly';
import { ContributionAdapter } from '@/lib/mcp/pipeline/adapters/ContributionAdapter';
import { createDefaultAdapters } from '@/lib/mcp/pipeline/adapters/index';
import { toolRisk } from '@/lib/mcp/pipeline/policy/toolRisk';

const PROMPT_TOOLS = [
  'list_prompts',
  'get_prompt',
  'create_prompt',
  'update_prompt',
  'delete_prompt',
  'optimize_prompt',
];

function invocation(tool: string) {
  return {
    server: 'system',
    tool,
    args: {},
    conversationId: 'c1',
    id: `call-${tool}`,
  } as never;
}

describe('prompt management contribution', () => {
  it('takes over the prompt group with its legacy shape (same id, server, tools)', () => {
    const registry = getExtensionRegistry();
    const group = registry.group('prompt')!;
    expect(group).toBeDefined();
    expect(group.server).toBe('system');
    expect(group.tools.map((t) => t.definition.name).sort()).toEqual(
      [...PROMPT_TOOLS].sort(),
    );
    // The hand-written group is gone from the core catalog; the migrated
    // namespace list is what keeps the names reserved while registrations
    // (policy branch, risk row, card presentation) still live in core.
    // Sticky stays at the default true: a discovery hit keeps working in
    // later steps (no data-presence story here).
    expect(registry.isSticky('prompt')).toBe(true);
  });

  it('availability is pure enablement: no predicate, available with no context', async () => {
    const registry = getExtensionRegistry();
    expect(registry.group('prompt')!.availability).toBeUndefined();
    expect(await registry.availableGroup('prompt')).toBeDefined();
  });

  it('declared risks match the one table: reads stay reads, writes stay unknown', () => {
    const group = getExtensionRegistry().group('prompt')!;
    for (const t of group.tools) {
      const name = t.definition.name;
      const expected =
        name === 'list_prompts' || name === 'get_prompt'
          ? ('read' as const)
          : ('unknown' as const);
      expect(t.risk, name).toBe(expected);
      expect(toolRisk('system', name), name).toBe(expected);
    }
  });

  it('routes through the bridge by declared identity; the static system adapter is retired', async () => {
    const adapters = createDefaultAdapters();
    expect(adapters.some((a) => a.server === 'system')).toBe(false);
    const bridge = adapters.find(
      (a) => a instanceof ContributionAdapter,
    ) as ContributionAdapter;
    for (const name of PROMPT_TOOLS) {
      expect(bridge.canHandle(invocation(name)), name).toBe(true);
    }
    // list_skills was a policy.ts allowlist relic with no adapter branch ever
    // handling it; undeclared identities now stop at routing instead of
    // reaching the adapter's catch-all error (both pre-migration and now the
    // call was an error - only the error's vocabulary moved earlier).
    expect(bridge.canHandle(invocation('list_skills'))).toBe(false);
    const result = (await bridge.execute(invocation('list_skills'))) as {
      error?: string;
    };
    expect(result.error).toBe('NO_ADAPTER');
  });
});

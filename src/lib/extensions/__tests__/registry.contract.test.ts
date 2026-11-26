/**
 * Registry contract tests (plan §11.4 `registry.contract.test`): uniqueness,
 * normalization collisions, reserved namespaces, availability views, failure
 * isolation and the ADR 0003 risk-table cross-check. Written before the
 * implementation (plan §10 phase 1: "conflict/disable/dependency tests first").
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildExtensionRegistry, ExtensionRegistryError } from '../registry';
import type { RegistryIssue } from '../registry';
import type { BuiltinExtension, ToolGroupContribution } from '../contracts';
import {
  buildCase,
  exampleExtension,
  exampleFactory,
  exampleFlag,
  knowledgeStyleExtension,
  knowledgeStyleFlag,
  secondExtension,
  stubTool,
  throwingExtension,
} from './fixtures/example';

const groupAdapter = (server: string) => async () => ({
  server,
  canHandle: () => true,
  execute: async () => ({}),
});

function issuesOf(fn: () => unknown): RegistryIssue[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ExtensionRegistryError) return [...err.issues];
    throw err;
  }
  return [];
}

function groupWith(
  overrides: Partial<ToolGroupContribution> & { id: string; server: string },
): ToolGroupContribution {
  return {
    name: 'n',
    description: 'd',
    tools: [stubTool],
    loadAdapter: groupAdapter(overrides.server),
    ...overrides,
  };
}

describe('buildExtensionRegistry - validation', () => {
  it('accepts the shipped fixtures', () => {
    expect(() =>
      buildExtensionRegistry([
        exampleExtension,
        secondExtension,
        knowledgeStyleExtension,
        throwingExtension,
      ]),
    ).not.toThrow();
  });

  it('rejects duplicate extension ids', () => {
    const dup = { ...exampleExtension, id: 'example', toolGroups: [] };
    const codes = issuesOf(() =>
      buildExtensionRegistry([exampleExtension, dup]),
    ).map((i) => i.code);
    expect(codes).toContain('duplicate-extension');
  });

  it('rejects a group id contributed twice across extensions', () => {
    const clone: BuiltinExtension = {
      ...secondExtension,
      id: 'second-clone',
      toolGroups: secondExtension.toolGroups.map((g) => ({
        ...g,
        loadAdapter: groupAdapter(g.server),
      })),
    };
    const codes = issuesOf(() =>
      buildExtensionRegistry([secondExtension, clone]),
    ).map((i) => i.code);
    expect(codes).toContain('duplicate-group');
  });

  it('rejects reserved pseudo-server and core/builtin servers, including alias spellings', () => {
    const bad = buildCase({
      id: 'squatter',
      toolGroups: [
        groupWith({ id: 'g.a', server: 'tools' }),
        groupWith({ id: 'g.b', server: 'fs' }),
        groupWith({ id: 'g.c', server: 'knowledge' }),
      ],
    });
    const codes = issuesOf(() => buildExtensionRegistry([bad])).map(
      (i) => i.code,
    );
    expect(codes.filter((c) => c === 'reserved-server')).toHaveLength(3);
  });

  it('rejects group ids that collide with live core groups', () => {
    const bad = buildCase({
      id: 'groupclash',
      toolGroups: [groupWith({ id: 'knowledge', server: 'clashserver' })],
    });
    expect(
      issuesOf(() => buildExtensionRegistry([bad])).map((i) => i.code),
    ).toContain('reserved-group');
  });

  it('rejects duplicate tools after server-name normalization (file-system === fs)', () => {
    const a = buildCase({
      id: 'a',
      toolGroups: [
        groupWith({
          id: 'g.a',
          server: 'fs',
          tools: [{ definition: { name: 'probe' }, risk: 'unknown' }],
        }),
      ],
    });
    const b = buildCase({
      id: 'b',
      toolGroups: [
        groupWith({
          id: 'g.b',
          server: 'file-system',
          tools: [{ definition: { name: 'probe' }, risk: 'unknown' }],
        }),
      ],
    });
    const codes = issuesOf(() => buildExtensionRegistry([a, b])).map(
      (i) => i.code,
    );
    expect(codes).toContain('duplicate-tool');
  });

  it('rejects duplicated tool names including case normalization', () => {
    const bad = buildCase({
      id: 'collide',
      toolGroups: [
        groupWith({
          id: 'g.collide',
          server: 'collide',
          tools: [
            { definition: { name: 'search' }, risk: 'unknown' },
            { definition: { name: 'Search' }, risk: 'unknown' },
          ],
        }),
      ],
    });
    expect(
      issuesOf(() => buildExtensionRegistry([bad])).map((i) => i.code),
    ).toContain('duplicate-tool');
  });

  it('rejects empty groups, adapter-less groups and non-slug ids', () => {
    const empty = buildCase({ id: 'emptyg' });
    empty.toolGroups = [
      { ...groupWith({ id: 'g.e', server: 'e' }), tools: [] },
    ];
    expect(
      issuesOf(() => buildExtensionRegistry([empty])).map((i) => i.code),
    ).toContain('empty-group');

    const noAdapter = buildCase({
      id: 'ghost',
      toolGroups: [
        {
          ...groupWith({ id: 'g.g', server: 'ghostserver' }),
          loadAdapter: undefined as never,
        },
      ],
    });
    expect(
      issuesOf(() => buildExtensionRegistry([noAdapter])).map((i) => i.code),
    ).toContain('missing-adapter');

    const badIds = buildCase({ id: 'Bad ID' });
    expect(
      issuesOf(() => buildExtensionRegistry([badIds])).map((i) => i.code),
    ).toContain('invalid-id');

    const badServer = buildCase({
      id: 'badserver',
      toolGroups: [groupWith({ id: 'g.ok', server: 'Has Space' })],
    });
    expect(
      issuesOf(() => buildExtensionRegistry([badServer])).map((i) => i.code),
    ).toContain('invalid-id');
  });

  it('rejects replaces pointing at nothing and only lifts the named namespace', () => {
    const bad = buildCase({
      id: 'lies',
      toolGroups: [
        {
          ...groupWith({ id: 'g.b', server: 'ghostserver' }),
          replaces: 'nonexistent',
        },
      ],
    });
    expect(
      issuesOf(() => buildExtensionRegistry([bad])).map((i) => i.code),
    ).toContain('invalid-replaces');

    // replaces='knowledge' lifts the knowledge namespace but NOT another core one.
    const partial = buildCase({
      id: 'halflift',
      toolGroups: [
        { ...groupWith({ id: 'g.c', server: 'fs' }), replaces: 'knowledge' },
      ],
    });
    const codes = issuesOf(() => buildExtensionRegistry([partial])).map(
      (i) => i.code,
    );
    expect(codes).toContain('reserved-server');
    expect(codes).not.toContain('invalid-replaces');
  });

  it('flags risk declarations that drift from the single risk table (ADR 0003)', () => {
    const lying: BuiltinExtension = {
      ...exampleExtension,
      toolGroups: exampleExtension.toolGroups.map((g) => ({
        ...g,
        tools: g.tools.map((t) => ({ ...t, risk: 'read' as const })),
      })),
    }; // structuredClone cannot carry functions; shallow-copy instead
    const drift = issuesOf(() => buildExtensionRegistry([lying]));
    expect(drift.map((i) => i.code)).toContain('risk-drift');
    expect(drift[0].message).toContain('example');

    // The honest `unknown` declaration for an unregistered name passes (table
    // and declaration agree); a real `read` claim must first land in the table.
    expect(() => buildExtensionRegistry([exampleExtension])).not.toThrow();
  });
});

describe('buildExtensionRegistry - derived views', () => {
  beforeEach(() => {
    exampleFlag.available = true;
    exampleFactory.calls = 0;
    knowledgeStyleFlag.mounted = true;
  });

  it('does not touch adapter factories while discovering (A04, non-vacuous)', async () => {
    const registry = buildExtensionRegistry(
      [exampleExtension, secondExtension],
      {
        isEnabled: (id) => (id === 'example' ? true : undefined),
      },
    );
    const ids = (await registry.availableGroups({ conversationId: 'c1' })).map(
      (g) => g.id,
    );
    expect(ids).toContain('builtin.example'); // the group really reached the view
    expect(exampleFactory.calls).toBe(0); // while visible, its factory was never called
    expect(registry.knownTools('KNOWLEDGE_STYLE')).toEqual(new Set()); // normalized miss
  });

  it('hides default-disabled extensions and honors the injected enablement hook', async () => {
    const registry = buildExtensionRegistry([
      exampleExtension,
      secondExtension,
    ]);
    const ctx = { conversationId: 'c1' };
    let ids = (await registry.availableGroups(ctx)).map((g) => g.id);
    expect(ids).toContain('builtin.second');
    expect(ids).not.toContain('builtin.example'); // defaultEnabled: false

    const enabled = buildExtensionRegistry(
      [exampleExtension, secondExtension],
      {
        isEnabled: (id) => (id === 'example' ? true : undefined),
      },
    );
    ids = (await enabled.availableGroups(ctx)).map((g) => g.id);
    expect(ids).toContain('builtin.example');
  });

  it('recomputes per-conversation availability every call (knowledge semantics)', async () => {
    const registry = buildExtensionRegistry([knowledgeStyleExtension]);
    expect(
      (await registry.availableGroups({ conversationId: 'c1' })).map(
        (g) => g.id,
      ),
    ).toContain('builtin.knowledge_style');
    knowledgeStyleFlag.mounted = false;
    expect(
      (await registry.availableGroups({ conversationId: 'c1' })).map(
        (g) => g.id,
      ),
    ).not.toContain('builtin.knowledge_style');
    knowledgeStyleFlag.mounted = true;
    expect((await registry.availableGroups({})).map((g) => g.id)).not.toContain(
      'builtin.knowledge_style',
    ); // no conversation
  });

  it('a throwing availability predicate hides only its own group (§5.4 isolation)', async () => {
    const registry = buildExtensionRegistry([
      secondExtension,
      throwingExtension,
    ]);
    const ids = (await registry.availableGroups({ conversationId: 'c1' })).map(
      (g) => g.id,
    );
    expect(ids).toContain('builtin.second'); // healthy group survives
    expect(ids).not.toContain('builtin.throws');
  });

  it('availableGroup / serverClaim: the single-group views match the four states', async () => {
    const enabled = buildExtensionRegistry([exampleExtension], {
      isEnabled: () => true,
    });
    const disabled = buildExtensionRegistry([exampleExtension], {
      isEnabled: () => false,
    });
    // Available = enabled (+ predicate): the group appears only when enabled.
    expect(
      await enabled.availableGroup('builtin.example', { conversationId: 'c1' }),
    ).toBeDefined();
    expect(
      await disabled.availableGroup('builtin.example', {
        conversationId: 'c1',
      }),
    ).toBeUndefined();
    // A throwing predicate hides its own group from the single view too.
    const withThrow = buildExtensionRegistry([throwingExtension]);
    expect(
      await withThrow.availableGroup('builtin.throws', {
        conversationId: 'c1',
      }),
    ).toBeUndefined();
    // Registered-state claim survives disablement: the name is owned while the
    // extension is registered at all (external MCP may not take it disabled or
    // not), shared by ServerManager config checks and the McpAdapter guard.
    expect(disabled.serverClaim('example')).toEqual({
      groupId: 'builtin.example',
    });
    expect(disabled.serverClaim('anything_else')).toBeUndefined();
  });

  it('adds a second contribution through the same contract with no core change (A02 seed)', async () => {
    const registry = buildExtensionRegistry(
      [exampleExtension, secondExtension],
      {
        isEnabled: () => true,
      },
    );
    expect(registry.group('builtin.second')).toBeDefined();
    expect(registry.extensions.has('second')).toBe(true);
    const ids = (await registry.availableGroups({ conversationId: 'c1' })).map(
      (g) => g.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining(['builtin.example', 'builtin.second']),
    );
  });
});

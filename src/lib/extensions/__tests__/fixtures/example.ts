/**
 * Test fixtures standing in for future concrete extensions (§7.1). They are
 * deliberately fixtures, not shipped capabilities: `builtin.ts` never imports
 * them (Q4: fixture-level existence, invisible to users).
 */
import type { ToolAdapter } from '@/lib/mcp/pipeline/ToolAdapter';
import type { BuiltinExtension } from '../../contracts';

/** Mutable knobs so tests can flip availability and count factory calls. */
export const exampleFlag = { available: true };
export const exampleFactory = { calls: 0 };
export const throwingFlag = { boom: true };

const stubAdapter = (server: string): ToolAdapter => ({
  server,
  canHandle: (invocation) => invocation.server === server,
  execute: async () => ({ ok: true }),
});

export const exampleExtension: BuiltinExtension = {
  id: 'example',
  defaultEnabled: false,
  toolGroups: [
    {
      id: 'builtin.example',
      name: 'Example capability',
      description: 'Read information supplied by the example capability',
      server: 'example',
      tools: [
        {
          definition: {
            name: 'describe',
            description:
              'Describe a provided item without external side effects',
            input_schema: {
              schema: {
                type: 'object',
                properties: { item: { type: 'string' } },
                required: ['item'],
              },
            },
          },
          // The risk table answers `unknown` for this unregistered name; the
          // honest declaration is `unknown`. Declaring `read` instead is what
          // the risk-drift test exercises.
          risk: 'unknown',
        },
      ],
      availability: () => exampleFlag.available,
      loadAdapter: async () => {
        exampleFactory.calls += 1;
        return stubAdapter('example');
      },
    },
  ],
};

/** Second independent contribution: A02 evidence that a new capability is data + fixture only. */
export const secondExtension: BuiltinExtension = {
  id: 'second',
  defaultEnabled: true,
  toolGroups: [
    {
      id: 'builtin.second',
      name: 'Second capability',
      description: 'A second read-only contribution through the same contract',
      server: 'second',
      tools: [
        {
          definition: { name: 'ping', description: 'Echo availability' },
          risk: 'unknown',
        },
      ],
      loadAdapter: async () => stubAdapter('second'),
    },
  ],
};

/**
 * Knowledge-shaped availability demo: "enabled iff the conversation carries
 * the data" (promptBuilder recomputes the knowledge mount per step). Until the
 * PR B `replaces` channel lands, contributions cannot use the live `knowledge`
 * group/server names themselves (core namespace is reserved), so this demo
 * runs under its own names; the real trio arrives with the pilot migration.
 */
export const knowledgeStyleFlag = { mounted: true };
export const knowledgeStyleExtension: BuiltinExtension = {
  id: 'knowledge_style',
  defaultEnabled: true,
  toolGroups: [
    {
      id: 'builtin.knowledge_style',
      name: 'Knowledge-style capability',
      description: 'Available exactly when the conversation carries the data',
      server: 'knowledge_style',
      tools: [
        {
          definition: { name: 'search', description: 'Search' },
          risk: 'unknown',
        },
        { definition: { name: 'list', description: 'List' }, risk: 'unknown' },
        { definition: { name: 'read', description: 'Read' }, risk: 'unknown' },
      ],
      availability: (ctx) =>
        knowledgeStyleFlag.mounted && ctx.conversationId !== undefined,
      loadAdapter: async () => stubAdapter('knowledge_style'),
    },
  ],
};

/** §5.4 failure isolation: a predicate that throws hides only its own group. */
export const throwingExtension: BuiltinExtension = {
  id: 'thrower',
  defaultEnabled: true,
  toolGroups: [
    {
      id: 'builtin.throws',
      name: 'Flaky capability',
      description: 'Its availability predicate throws',
      server: 'thrower',
      tools: [
        { definition: { name: 'ping', description: 'p' }, risk: 'unknown' },
      ],
      availability: () => {
        if (throwingFlag.boom) throw new Error('store not ready');
        return true;
      },
      loadAdapter: async () => stubAdapter('thrower'),
    },
  ],
};

export function buildCase(
  overrides: Partial<BuiltinExtension> & { id: string },
): BuiltinExtension {
  return { defaultEnabled: true, toolGroups: [], ...overrides };
}

export const stubTool = { definition: { name: 'x' }, risk: 'unknown' as const };
export const stubGroupAdapter = () => async () => stubAdapter('group');

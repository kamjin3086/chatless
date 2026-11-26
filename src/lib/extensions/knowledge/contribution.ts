/**
 * Knowledge capability as a contribution (PR B pilot, plan §10 phase 2).
 *
 * This takes over the hand-written `knowledge` group: same server name, same
 * tool definitions, same "mounted in this conversation" semantics. Everything
 * the old group did implicitly is declared here explicitly: `replaces` names
 * the migrated namespace, `stickyWhenLoaded: false` records why a revoked
 * mount must not keep its tools visible, and the data-presence check arrives
 * as an injected dependency instead of an inline store/SQL query (the store
 * reads lived in promptBuilder; §4.2 keeps this file free of them).
 */
import {
  KNOWLEDGE_SERVER_NAME,
  KNOWLEDGE_TOOLS,
} from '@/lib/mcp/nativeTools/knowledge';
import type { BuiltinExtension } from '../contracts';

export interface KnowledgeDeps {
  /** True iff the conversation has a knowledge base mounted or documents mapped. */
  hasConversationKnowledge(conversationId?: string): Promise<boolean>;
}

export interface ExtensionAssemblyDeps {
  knowledge: KnowledgeDeps;
}

export function createKnowledgeExtension(
  deps: KnowledgeDeps,
): BuiltinExtension {
  return {
    id: 'knowledge',
    defaultEnabled: true,
    toolGroups: [
      {
        id: 'knowledge',
        replaces: 'knowledge',
        // The migration keeps the legacy description verbatim: the catalog text
        // the model already matches against must not shift with the mechanism.
        name: 'Knowledge base',
        description:
          'knowledge_search / knowledge_read (when the session has a knowledge base mounted)',
        server: KNOWLEDGE_SERVER_NAME,
        stickyWhenLoaded: false,
        tools: KNOWLEDGE_TOOLS.map((definition) => ({
          definition,
          // Declared read because the one risk table already answers read for
          // knowledge list/search/read; the registry rejects any drift (§5.4).
          risk: 'read' as const,
        })),
        availability: (ctx) =>
          deps.hasConversationKnowledge(ctx.conversationId),
        loadAdapter: async () => {
          // The pipeline routes contributed servers through this factory
          // (ContributionAdapter, phase 3 wiring): first execution loads it,
          // the bridge caches the instance, discovery never calls it.
          const mod = await import(
            '@/lib/mcp/pipeline/adapters/KnowledgeAdapter'
          );
          return new mod.KnowledgeAdapter();
        },
      },
    ],
  };
}

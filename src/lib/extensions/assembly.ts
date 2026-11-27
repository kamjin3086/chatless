/**
 * Assembly entry: the sanctioned seam where concrete extensions are wired with
 * their real dependencies and the registry is built once (§4.3: core modules
 * import only this, never the manifest internals).
 *
 * The knowledge data-presence predicate previously lived inline inside
 * promptBuilder's hand-written knowledge mount query (attachment store +
 * document mapping count); it is moved here verbatim, catch included, so PR B
 * changes the mechanism without touching the behavior (plan §10 phase 2
 * compatibility requirement).
 */
import { buildExtensionRegistry } from './registry';
import { assembleBuiltinExtensions } from './builtin';
import { normalizeServerName } from '@/lib/mcp/toolNaming';
import { useWebSearchStore } from '@/store/webSearchStore';
import type { ExtensionRegistry } from './registry';

let registry: ExtensionRegistry | null = null;

/**
 * Lazily built on first use: the manifest is static and fully validated by the
 * contract tests, so a broken contribution surfaces in CI, not at runtime.
 * If a future bootstrap wants startup-time validation, calling this from app
 * init is the one-line change (review note PR B: lazy init accepted).
 */
export function getExtensionRegistry(): ExtensionRegistry {
  if (!registry) {
    registry = buildExtensionRegistry(
      assembleBuiltinExtensions({
        knowledge: { hasConversationKnowledge },
        web: { isWebSearchEnabled },
      }),
    );
  }
  return registry;
}

/** For tests: drop the lazily built singleton. */
export function resetExtensionRegistry(): void {
  registry = null;
}

async function hasConversationKnowledge(
  conversationId?: string,
): Promise<boolean> {
  if (!conversationId) return false;
  try {
    const { useConversationAttachmentStore } = await import(
      '@/store/conversationAttachmentStore'
    );
    const kb = useConversationAttachmentStore
      .getState()
      .getKnowledgeBase(conversationId);
    const { DatabaseService } = await import(
      '@/lib/database/services/DatabaseService'
    );
    const rows = await DatabaseService.getInstance()
      .getDbManager()
      .select<{ n: number }>(
        'SELECT COUNT(*) AS n FROM conversation_document_mappings WHERE conversation_id = ?',
        [conversationId],
      );
    return !!(kb?.id || Number(rows[0]?.n || 0) > 0);
  } catch {
    return false;
  }
}

/**
 * The persisted user toggle, read synchronously from the settings store.
 * Same read intentDetector feeds into `shouldExposeWebSearch` - one setting,
 * one reader path; the store import lives here because capability files may
 * not touch stores themselves (§4.2).
 */
function isWebSearchEnabled(): boolean {
  return !!useWebSearchStore.getState().isWebSearchEnabled;
}

/**
 * Server-name spellings owned by registered contributions (raw + canonical,
 * e.g. `web` and `web_search`). Config-time checks (load normalization, the
 * settings UI) treat them like reserved names: the bridge routes these
 * servers first, so an external server under a claimed name could never
 * execute - renaming at config time beats a silently uncallable server.
 */
export function claimedExternalServerNames(): string[] {
  const names: string[] = [];
  for (const g of getExtensionRegistry().groups()) {
    const raw = String(g.server).trim().toLowerCase();
    if (!raw) continue;
    names.push(raw);
    const canon = normalizeServerName(g.server);
    if (canon !== raw) names.push(canon);
  }
  return names;
}

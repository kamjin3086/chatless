/**
 * Prompt management as a contribution (second pilot, plan §10 phase 2 flow).
 *
 * Takes over the hand-written `prompt` group on the `system` server: same
 * group id, same server, same tool definitions (registration is security
 * work - the definitions stay in core `systemPrompts.ts`, the risk table's
 * `system` row and the approval branch in `policy.ts` stay where they are;
 * this contribution declares them and the registry cross-checks intent).
 *
 * Unlike knowledge this group has NO availability predicate: the prompt store
 * always exists, so availability is just enablement, and `stickyWhenLoaded`
 * keeps the default (a discovery hit keeps working in later steps - the
 * revoked-mount problem is knowledge's data-presence story, not this one).
 * The pilot's purpose is to validate the read/write/approval path through the
 * contract: writes stay approval-gated in core, plan mode still answers the
 * reads through the one risk table.
 */
import {
  SYSTEM_SERVER_NAME,
  SYSTEM_PROMPT_TOOLS,
} from '@/lib/mcp/nativeTools/systemPrompts';
import type { BuiltinExtension } from '../contracts';

const READ_PROMPT_TOOLS = new Set(['list_prompts', 'get_prompt']);

export function createPromptManagementExtension(): BuiltinExtension {
  return {
    id: 'prompt',
    defaultEnabled: true,
    toolGroups: [
      {
        id: 'prompt',
        replaces: 'prompt',
        // Verbatim legacy text: the catalog copy the model already matches
        // against must not shift with the mechanism.
        name: 'Prompt management',
        description: 'Manage prompts (list, create, edit, delete, optimise)',
        server: SYSTEM_SERVER_NAME,
        tools: SYSTEM_PROMPT_TOOLS.map((definition) => ({
          definition,
          // Declared from the one risk table: the registry rejects any drift
          // (§5.4). Everything not registered as read is `unknown` there, and
          // `unknown` keeps asking approval in policy.ts exactly as before.
          risk: READ_PROMPT_TOOLS.has(definition.name)
            ? ('read' as const)
            : ('unknown' as const),
        })),
        loadAdapter: async () => {
          // The executor stays a core pipeline adapter (like KnowledgeAdapter):
          // first execution loads it through the bridge, discovery never does.
          const mod = await import(
            '@/lib/mcp/pipeline/adapters/SystemToolAdapter'
          );
          return new mod.SystemToolAdapter();
        },
      },
    ],
  };
}

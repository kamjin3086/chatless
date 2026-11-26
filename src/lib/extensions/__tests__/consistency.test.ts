/**
 * PR C registration-consistency patrol: one test that walks the REAL assembled
 * registry and cross-checks the registration seams a contributed tool must
 * have in the hand-written safety layers (ADR 0003: registration is security
 * work). Honest §11.1 scope: this covers the REGISTRATION half of A08 (the
 * knowledge reads' replay/plan-table membership) and part of A14 (the approval
 * card's i18n keys). A05 execution blocking, A13 lifecycle and A15 config
 * compatibility need pipeline/runtime tests - NOT RUN here, listed on the PR.
 * What the patrol pins:
 *
 *   definition (contribution)  ↔  risk table (policy/toolRisk)
 *                           ↔  approval bucket (conversationAccessStore)
 *                           ↔  approval UI i18n keys (zh-CN + en-US)
 *
 * These are the places that used to move by hand-in-sync with each new tool;
 * this is the only place they are asserted jointly.
 */
import { describe, expect, it } from 'vitest';
import { buildExtensionRegistry } from '../registry';
import { assembleBuiltinExtensions } from '../builtin';
import {
  toolRisk,
  isReplayableRead,
  isPlanOnlyAllowed,
} from '@/lib/mcp/pipeline/policy/toolRisk';
import { conversationToolKey } from '@/store/conversationAccessStore';
import zhCN from '@/i18n/locales/zh-CN';
import enUS from '@/i18n/locales/en-US';

const registry = buildExtensionRegistry(
  assembleBuiltinExtensions({
    knowledge: { hasConversationKnowledge: async () => true },
  }),
);

describe('registration consistency patrol (PR C)', () => {
  const contributed = registry.groups().flatMap((g) =>
    g.tools.map((t) => ({
      server: g.server,
      tool: String(t.definition.name),
      declared: t.risk,
    })),
  );

  it('the assembled manifest builds without validation issues', () => {
    // The same build the registry does at runtime; any issue (name collision,
    // risk drift) throws - a shipped descriptor drifting from the pipeline
    // tables fails here with the issue list in the message.
    expect(() =>
      buildExtensionRegistry(
        assembleBuiltinExtensions({
          knowledge: { hasConversationKnowledge: async () => true },
        }),
      ),
    ).not.toThrow();
    expect(contributed.length).toBeGreaterThan(0);
  });

  it('every contributed tool agrees with the single risk table', () => {
    for (const c of contributed) {
      // The registry build already rejects declared-vs-table drift (it throws
      // before this loop could run), so this line is a documentation-level
      // double-check, not an independent derivation. The independently
      // re-derived seam is the replay/plan membership below.
      expect(c.declared, `${c.server}__${c.tool}`).toBe(
        toolRisk(c.server, c.tool),
      );
      // Everything contributed so far is read-only; when the first write
      // contribution lands it must not trip this patrol - only reads are
      // expected to be replayable / plan-allowed.
      if (c.declared !== 'read') continue;
      expect(isReplayableRead(c.server, c.tool), `${c.server}__${c.tool}`).toBe(
        true,
      );
      expect(
        isPlanOnlyAllowed(c.server, c.tool),
        `${c.server}__${c.tool}`,
      ).toBe(true);
    }
  });

  it('every knowledge tool lands in the approval bucket the UI special-cases', () => {
    // ToolCallCard keys its knowledge approval wording on toolKey ===
    // 'knowledge:read' (components/chat/ToolCallCard.tsx). A contributed
    // knowledge tool outside that bucket would silently get the generic
    // per-tool approval card - A05 semantics break at the UI, not the pipeline.
    const knowledgeTools = contributed.filter((c) => c.server === 'knowledge');
    expect(knowledgeTools.length).toBeGreaterThan(0);
    for (const c of knowledgeTools) {
      expect(conversationToolKey('knowledge', c.tool), c.tool).toBe(
        'knowledge:read',
      );
    }
  });

  it('approval-card i18n keys the knowledge branch uses exist in both locales', () => {
    // Keys consumed by the knowledge branch of the approval card - see the
    // `toolKey === 'knowledge:read'` branch in components/chat/ToolCallCard.tsx.
    // When that branch grows a key, add it here too (the list mirrors the card).
    const keys = [
      'toolCallApproval.conversationKnowledgeRead',
      'toolCallApproval.knowledgeReadTarget',
      'toolCallApproval.conversationTool',
      'toolCallApproval.conversationToolHint',
    ];
    for (const key of keys) {
      expect(typeof (zhCN as any)[key], `zh-CN ${key}`).toBe('string');
      expect(typeof (enUS as any)[key], `en-US ${key}`).toBe('string');
    }
  });
});

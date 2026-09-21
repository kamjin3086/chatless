import { describe, expect, it, beforeEach } from 'vitest';
import {
  changedBlockIds,
  composeSystemPrompt,
  orderBlocks,
  type PromptBlock,
} from '../composition';
import { buildAgentContractBlock, resolvePromptLocale } from '../agentContract';
import { observePromptComposition, resetPromptCompositionLog } from '../compositionLog';

const block = (id: string, layer: PromptBlock['layer'], order: number, content = id): PromptBlock =>
  ({ id, layer, order, content });

describe('prompt composition', () => {
  it('orders stable, then conversation, then per-turn blocks', () => {
    const ordered = orderBlocks([
      block('time', 'turn', 10),
      block('workspace', 'conversation', 20),
      block('contract', 'stable', 10),
      block('capabilities', 'conversation', 10),
    ]);

    expect(ordered.map((b) => b.id)).toEqual(['contract', 'capabilities', 'workspace', 'time']);
  });

  it('renders exactly one system message with a stable separator', () => {
    const composed = composeSystemPrompt([block('a', 'stable', 10, 'A'), block('b', 'turn', 10, 'B')]);

    expect(composed.systemMessage.role).toBe('system');
    expect(composed.systemMessage.content).toBe('A\n\nB');
    expect(composed.blocks).toHaveLength(2);
  });

  it('keeps the stable fingerprint when only the turn block changes', () => {
    const stable = block('contract', 'stable', 10, 'contract');
    const first = composeSystemPrompt([stable, block('time', 'turn', 10, '12:00')]);
    const second = composeSystemPrompt([stable, block('time', 'turn', 10, '12:01')]);

    expect(second.stableFingerprint).toBe(first.stableFingerprint);
    expect(second.fullFingerprint).not.toBe(first.fullFingerprint);
  });

  it('changes the stable fingerprint when a conversation block changes', () => {
    const before = composeSystemPrompt([block('contract', 'stable', 10), block('workspace', 'conversation', 20, 'D:/a')]);
    const after = composeSystemPrompt([block('contract', 'stable', 10), block('workspace', 'conversation', 20, 'D:/b')]);

    expect(after.stableFingerprint).not.toBe(before.stableFingerprint);
    expect(changedBlockIds(before.blocks, after.blocks)).toEqual(['workspace']);
  });

  it('keeps the stable layer untouched when a conversation block is added', () => {
    const contract = buildAgentContractBlock('zh');
    const withoutKnowledge = composeSystemPrompt([contract, block('runtime-environment', 'conversation', 10, 'win32')]);
    const withKnowledge = composeSystemPrompt([
      contract,
      block('runtime-environment', 'conversation', 10, 'win32'),
      block('knowledge-rules', 'conversation', 30, '文档检索规则'),
    ]);

    const stableOf = (blocks: PromptBlock[]) =>
      blocks.filter((b) => b.layer === 'stable').map((b) => b.content).join('\n\n');
    expect(stableOf(withKnowledge.blocks)).toBe(stableOf(withoutKnowledge.blocks));
    expect(withKnowledge.stableFingerprint).not.toBe(withoutKnowledge.stableFingerprint);
  });

  it('drops empty blocks and tolerates missing input', () => {
    const composed = composeSystemPrompt([block('empty', 'stable', 10, '   '), block('kept', 'stable', 20, 'text')]);

    expect(composed.blocks.map((b) => b.id)).toEqual(['kept']);
    expect(composeSystemPrompt([]).systemMessage.content).toBe('');
  });
});

describe('agent contract', () => {
  it('ships a Chinese and an English contract and defaults to Chinese', () => {
    const zh = buildAgentContractBlock(resolvePromptLocale('zh'));
    const en = buildAgentContractBlock(resolvePromptLocale('en-US'));

    expect(zh.content).toContain('用用户提问时使用的语言回答');
    expect(en.content).toContain('the language the user wrote in');
    expect(resolvePromptLocale(undefined)).toBe('zh');
    expect(zh.id).toBe(en.id);
  });

  it('is stable for the conversation, so the prefix stays cacheable', () => {
    const first = composeSystemPrompt([buildAgentContractBlock('zh')]);
    const second = composeSystemPrompt([buildAgentContractBlock('zh')]);

    expect(second.stableFingerprint).toBe(first.stableFingerprint);
  });
});

describe('composition diagnostics', () => {
  beforeEach(() => resetPromptCompositionLog());

  it('reports the first composition and stays quiet when nothing changed', () => {
    const blocks = [block('contract', 'stable', 10, 'contract'), block('time', 'turn', 10, '12:00')];
    const composed = composeSystemPrompt(blocks);

    expect(observePromptComposition('conv-1', composed)?.changedBlockIds).toContain('contract');
    expect(observePromptComposition('conv-1', composed)).toBeNull();
  });

  it('names the block that changed', () => {
    observePromptComposition('conv-1', composeSystemPrompt([block('contract', 'stable', 10, 'contract')]));
    const change = observePromptComposition(
      'conv-1',
      composeSystemPrompt([block('contract', 'stable', 10, 'contract v2')]),
    );

    expect(change?.changedBlockIds).toEqual(['contract']);
  });
});

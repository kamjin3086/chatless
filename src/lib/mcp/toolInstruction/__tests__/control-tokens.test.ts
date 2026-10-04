/**
 * Chat-template control tokens must never reach the user.
 *
 * The streaming guard handles the live path; this covers text that was stored
 * before the guard existed (or that arrives without a thinking strategy).
 */

import { filterToolInstructions } from '../filter';
import {
  ALL_TEMPLATE_TOKENS,
  containsTemplateTokens,
  stripTemplateTokens,
} from '@/lib/llm/chatTemplateTokens';

describe('stripTemplateTokens', () => {
  it('removes ChatML tokens', () => {
    expect(stripTemplateTokens('答案<|im_end|>')).toBe('答案');
  });

  it('removes a leaked turn opening including its role word', () => {
    expect(stripTemplateTokens('<|im_start|>user\n你没说过的话')).toBe('你没说过的话');
  });

  it('removes Llama 3 header markers', () => {
    expect(stripTemplateTokens('<|start_header_id|>assistant<|end_header_id|>\n\n你好')).toBe('你好');
  });

  it('leaves GPT-OSS harmony tags alone', () => {
    const harmony = '<|start|>assistant<|channel|>final<|message|>hi<|end|>';
    expect(stripTemplateTokens(harmony)).toBe(harmony);
  });

  it('leaves ordinary text alone', () => {
    expect(stripTemplateTokens('c++ 里的 a <| b 比较')).toBe('c++ 里的 a <| b 比较');
  });
});

describe('containsTemplateTokens', () => {
  it('detects every known token', () => {
    for (const token of ALL_TEMPLATE_TOKENS) {
      expect(containsTemplateTokens(`x${token}y`)).toBe(true);
    }
  });

  it('is false for clean text', () => {
    expect(containsTemplateTokens('普通回答')).toBe(false);
  });
});

describe('filterToolInstructions', () => {
  it('strips template tokens in display mode', () => {
    expect(
      filterToolInstructions('<|im_start|>assistant\n你好<|im_end|>', { mode: 'display' }),
    ).toBe('你好');
  });

  it('strips template tokens in persist mode', () => {
    // Only the template noise is removed.  Text that follows a boundary token is
    // kept: in stored data there is no way to tell an invented turn from a user
    // who pasted a template on purpose, so truncation stays in the stream guard.
    expect(
      filterToolInstructions('你好<|im_end|><|im_start|>user\n伪造', { mode: 'persist' }),
    ).toBe('你好伪造');
  });

  it('returns an empty string when the text was only template noise', () => {
    expect(filterToolInstructions('<|im_end|>', { mode: 'display' })).toBe('');
  });
});

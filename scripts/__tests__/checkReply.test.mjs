import { describe, expect, it } from 'vitest';
import { checkReply, DISCLOSURE } from '../check-reply.mjs';

const good = `${DISCLOSURE.zh}

日志挺全的，省了我们一轮排查。原因找到了：请求路径读的是另一张字段表，所以 topK 一直没发出去。

修好后我回来这条 issue 里更新。

想先确认一下你用的是哪个服务，能帮我们判断影响范围。`;

describe('the mechanical half of the reply rules', () => {
  it('passes a reply that follows every rule', () => {
    expect(checkReply(good)).toEqual([]);
  });

  it('requires the disclosure as the first line', () => {
    const findings = checkReply(`确认是产品问题。\n\n修好后回来更新。`);
    expect(findings.join('\n')).toMatch(/disclosure blockquote/);
  });

  it('accepts the English disclosure on an English thread', () => {
    expect(checkReply(`${DISCLOSURE.en}\n\nFixed in \`abc1234\`.`)).toEqual([]);
  });

  it('allows three paragraphs and no more', () => {
    const four = `${DISCLOSURE.zh}\n\n一。\n\n二。\n\n三。\n\n四。`;
    expect(checkReply(four).join('\n')).toMatch(/4 paragraphs/);
  });

  it('catches apology and gratitude padding', () => {
    for (const line of ['抱歉给你添了麻烦。', '感谢反馈。', '谢谢反馈，非常有用。']) {
      expect(checkReply(`${DISCLOSURE.zh}\n\n${line}`).join('\n')).toMatch(/padding/);
    }
  });

  it('catches the enthusiasm the voice rule forbids', () => {
    expect(checkReply(`${DISCLOSURE.zh}\n\n已经修好了！`).join('\n')).toMatch(/exclamation/);
  });

  it('keeps internals out of the thread', () => {
    const withPath = `${DISCLOSURE.zh}\n\n改的是 \`src/lib/llm/types/tool-capability.ts\`。`;
    expect(checkReply(withPath).join('\n')).toMatch(/source path/);
    const withCall = `${DISCLOSURE.zh}\n\n现在 \`resolveToolTrack()\` 会先看你的设置。`;
    expect(checkReply(withCall).join('\n')).toMatch(/internal function/);
    const withFence = `${DISCLOSURE.zh}\n\n\`\`\`ts\nconst a = 1\n\`\`\``;
    expect(checkReply(withFence).join('\n')).toMatch(/fenced code block/);
  });

  it('refuses to hand the decision to the reporter', () => {
    for (const line of ['你想用哪种方案？', '这几种做法你觉得哪个好', '要 1 还是 3，你定。']) {
      expect(checkReply(`${DISCLOSURE.zh}\n\n${line}`).join('\n')).toMatch(/choose/);
    }
  });
});

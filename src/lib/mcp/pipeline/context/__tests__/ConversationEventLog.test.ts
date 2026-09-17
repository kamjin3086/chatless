import { describe, expect, it } from 'vitest';
import { ConversationEventLog } from '../ConversationEventLog';

describe('ConversationEventLog recovery boundaries', () => {
  it('does not project an acknowledged-but-undelivered supplement early', () => {
    const log = new ConversationEventLog();
    log.append({ type: 'tool_call_requested', callId: 'call-a', server: 'files', tool: 'write', args: { path: 'a' } });
    log.append({ type: 'tool_call_output', callId: 'call-a', server: 'files', tool: 'write', output: { ok: true } });
    log.append({ type: 'queued_user_input', inputId: 'steer-1', content: 'change the target' });

    const messages = log.renderForModel('tool_role');
    expect(messages.some((message) => message.content === 'change the target')).toBe(false);
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'tool']);
  });

  it('makes an incomplete persisted call explicit instead of dropping it', () => {
    const log = new ConversationEventLog();
    log.append({ type: 'tool_call_requested', callId: 'call-a', server: 'files', tool: 'write', args: { path: 'a' } });
    log.append({ type: 'tool_call_started', callId: 'call-a', server: 'files', tool: 'write', args: { path: 'a' } });

    const messages = log.renderForModel('tool_role');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-a',
      content: expect.stringContaining('EXECUTION_UNKNOWN'),
    });
  });
});

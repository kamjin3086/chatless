import { describe, expect, it } from 'vitest';
import { ConversationEventLog } from '../ConversationEventLog';

describe('ConversationEventLog recovery boundaries', () => {
  it('keeps run notes out of the system role in both render modes', () => {
    const log = new ConversationEventLog();
    log.append({ type: 'context_change', kind: 'other', content: 'agent_run_cancelled' });
    log.append({ type: 'user_message', content: 'hi' });

    for (const mode of ['tool_role', 'text_wrapper'] as const) {
      const messages = log.renderForModel(mode);
      expect(messages.some((message) => message.role === 'system')).toBe(false);
      const note = messages.find((message) => message.content.startsWith('【Run note】'));
      expect(note?.role).toBe('user');
      expect(note?.content).toContain('agent_run_cancelled');
    }
  });

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

  it('preserves a later unknown call after an earlier result was saved', () => {
    const log = new ConversationEventLog();
    for (const callId of ['a', 'b']) {
      log.append({ type: 'tool_call_requested', callId, server: 'files', tool: 'write', args: { path: callId } });
    }
    log.append({ type: 'tool_call_output', callId: 'a', server: 'files', tool: 'write', output: { ok: true } });
    log.append({ type: 'tool_call_started', callId: 'b', server: 'files', tool: 'write' });

    const messages = log.renderForModel('tool_role');
    expect(messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id)).toEqual(['a', 'b']);
    expect(messages.at(-1)?.content).toContain('EXECUTION_UNKNOWN');
  });

  it('projects durable images and attachment references as one user input', () => {
    const log = new ConversationEventLog();
    log.append({ type: 'user_message', content: 'compare these', images: ['data:image/png;base64,abc'],
      attachmentDocumentIds: ['doc-1'] });
    const messages = log.renderForModel('tool_role');
    expect(messages).toEqual([expect.objectContaining({
      role: 'user', images: ['data:image/png;base64,abc'], content: expect.stringContaining('doc-1'),
    })]);
  });
});

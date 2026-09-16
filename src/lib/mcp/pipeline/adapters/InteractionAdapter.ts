import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { INTERACTION_SERVER_NAME } from '@/lib/mcp/nativeTools/interaction';

export class InteractionAdapter implements ToolAdapter {
  readonly server = INTERACTION_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === this.server;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').toLowerCase();
    const args = invocation.args || {};
    if (tool === 'ask_user') {
      return {
        ok: true,
        status: 'waiting_input',
        requestId: `${invocation.assistantMessageId}:${invocation.callId || 'ask'}`,
        question: String(args.question || '').trim(),
        options: Array.isArray(args.options) ? args.options.map(String).slice(0, 8) : [],
      };
    }
    if (tool === 'update_plan') {
      return {
        ok: true,
        status: 'plan_updated',
        steps: Array.isArray(args.steps) ? args.steps.map(String) : [],
        current: typeof args.current === 'number' ? args.current : undefined,
        planStatus: args.status || 'in_progress',
      };
    }
    return { ok: false, error: `Unknown interaction tool: ${tool}` };
  }
}


import { isSkillTool, executeSkillTool } from '@/lib/skills/skillTools';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

const SKILL_SERVERS = new Set<string>(['skills', 'skill']);

export class SkillsToolAdapter implements ToolAdapter {
  readonly server = 'skills';

  canHandle(invocation: ToolInvocation): boolean {
    return SKILL_SERVERS.has(invocation.server) || isSkillTool(invocation.tool);
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    return executeSkillTool(invocation.tool, invocation.args || {});
  }
}


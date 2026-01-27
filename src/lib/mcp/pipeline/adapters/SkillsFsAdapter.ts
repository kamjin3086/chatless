import { SKILLS_FS_SERVER_NAME, executeSkillFileTool, isSkillFileTool } from '@/lib/skills/skillFileTools';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

export class SkillsFsAdapter implements ToolAdapter {
  readonly server = SKILLS_FS_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return invocation.server === SKILLS_FS_SERVER_NAME || isSkillFileTool(invocation.tool);
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    return executeSkillFileTool(invocation.tool, invocation.args || {});
  }
}


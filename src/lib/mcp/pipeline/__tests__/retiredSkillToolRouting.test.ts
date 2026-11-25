import { describe, expect, it } from 'vitest';
import { SkillUnifiedAdapter } from '../adapters/SkillUnifiedAdapter';
import { toolRisk } from '../policy/toolRisk';
import type { ToolInvocation } from '../ToolInvocation';

/**
 * PR #230 (commit 3e02d86) deleted the alias names `use`, `get`, `list_files`,
 * `read_file`, `write_file` on the built-in `skill` server, and issue #236 - PR #241 -
 * made the card call them retired rather than guess their old job. That reading is only
 * honest while nothing routes them: a retired
 * name that still ran would make the card wrong in the other direction, and a risk-table
 * entry would be the door some later policy walks in through.
 */
const RETIRED = [
  'use',
  'get',
  'list_files',
  'read_file',
  'write_file',
  'list_available_skills',
  'get_skill_instructions',
  'list_skill_actions',
];
const adapter = new SkillUnifiedAdapter();
const invocation = (tool: string) =>
  ({ server: 'skill', tool, args: {} }) as unknown as ToolInvocation;

describe('skill tool names retired in PR #230 stay retired', () => {
  for (const tool of RETIRED) {
    it(`refuses skill__${tool} rather than quietly routing it`, async () => {
      const result = (await adapter.execute(invocation(tool))) as {
        error?: string;
      };
      expect(result.error).toContain('Unknown skill tool');
    });

    it(`keeps ${tool} out of the risk table, so no policy re-admits it`, () => {
      expect(toolRisk('skill', tool)).toBe('unknown');
    });
  }
});

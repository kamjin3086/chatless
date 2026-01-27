import { FilesystemAdapter } from './FilesystemAdapter';
import { McpAdapter } from './McpAdapter';
import { ShellExecutorAdapter } from './ShellExecutorAdapter';
import { SkillsFsAdapter } from './SkillsFsAdapter';
import { SkillsToolAdapter } from './SkillsToolAdapter';
import { UserFsAdapter } from './UserFsAdapter';
import { WebSearchAdapter } from './WebSearchAdapter';
import type { ToolAdapter } from '../ToolAdapter';

/**
 * 默认 adapters（含 web_search）。
 */
export function createDefaultAdapters(): ToolAdapter[] {
  return [
    new WebSearchAdapter(),
    new SkillsToolAdapter(),
    new SkillsFsAdapter(),
    new UserFsAdapter(),
    new FilesystemAdapter(),
    new ShellExecutorAdapter(),
    new McpAdapter(),
  ];
}

export { FilesystemAdapter } from './FilesystemAdapter';
export { McpAdapter } from './McpAdapter';
export { ShellExecutorAdapter } from './ShellExecutorAdapter';
export { SkillsFsAdapter } from './SkillsFsAdapter';
export { SkillsToolAdapter } from './SkillsToolAdapter';
export { UserFsAdapter } from './UserFsAdapter';
export { WebSearchAdapter } from './WebSearchAdapter';


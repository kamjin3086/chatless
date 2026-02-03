import { AgentContextAdapter } from './AgentContextAdapter';
import { FilesystemAdapter } from './FilesystemAdapter';
import { McpAdapter } from './McpAdapter';
import { ShellExecutorAdapter } from './ShellExecutorAdapter';
import { SkillsFsAdapter } from './SkillsFsAdapter';
import { SkillsToolAdapter } from './SkillsToolAdapter';
import { SystemToolAdapter } from './SystemToolAdapter';
import { ToolsRegistryAdapter } from './ToolsRegistryAdapter';
import { UserFsAdapter } from './UserFsAdapter';
import { WebSearchAdapter } from './WebSearchAdapter';
import type { ToolAdapter } from '../ToolAdapter';

/**
 * 默认 adapters（含 web_search）。
 */
export function createDefaultAdapters(): ToolAdapter[] {
  return [
    new ToolsRegistryAdapter(),
    new AgentContextAdapter(),
    new WebSearchAdapter(),
    new SkillsToolAdapter(),
    new SkillsFsAdapter(),
    new UserFsAdapter(),
    new FilesystemAdapter(),
    new ShellExecutorAdapter(),
    new SystemToolAdapter(),
    new McpAdapter(),
  ];
}

export { AgentContextAdapter } from './AgentContextAdapter';
export { FilesystemAdapter } from './FilesystemAdapter';
export { McpAdapter } from './McpAdapter';
export { ShellExecutorAdapter } from './ShellExecutorAdapter';
export { SkillsFsAdapter } from './SkillsFsAdapter';
export { SkillsToolAdapter } from './SkillsToolAdapter';
export { SystemToolAdapter } from './SystemToolAdapter';
export { ToolsRegistryAdapter } from './ToolsRegistryAdapter';
export { UserFsAdapter } from './UserFsAdapter';
export { WebSearchAdapter } from './WebSearchAdapter';


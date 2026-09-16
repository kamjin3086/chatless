import { AgentContextAdapter } from './AgentContextAdapter';
import { FilesystemAdapter } from './FilesystemAdapter';
import { McpAdapter } from './McpAdapter';
import { ShellExecutorAdapter } from './ShellExecutorAdapter';
import { SkillUnifiedAdapter } from './SkillUnifiedAdapter';
import { SystemToolAdapter } from './SystemToolAdapter';
import { ToolsRegistryAdapter } from './ToolsRegistryAdapter';
import { UserFsAdapter } from './UserFsAdapter';
import { WebSearchAdapter } from './WebSearchAdapter';
import { CodingPackAdapter } from './CodingPackAdapter';
import { KnowledgeAdapter } from './KnowledgeAdapter';
import type { ToolAdapter } from '../ToolAdapter';

/**
 * 默认 adapters
 *
 * 注意：Skill 相关适配器已统一为 SkillUnifiedAdapter
 * - 移除了 SkillsToolAdapter (旧的 list_available_skills 等)
 * - 移除了 SkillsFsAdapter (旧的 skills_fs 操作)
 * - 合并到 SkillUnifiedAdapter (统一的 skill__* 工具)
 */
export function createDefaultAdapters(): ToolAdapter[] {
  return [
    new ToolsRegistryAdapter(),
    new AgentContextAdapter(),
    new WebSearchAdapter(),
    new SkillUnifiedAdapter(),
    new UserFsAdapter(),
    new FilesystemAdapter(),
    new ShellExecutorAdapter(),
    new CodingPackAdapter(),
    new KnowledgeAdapter(),
    new SystemToolAdapter(),
    new McpAdapter(),
  ];
}

export { AgentContextAdapter } from './AgentContextAdapter';
export { FilesystemAdapter } from './FilesystemAdapter';
export { McpAdapter } from './McpAdapter';
export { ShellExecutorAdapter } from './ShellExecutorAdapter';
export { SkillUnifiedAdapter } from './SkillUnifiedAdapter';
export { SystemToolAdapter } from './SystemToolAdapter';
export { ToolsRegistryAdapter } from './ToolsRegistryAdapter';
export { UserFsAdapter } from './UserFsAdapter';
export { WebSearchAdapter } from './WebSearchAdapter';
export { CodingPackAdapter } from './CodingPackAdapter';
export { KnowledgeAdapter } from './KnowledgeAdapter';

// 保留旧导出以兼容可能的外部引用（标记为 deprecated）
/** @deprecated 使用 SkillUnifiedAdapter 代替 */
export { SkillUnifiedAdapter as SkillsToolAdapter } from './SkillUnifiedAdapter';
/** @deprecated 使用 SkillUnifiedAdapter 代替 */
export { SkillUnifiedAdapter as SkillsFsAdapter } from './SkillUnifiedAdapter';


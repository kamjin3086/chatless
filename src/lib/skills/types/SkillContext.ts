/**
 * Skill 执行上下文扩展
 * 
 * 提供结构化的路径和资源信息，避免 LLM 解析字符串
 */

export interface SkillContextMetadata {
  /** Skill 工作目录绝对路径 */
  skillPath: string;
  
  /** 可用资源文件列表 */
  resourceFiles: string[];
  
  /** Actions 数量 */
  actionCount: number;
  
  /** 上次执行记录（用于断点恢复） */
  lastExecution?: {
    timestamp: number;
    executedSteps: Array<{
      tool: string;
      params: Record<string, unknown>;
      status: 'success' | 'failed';
      result?: unknown;
    }>;
    checkpoint?: string;
  };
}

/**
 * 解析路径别名
 * 
 * 支持：
 * - @skill/file.md → ${skillPath}/file.md
 * - @workspace/path → ${workspacePath}/path
 * - 绝对路径保持不变
 * - 相对路径基于 skillPath
 */
export function resolveSkillPath(
  path: string,
  context?: SkillContextMetadata
): string {
  if (!context) return path;
  
  // 处理 @skill/ 别名
  if (path.startsWith('@skill/')) {
    return `${context.skillPath}/${path.substring(7)}`;
  }
  
  // 处理 @skill: 前缀（兼容）
  if (path.startsWith('skill:')) {
    return `${context.skillPath}/${path.substring(6)}`;
  }
  
  // 绝对路径
  if (path.match(/^[A-Za-z]:[\/\\]/) || path.startsWith('/')) {
    return path;
  }
  
  // 相对路径（相对于 skill 目录）
  if (!path.startsWith('.')) {
    return `${context.skillPath}/${path}`;
  }
  
  return path;
}

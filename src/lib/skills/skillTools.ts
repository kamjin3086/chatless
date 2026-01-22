/**
 * 技能工具定义
 * 
 * 供 AI 调用的技能相关工具，实现渐进式披露的关键
 * 
 * ## 设计理念
 * 
 * 渐进式披露（Progressive Disclosure）：
 * 1. Layer 1：技能索引 - 仅包含名称和简短描述，约 100 tokens/skill
 * 2. Layer 2：技能指令 - 完整的 SKILL.md 内容，约 500-2000 tokens
 * 3. Layer 3：执行资源 - 脚本/工具/大型文档，按需加载
 * 
 * 通过这种方式，可以节省约 70-75% 的 Token 消耗
 */

import { getSkillManager } from './SkillManager';
import { parseSkillMd } from './SkillMdParser';
import { executeSkillAction, executeSkillActions } from './SkillOrchestrator';
import type { 
  SkillIndexEntry, 
  SkillActionResult,
  SkillExecutionContext,
  SkillParameterValues,
} from './types';

// #region agent log
const DEBUG_LOG_ENDPOINT = 'http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737';
function debugLog(location: string, message: string, data?: unknown, hypothesisId?: string) {
  fetch(DEBUG_LOG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, message, data, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId }) }).catch(() => {});
}
// #endregion

/**
 * 技能工具参数类型
 */
export interface SkillToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

/**
 * 技能工具定义
 */
export interface SkillToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, SkillToolParameter>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * 列出所有可用技能
 * 
 * 返回已启用技能的简要列表，用于让 AI 了解有哪些技能可用
 */
async function listAvailableSkills(): Promise<SkillIndexEntry[]> {
  const manager = getSkillManager();
  return manager.getSkillIndex();
}

/**
 * 获取技能详细说明
 * 
 * 当 AI 确定需要使用某个技能时，调用此工具获取完整的使用说明
 * 
 * @param skillId - 技能 ID
 */
async function getSkillInstructions(skillId: string): Promise<string> {
  if (!skillId) {
    return 'Error: skillId is required';
  }

  const manager = getSkillManager();
  const content = await manager.getSkillPromptContent(skillId);
  
  if (!content) {
    return `Error: Skill "${skillId}" not found or has no content`;
  }

  // 为模型附加一段“不可见的执行规则提示”（仍然会出现在 tool card 中，但不会污染正常聊天内容）
  const parsed = parseSkillMd(content);
  const actionsCount = parsed.actions.length;
  const actionIdsPreview = parsed.actions.slice(0, 12).map(a => a.id);

  // #region agent log
  debugLog(
    'skillTools.ts:getSkillInstructions:actionsMeta',
    'Skill instructions actions meta',
    { skillId, actionsCount, actionIdsPreview },
    'H15-action-guard'
  );
  // #endregion

  const guidance = [
    '',
    '---',
    '[system] tool-usage-guard:',
    `- actionsCount=${actionsCount}`,
    actionsCount === 0
      ? '- 本技能未定义可执行 actions：不要调用 run_skill_action（会必然失败）；如需继续，请调用 run_all_skill_actions 获取 instruction 输出，或按 SKILL.md 指令自行拆解为可审批动作。'
      : '- 本技能已定义 actions：绝对不要凭空猜 actionId；必须先调用 list_skill_actions，并且只使用其返回的 id 字段。',
    actionIdsPreview.length > 0 ? `- actionIdsPreview=${actionIdsPreview.join(', ')}` : '- actionIdsPreview=(none)',
  ].join('\n');

  return `${content}${guidance}`;
}

/**
 * 检查技能依赖状态
 * 
 * 在执行技能前检查其依赖是否满足
 * 
 * @param skillId - 技能 ID
 */
async function checkSkillDependencies(skillId: string): Promise<{
  ready: boolean;
  missingDeps: string[];
  message: string;
}> {
  if (!skillId) {
    return {
      ready: false,
      missingDeps: [],
      message: 'Error: skillId is required',
    };
  }

  const manager = getSkillManager();
  const skill = await manager.getSkill(skillId);

  if (!skill) {
    return {
      ready: false,
      missingDeps: [],
      message: `Error: Skill "${skillId}" not found`,
    };
  }

  const missingDeps: string[] = [];
  if (skill.dependencies) {
    for (const dep of skill.dependencies) {
      if (!dep.installed) {
        missingDeps.push(`${dep.name}${dep.version ? ` (${dep.version})` : ''}`);
      }
    }
  }

  if (missingDeps.length > 0) {
    return {
      ready: false,
      missingDeps,
      message: `Skill "${skill.name}" is missing dependencies: ${missingDeps.join(', ')}`,
    };
  }

  return {
    ready: true,
    missingDeps: [],
    message: `Skill "${skill.name}" is ready to use`,
  };
}

/**
 * 列出技能可用的动作
 * 
 * 获取技能定义的所有可执行动作列表
 * 
 * @param skillId - 技能 ID
 */
async function listSkillActions(skillId: string): Promise<{
  skillId: string;
  skillName: string;
  actions: Array<{
    id: string;
    name: string;
    type: string;
    description?: string;
    riskLevel?: string;
    requiresApproval?: boolean;
  }>;
  message: string;
}> {
  if (!skillId) {
    return {
      skillId: '',
      skillName: '',
      actions: [],
      message: 'Error: skillId is required',
    };
  }

  const manager = getSkillManager();
  const skill = await manager.getSkill(skillId);

  if (!skill) {
    return {
      skillId,
      skillName: '',
      actions: [],
      message: `Error: Skill "${skillId}" not found`,
    };
  }

  // 解析 SKILL.md 获取动作
  const parseResult = parseSkillMd(skill.skillMdContent || '');
  
  const actions = parseResult.actions.map(action => ({
    id: action.id,
    name: action.name,
    type: action.type,
    description: action.description,
    riskLevel: action.riskLevel,
    requiresApproval: action.requiresApproval,
  }));

  // #region agent log
  debugLog(
    'skillTools.ts:listSkillActions:parsed',
    'Parsed skill actions',
    {
      skillId,
      skillName: skill.name,
      skillPath: skill.path,
      skillMdLen: (skill.skillMdContent || '').length,
      actionsCount: parseResult.actions.length,
      firstActionId: parseResult.actions[0]?.id,
      frontmatterHasActions: Array.isArray((parseResult.frontmatter as any)?.actions),
    },
    'H14-actions'
  );
  // #endregion

  return {
    skillId,
    skillName: skill.name,
    actions,
    message: actions.length > 0 
      ? `Skill "${skill.name}" has ${actions.length} available actions`
      : `Skill "${skill.name}" has no defined actions (uses instruction-based execution)`,
  };
}

/**
 * 执行技能动作
 * 
 * 执行指定技能的特定动作
 * 
 * @param skillId - 技能 ID
 * @param actionId - 动作 ID
 * @param parameters - 动作参数
 * @param conversationId - 会话 ID
 * @param messageId - 消息 ID
 */
async function runSkillAction(
  skillId: string,
  actionId: string,
  parameters: SkillParameterValues = {},
  conversationId: string = '',
  messageId: string = ''
): Promise<{
  success: boolean;
  result?: SkillActionResult;
  message: string;
}> {
  if (!skillId) {
    return {
      success: false,
      message: 'Error: skillId is required',
    };
  }

  if (!actionId) {
    return {
      success: false,
      message: 'Error: actionId is required',
    };
  }

  try {
    // 先验证 actionId 是否存在，避免模型猜测导致“Action not found”反复循环
    const manager = getSkillManager();
    const skill = await manager.getSkill(skillId);
    if (!skill) {
      return { success: false, message: `Error: Skill "${skillId}" not found` };
    }

    const parsed = parseSkillMd(skill.skillMdContent || '');
    const actionIds = parsed.actions.map(a => a.id);
    const hasActions = actionIds.length > 0;
    const hasActionId = actionIds.includes(actionId);

    // #region agent log
    debugLog(
      'skillTools.ts:runSkillAction:validate',
      'Validate skill actionId',
      { skillId, actionId, hasActions, actionsCount: actionIds.length, hasActionId, actionIdsPreview: actionIds.slice(0, 12) },
      'H15-action-guard'
    );
    // #endregion

    if (!hasActions) {
      return {
        success: false,
        message:
          `Skill "${skillId}" has no defined actions. Do NOT call run_skill_action. ` +
          `Next: call skills.run_all_skill_actions (instruction-based), or call skills.get_skill_instructions and follow it.`,
      };
    }

    if (!hasActionId) {
      return {
        success: false,
        message:
          `Action not found: ${actionId}. Do NOT guess actionId. ` +
          `Next: call skills.list_skill_actions to get valid ids. ` +
          `Valid action ids (preview): ${actionIds.slice(0, 12).join(', ') || '(none)'}`,
      };
    }

    const context: SkillExecutionContext = {
      conversationId: conversationId || `conv-${Date.now()}`,
      messageId: messageId || `msg-${Date.now()}`,
      userContent: '',
      feedbacks: [],
      addFeedback: () => {},
    };

    const result = await executeSkillAction(skillId, actionId, context, parameters);
    
    return {
      success: result.success,
      result,
      message: result.success 
        ? `Action "${actionId}" executed successfully`
        : `Action "${actionId}" failed: ${result.error}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error executing action: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 执行技能所有动作
 * 
 * 执行指定技能的所有定义的动作
 * 
 * @param skillId - 技能 ID
 * @param parameters - 动作参数
 * @param conversationId - 会话 ID
 * @param messageId - 消息 ID
 */
async function runAllSkillActions(
  skillId: string,
  parameters: SkillParameterValues = {},
  conversationId: string = '',
  messageId: string = ''
): Promise<{
  success: boolean;
  results: SkillActionResult[];
  message: string;
  mode?: 'actions' | 'instruction';
  executedActions?: boolean;
}> {
  if (!skillId) {
    return {
      success: false,
      results: [],
      message: 'Error: skillId is required',
    };
  }

  try {
    const context: SkillExecutionContext = {
      conversationId: conversationId || `conv-${Date.now()}`,
      messageId: messageId || `msg-${Date.now()}`,
      userContent: '',
      feedbacks: [],
      addFeedback: () => {},
    };

    const results = await executeSkillActions(skillId, context, parameters);
    const allSuccess = results.every(r => r.success);
    const instructionOnly = results.length === 1 && results[0]?.actionId === 'instruction';
    const mode: 'actions' | 'instruction' = instructionOnly ? 'instruction' : 'actions';
    const executedActions = !instructionOnly;
    
    // #region agent log
    debugLog(
      'skillTools.ts:runAllSkillActions:result',
      'Executed all skill actions',
      {
        skillId,
        resultsCount: results.length,
        allSuccess,
        mode,
        executedActions,
        firstResultActionId: results[0]?.actionId,
        firstResultStatus: results[0]?.status,
        firstResultHasOutput: Boolean(results[0]?.output || results[0]?.stdout),
        firstResultOutputLen: ((results[0]?.output as string) || (results[0]?.stdout as string) || '').length,
      },
      'H14-actions'
    );
    // #endregion

    return {
      success: allSuccess,
      results,
      mode,
      executedActions,
      message: instructionOnly
        ? 'No executable actions were run. Tool returned instruction-only content (guidance), not file creation.'
        : (allSuccess
            ? `All ${results.length} actions executed successfully`
            : `${results.filter(r => r.success).length}/${results.length} actions succeeded`),
    };
  } catch (error) {
    return {
      success: false,
      results: [],
      message: `Error executing actions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 技能工具集合
 * 
 * 这些工具会被注册到 MCP 工具系统中，供 AI 调用
 */
export const skillTools: SkillToolDefinition[] = [
  {
    name: 'list_available_skills',
    description: '获取所有已启用技能的简要列表。返回每个技能的 ID、名称、简短描述和触发关键词。使用此工具了解有哪些技能可用。',
    handler: async () => listAvailableSkills(),
  },
  {
    name: 'get_skill_instructions',
    description: '获取特定技能的完整使用说明。当你确定需要使用某个技能来完成任务时，调用此工具获取详细的操作指南。',
    parameters: {
      skillId: {
        type: 'string',
        description: '要获取说明的技能 ID（从 list_available_skills 返回的 id 字段）',
        required: true,
      },
    },
    handler: async (params) => getSkillInstructions(params.skillId as string),
  },
  {
    name: 'check_skill_dependencies',
    description: '检查技能的依赖是否已满足。在执行需要特定环境（如 Python、Node.js）的技能前使用。',
    parameters: {
      skillId: {
        type: 'string',
        description: '要检查的技能 ID',
        required: true,
      },
    },
    handler: async (params) => checkSkillDependencies(params.skillId as string),
  },
  {
    name: 'list_skill_actions',
    description: '列出技能定义的所有可执行动作。返回每个动作的 ID、名称、类型、描述和风险等级。',
    parameters: {
      skillId: {
        type: 'string',
        description: '技能 ID',
        required: true,
      },
    },
    handler: async (params) => listSkillActions(params.skillId as string),
  },
  {
    name: 'run_skill_action',
    description: '执行技能的特定动作。动作可能需要用户审批，高风险操作会等待用户确认。',
    parameters: {
      skillId: {
        type: 'string',
        description: '技能 ID',
        required: true,
      },
      actionId: {
        type: 'string',
        description: '要执行的动作 ID（从 list_skill_actions 返回的 id 字段）',
        required: true,
      },
    },
    handler: async (params) => runSkillAction(
      params.skillId as string,
      params.actionId as string,
      params.parameters as SkillParameterValues || {},
      params.conversationId as string || '',
      params.messageId as string || ''
    ),
  },
  {
    name: 'run_all_skill_actions',
    description: '按顺序执行技能的所有定义动作。每个动作可能需要用户审批。',
    parameters: {
      skillId: {
        type: 'string',
        description: '技能 ID',
        required: true,
      },
    },
    handler: async (params) => runAllSkillActions(
      params.skillId as string,
      params.parameters as SkillParameterValues || {},
      params.conversationId as string || '',
      params.messageId as string || ''
    ),
  },
];

/**
 * 获取技能工具的 JSON Schema 定义
 * 
 * 用于 LLM 的 Function Calling / Tool Use
 */
export function getSkillToolsSchema(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}> {
  return skillTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters
          ? Object.fromEntries(
              Object.entries(tool.parameters).map(([key, value]) => [
                key,
                { type: value.type, description: value.description },
              ])
            )
          : {},
        required: tool.parameters
          ? Object.entries(tool.parameters)
              .filter(([, value]) => value.required)
              .map(([key]) => key)
          : [],
      },
    },
  }));
}

/**
 * 执行技能工具
 * 
 * 根据工具名称和参数执行相应的处理函数
 * 
 * @param toolName - 工具名称
 * @param params - 工具参数
 */
export async function executeSkillTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  // #region agent log
  debugLog('skillTools.ts:executeSkillTool:entry', 'Executing skill tool', { toolName, params }, 'H5');
  // #endregion
  
  const tool = skillTools.find(t => t.name === toolName);
  if (!tool) {
    // #region agent log
    debugLog('skillTools.ts:executeSkillTool:notFound', 'Skill tool not found', { toolName, availableTools: skillTools.map(t => t.name) }, 'H5');
    // #endregion
    throw new Error(`Unknown skill tool: ${toolName}`);
  }

  const result = await tool.handler(params);
  // #region agent log
  debugLog('skillTools.ts:executeSkillTool:result', 'Skill tool executed', { toolName, resultPreview: typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200) }, 'H5');
  // #endregion
  return result;
}

/**
 * 检查是否为技能工具
 */
export function isSkillTool(toolName: string): boolean {
  return skillTools.some(t => t.name === toolName);
}


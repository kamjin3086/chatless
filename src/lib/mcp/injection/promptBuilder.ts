/**
 * 统一的提示词构建器
 * 
 * ## 设计目标
 * 
 * 提供统一的提示词构建接口，合并分散的提示词生成逻辑。
 * 
 * ## 核心优化
 * 
 * 1. **消息合并**: 将多条 system 消息合并为结构化的少数消息
 * 2. **分阶段策略**: 初始调用、追问阶段使用不同的提示词策略
 * 3. **避免重复**: 追问阶段不重复注入已有的工具描述
 */

import type { InjectionContext, InjectionResult, InjectionSignals, NativeToolDefinition } from './types';
import { MCPPrompts } from '@/lib/prompts/SystemPrompts';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { FILESYSTEM_SERVER_NAME, FILESYSTEM_TOOLS } from '@/lib/mcp/nativeTools/filesystem';
import { SHELL_EXECUTOR_SERVER_NAME, SHELL_EXECUTOR_TOOLS } from '@/lib/mcp/nativeTools/shellExecutor';
import { persistentCache } from '../persistentCache';
import { getGlobalEnabledServers, getAllConfiguredServers } from '../chatIntegration';
import { skillTools } from '@/lib/skills/skillTools';
import { getSkillManager } from '@/lib/skills';
import { shouldUseNativeToolCalls, getToolCallStrategy } from '@/lib/llm/types/tool-capability';
import { RESERVED_MCP_SERVER_NAMES } from '@/lib/mcp/serverNamePolicy';
import { getRuntimePlatform, getShellGuidance } from '@/lib/utils/runtimePlatform';
import { detectSkillIntent } from './intentDetector';
import { CORE_TOOL_POLICY_MD } from './promptTemplates';
import { getToolDoc } from './toolDocLoader';

/**
 * 构建初始调用阶段的提示词
 * 
 * ## 条件降级策略
 * 
 * 1. 如果 Provider/模型支持原生工具调用 API：
 *    - 不注入详细的工具描述到 System Prompt
 *    - 工具定义通过 API 的 tools 参数传递
 *    - 返回 useNativeTools: true
 * 
 * 2. 如果不支持原生工具调用：
 *    - 注入完整的工具描述到 System Prompt
 *    - 依赖正则解析提取工具调用
 *    - 返回 useNativeTools: false
 */
export async function buildInitialPrompt(
  context: InjectionContext,
  signals: InjectionSignals
): Promise<InjectionResult> {
  const messages: Array<{ role: 'system'; content: string }> = [];
  const enabledServers: string[] = [];
  
  // 检测是否应该使用原生工具调用
  const providerName = context.providerName || '';
  const modelName = context.modelName || '';
  const useNativeTools = shouldUseNativeToolCalls(providerName, modelName);
  const toolStrategy = getToolCallStrategy(providerName, modelName);

  // Native-only：不再支持 Prompt 注入 + 文本解析工具调用
  if (!useNativeTools) {
    throw new Error(
      `Native tool calling is required but not supported by provider/model: ${providerName}/${modelName || 'unknown'}`
    );
  }
  
  // 1. 时间上下文（高优先级）
  await injectTimeContext(messages, context.userContent, signals.isTimeRelated);

  // 1.1 运行平台上下文（用于生成稳定可执行的命令）
  try {
    const p = await getRuntimePlatform();
    const g = getShellGuidance(p);
    messages.push({
      role: 'system',
      content: `【运行环境（重要）】
- 平台：${g.platformLabel}
- shell_executor 优先命令风格：${g.preferredShell}
- 规则：
${g.rules.map((r) => `  - ${r}`).join('\n')}`,
    });
  } catch {
    // ignore
  }
  
  // 2. 服务器工具默认收敛：仅在显式 @mention 时才启用外部 MCP server（避免默认把所有 connected/global tools 灌给模型）
  //    内置能力仍通过 filesystem/shell_executor 暴露。
  let enabled: string[] = [];
  if (signals.hasExplicitMention && signals.mentionedServers.length > 0) {
    const globalEnabled = await getGlobalEnabledServers();
    const all = await getAllConfiguredServers();
    const serverMap = new Map(all.map((n) => [n.toLowerCase(), n] as const));

    const mentionedEnabled = signals.mentionedServers
      .map((n) => serverMap.get(n.toLowerCase()))
      .filter((n): n is string => Boolean(n))
      .filter((n) => globalEnabled.includes(n))
      // 内置保留 server（filesystem/skills/web_search/shell_executor）不走外部 mcp 连接列表
      .filter((n) => !RESERVED_MCP_SERVER_NAMES.has(String(n || '').toLowerCase()));

    if (mentionedEnabled.length > 0) {
      try {
        await persistentCache.preconnectServers(mentionedEnabled);
      } catch (error) {
        console.warn('[InjectionManager] 预连接失败:', error);
      }
      enabled = Array.from(new Set([...mentionedEnabled]));
    }
  }
  enabledServers.push(...enabled);
  
  // 4. 构建工具信息（仅在不支持原生工具调用时注入）
  const toolInfoParts: string[] = [];
  
  // Skills：始终注入 skills 概览 + 始终暴露 skills 工具
  // 目标：
  // 1) 即使检测器偶发失效，LLM 也能“看到”全部 skills 概览并自行选择
  // 2) 支持用户显式指定 skill（通过概览中的 id/name）
  // 3) 强制要求：一旦发现 skill 能做用户要求，就立即遵从 skill（再搭配其它 skill / filesystem / shell_executor）
  const _skillIntent = detectSkillIntent(context.userContent || '');
  const shouldExposeSkills = true;
  const shouldExposeWebSearch =
    !!signals.webSearchEnabled &&
    // 只在“明显需要实时信息”的场景下注入，避免所有请求都默认携带 web_search（会分散模型注意力）
    (signals.isTimeRelated || (signals.hasExplicitMention && signals.mentionedServers.some((s) => s.toLowerCase() === WEB_SEARCH_SERVER_NAME)));

  // 构建原生工具定义（Native-only）
  const nativeTools: InjectionResult['nativeTools'] = await buildNativeToolDefinitions({
    servers: enabled,
    includeSkills: shouldExposeSkills,
    includeWebSearch: shouldExposeWebSearch,
  });

  // 使用原生工具调用时，只注入简化的协议说明
  messages.push({
    role: 'system',
    content: CORE_TOOL_POLICY_MD
  });

  // 5.1 会话附加内容：工作目录（临时授权）
  try {
    const convId = context.conversationId || '';
    if (convId) {
      const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
      const wd = useConversationAttachmentStore.getState().getWorkingDir(convId);
      if (wd) {
        messages.push({
          role: 'system',
          content: `【当前会话工作目录】\n- @WorkDir -> ${wd}\n- 需要在该目录及其子目录中读写文件时，可使用 filesystem，并使用 @WorkDir/... 的别名路径或绝对路径。`,
        });
      }
    }
  } catch {
    // ignore
  }

  // 不再自动引导/默认写入 Documents：默认更安全，输出留在 @WorkDir（AppData 工作区）。
  
  // 6. 启用服务器声明
  const allEnabled = [
    ...enabled,
    ...(shouldExposeWebSearch ? [WEB_SEARCH_SERVER_NAME] : []),
    FILESYSTEM_SERVER_NAME,
    SHELL_EXECUTOR_SERVER_NAME,
    ...(shouldExposeSkills ? ['skills'] : []),
  ];
  
  if (allEnabled.length > 0) {
    const serversLine = MCPPrompts.buildEnabledServersLine(allEnabled);
    if (serversLine) {
      messages.push({ role: 'system', content: serversLine });
    }
  }
  
  // 7. 网络搜索策略（如果启用）
  if (shouldExposeWebSearch) {
    messages.push({ role: 'system', content: MCPPrompts.webSearchPolicy });
  }
  
  // 8. Skills 索引注入（始终）
  await injectSkillsIndex(messages);
  
  return {
    systemMessages: messages,
    enabledServers: allEnabled,
    hasToolInfo: toolInfoParts.length > 0 || (Array.isArray(nativeTools) && nativeTools.length > 0),
    useNativeTools,
    nativeTools,
    toolCallStrategy: toolStrategy,
  };
}

/**
 * 构建追问阶段的提示词
 */
export async function buildFollowUpPrompt(
  context: InjectionContext,
  signals: InjectionSignals
): Promise<InjectionResult> {
  const messages: Array<{ role: 'system'; content: string }> = [];
  
  // 1. 时间上下文（简洁版）
  if (signals.isTimeRelated) {
    try {
      const { buildSimpleTimeContext } = await import('@/lib/prompts/TimeContext');
      messages.push({ role: 'system', content: buildSimpleTimeContext() });
    } catch {
      // 忽略错误
    }
  }
  
  // 2. 根据深度和错误状态构建追问提示
  const depth = context.toolCallDepth ?? 1;
  const originalQuestion = context.originalQuestion || context.userContent;
  
  if (depth >= 2) {
    // 第二次追问：强制回答（到达预算/深度上限）
    messages.push({
      role: 'system',
      content: buildForcedAnswerPrompt(originalQuestion)
    });
  } else {
    // 第一次追问
    messages.push({
      role: 'system',
      content: buildFirstFollowUpPrompt(originalQuestion, context.hasToolError)
    });
  }
  
  return {
    systemMessages: messages,
    enabledServers: [],
    hasToolInfo: false
  };
}

/**
 * 注入时间上下文
 */
async function injectTimeContext(
  messages: Array<{ role: 'system'; content: string }>,
  content: string,
  isTimeRelated: boolean
): Promise<void> {
  try {
    const { buildTimeContextMessage } = await import('@/lib/prompts/TimeContext');
    const timeContextMsg = buildTimeContextMessage(isTimeRelated);
    messages.push({ role: 'system', content: timeContextMsg });
  } catch (e) {
    console.warn('[PromptBuilder] 时间上下文注入失败:', e);
  }
}

// Native-only：不再通过 System Prompt 注入“文本工具协议”，因此不再构建文本化工具说明（@mention/简洁模式）。

/**
 * 构建原生工具定义（用于传递给 LLM API 的 tools 参数）
 */
async function buildNativeToolDefinitions(params: {
  servers: string[];
  includeWebSearch: boolean;
  includeSkills: boolean;
}): Promise<NativeToolDefinition[]> {
  const tools: NativeToolDefinition[] = [];
  const TOOL_LIMIT = 20; // 原生工具调用的限制

  const normalizeParams = (p: any): { type: 'object'; properties: Record<string, unknown>; required: string[] } => {
    // 一些 OpenAI-compat 后端会严格要求 parameters.properties 存在；否则会 400
    if (!p || typeof p !== 'object') {
      return { type: 'object', properties: {}, required: [] };
    }
    const props = (p as any).properties;
    const req = (p as any).required;
    return {
      type: 'object',
      properties: (props && typeof props === 'object') ? props : {},
      required: Array.isArray(req) ? req : [],
    };
  };

  // 0. Skills（本地能力包）：按需暴露（默认不注入，减少误调用与 tools 数量）
  if (params.includeSkills) {
    for (const t of skillTools) {
      const fullName = `skills__${t.name}`;
      const doc = await getToolDoc({ toolFullName: fullName });
      tools.push({
        name: fullName,
        description: [t.description || `Skill tool ${t.name}`, doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
        parameters: normalizeParams(
          t.parameters
            ? {
                type: 'object',
                properties: Object.fromEntries(
                  Object.entries(t.parameters).map(([k, v]) => [
                    k,
                    { type: v.type, description: v.description },
                  ])
                ),
                required: Object.entries(t.parameters)
                  .filter(([, v]) => v.required)
                  .map(([k]) => k),
              }
            : { type: 'object' }
        ),
      });
    }
  }

  // 1. 添加 MCP 服务器的工具
  for (const server of params.servers) {
    // 避免与内置保留 server（filesystem/skills/web_search/shell_executor）发生工具名冲突
    if (RESERVED_MCP_SERVER_NAMES.has(String(server || '').toLowerCase())) {
      continue;
    }
    try {
      const serverTools = await persistentCache.getToolsWithCache(server);
      if (!Array.isArray(serverTools)) continue;

      for (const tool of serverTools.slice(0, TOOL_LIMIT)) {
        if (!tool?.name) continue;
        
        // 使用 server__toolname 格式以便解析
        const fullName = `${server}__${tool.name}`;
        const doc = await getToolDoc({ toolFullName: fullName });
        tools.push({
          name: fullName,
          description: [tool.description || `Tool ${tool.name} from ${server}`, doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
          parameters: normalizeParams(tool.inputSchema || { type: 'object' }),
        });
      }
    } catch {
      // 忽略单个服务器的错误
    }
  }

  // 2. 添加网络搜索工具
  if (params.includeWebSearch) {
    tools.push({
      name: `${WEB_SEARCH_SERVER_NAME}__search`,
      description: '在互联网上搜索实时信息',
      parameters: normalizeParams({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
        },
        required: ['query'],
      }),
    });
  }

  // 3. 添加 Filesystem 基础工具（让 LLM 能读写文件、列目录）
  for (const fsTool of FILESYSTEM_TOOLS) {
    const fullName = `${FILESYSTEM_SERVER_NAME}__${fsTool.name}`;
    const doc = await getToolDoc({ toolFullName: fullName });
    tools.push({
      name: fullName,
      description: [fsTool.description || `Filesystem tool ${fsTool.name}`, doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
      parameters: normalizeParams((fsTool as any).input_schema?.schema || { type: 'object' }),
    });
  }

  // 4. 添加 Shell Executor 工具（让 LLM 能执行命令/脚本）
  for (const shellTool of SHELL_EXECUTOR_TOOLS) {
    const fullName = `${SHELL_EXECUTOR_SERVER_NAME}__${shellTool.name}`;
    const doc = await getToolDoc({ toolFullName: fullName });
    tools.push({
      name: fullName,
      description: [shellTool.description || `Shell tool ${shellTool.name}`, doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
      parameters: normalizeParams((shellTool as any).input_schema?.schema || { type: 'object' }),
    });
  }

  return tools;
}

// Native-only：WebSearch 以原生 tool schema 暴露（见 buildNativeToolDefinitions），无需文本描述注入。

/**
 * 构建第一次追问提示词
 */
function buildFirstFollowUpPrompt(originalQuestion: string, hasError?: boolean): string {
  if (hasError) {
    return `工具调用遇到问题。请基于错误信息处理：

【处理策略】：
1. 参数错误：调整参数后重新调用（只输出 1 个工具调用）
2. 连接错误：直接重试（系统会自动重连）
3. 工具不可用：尝试其他工具
4. 无法解决：基于已有知识回答

【重要】如果需要重试工具调用，只进行 1 次结构化工具调用（tool_call），然后停止。

用户问题：${originalQuestion}`;
  }
  
  return `工具调用已完成。请基于返回的结果回答用户问题；如果信息不足，允许继续调用工具进行补充/纠错，但必须遵守预算与停止条件。

【核心要求】：
1. 阅读上面的工具调用结果
2. 如果已经足够回答：直接给出最终中文答案，简洁明了
3. 如果仍不足以回答：继续调用工具获取缺失信息（允许补充/重试）

【工具调用规则（通用）】：
- 只为“缺失/不确定/需要纠错”的信息调用工具，避免无意义探索
- 允许一次输出多个工具调用用于并行补齐（但总数≤3），每个调用参数必须具体且互不重复
- 如果需要重试同一工具：必须改变参数/查询以纠错（不要原样重复）
- 工具预算：最多再补充 2 轮工具调用；若仍不足，请明确说明缺口并给出你能给出的最佳答案

用户问题：${originalQuestion}`;
}

/**
 * 构建强制回答提示词（第二次追问）
 */
function buildForcedAnswerPrompt(originalQuestion: string): string {
  return `【最终回答 - 禁止工具调用】

你已经获得了所有需要的信息。现在必须给出最终答案。

强制要求：
1. 阅读上面的工具调用结果，总结关键信息
2. 直接输出中文答案
3. 绝对禁止输出 <use_mcp_tool> 或任何工具调用指令

用户问题：${originalQuestion}

现在直接回答（不要调用任何工具）：`;
}

// ================================
// Skills 渐进式披露相关函数
// ================================

/**
 * 注入 Skills 索引到系统消息
 * 
 * 实现渐进式披露策略：
 * - 仅注入技能索引（名称 + 简短描述），约 100 tokens/skill
 * - AI 需要详细说明时，通过 get_skill_instructions 工具获取
 * - 可节省约 70-75% 的 Token 消耗
 */
async function injectSkillsIndex(
  messages: Array<{ role: 'system'; content: string }>
): Promise<void> {
  try {
    const manager = getSkillManager();
    
    // 确保 manager 已初始化
    await manager.initialize();
    
    // 获取技能索引提示词
    const skillsPrompt = manager.buildSkillIndexPrompt();

    
    if (skillsPrompt) {
      messages.push({ role: 'system', content: skillsPrompt });
    }
  } catch (error) {
    console.warn('[PromptBuilder] Skills 索引注入失败:', error);
    // 不阻塞主流程
  }
}

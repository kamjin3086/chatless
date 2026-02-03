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
 * 4. **外部化提示词**: 追问提示词从 txt 文件加载，便于维护
 */

import type { InjectionContext, InjectionResult, InjectionSignals, NativeToolDefinition } from './types';
import { MCPPrompts } from '@/lib/prompts/SystemPrompts';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { FILESYSTEM_SERVER_NAME } from '@/lib/mcp/nativeTools/filesystem';
import { SHELL_EXECUTOR_SERVER_NAME } from '@/lib/mcp/nativeTools/shellExecutor';
import { 
  TOOLS_DISCOVER_SERVER_NAME, 
  TOOLS_REGISTRY_TOOLS,
  detectToolGroupIntents,
  detectComplexTaskIntent,
  getToolsForGroup,
  type ToolGroupId,
} from '@/lib/mcp/nativeTools/toolRegistry';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';
import { persistentCache } from '../persistentCache';
import { getGlobalEnabledServers, getAllConfiguredServers } from '../chatIntegration';
import { skillTools } from '@/lib/skills/skillTools';
import { getSkillManager } from '@/lib/skills';
import { shouldUseNativeToolCalls, getToolCallStrategy } from '@/lib/llm/types/tool-capability';
import { RESERVED_MCP_SERVER_NAMES } from '@/lib/mcp/serverNamePolicy';
import { getRuntimePlatform, getShellGuidance } from '@/lib/utils/runtimePlatform';
import { detectSkillIntent } from './intentDetector';
import { CORE_TOOL_POLICY_MD } from './promptTemplates';
import { getToolDoc, buildFirstFollowUpPromptFromDoc, buildForcedAnswerPromptFromDoc } from './toolDocLoader';

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
    
    // 构建命令示例表
    const cmdExamples = Object.entries(g.commandExamples || {})
      .map(([op, cmd]) => `  ${op}: ${cmd}`)
      .join('\n');
    
    messages.push({
      role: 'system',
      content: `【运行环境 - ${g.platformLabel}（强制遵守）】

Shell: ${g.preferredShell}

规则：
${g.rules.map((r) => `- ${r}`).join('\n')}

${cmdExamples ? `常用命令：\n${cmdExamples}` : ''}

💡 创建目录优先用 fs__mkdir，而非 shell 命令`,
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
  
  // Skills：根据意图检测决定是否注入
  // 动态加载策略：只在检测到 skill 相关意图时才注入，减少工具数量
  const skillIntent = detectSkillIntent(context.userContent || '');
  const shouldExposeSkills = skillIntent.shouldPreloadSkill;
  const shouldExposeWebSearch =
    !!signals.webSearchEnabled &&
    // 只在"明显需要实时信息"的场景下注入，避免所有请求都默认携带 web_search（会分散模型注意力）
    (signals.isTimeRelated || (signals.hasExplicitMention && signals.mentionedServers.some((s) => s.toLowerCase() === WEB_SEARCH_SERVER_NAME)));

  // 构建原生工具定义（Native-only，动态加载）
  const nativeTools: InjectionResult['nativeTools'] = await buildNativeToolDefinitions({
    servers: enabled,
    includeSkills: shouldExposeSkills,
    includeWebSearch: shouldExposeWebSearch,
    userContent: context.userContent || '',
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
    const forcedPrompt = await buildForcedAnswerPrompt(originalQuestion);
    messages.push({
      role: 'system',
      content: forcedPrompt
    });
  } else {
    // 第一次追问
    const followUpPrompt = await buildFirstFollowUpPrompt(originalQuestion, context.hasToolError);
    messages.push({
      role: 'system',
      content: followUpPrompt
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

// Native-only：不再通过 System Prompt 注入"文本工具协议"，因此不再构建文本化工具说明（@mention/简洁模式）。

/**
 * 构建原生工具定义（用于传递给 LLM API 的 tools 参数）
 * 
 * ## 动态加载策略
 * 
 * 1. 核心层（始终加载）：fs__read, fs__write, fs__ls, tools__discover
 * 2. 意图检测层：根据用户输入自动注入匹配的工具组
 * 3. AI 请求层：AI 通过 tools__load 请求的工具组
 */
async function buildNativeToolDefinitions(params: {
  servers: string[];
  includeWebSearch: boolean;
  includeSkills: boolean;
  userContent?: string; // 用于意图检测
}): Promise<NativeToolDefinition[]> {
  const tools: NativeToolDefinition[] = [];

  const normalizeParams = (p: any): { type: 'object'; properties: Record<string, unknown>; required: string[] } => {
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

  // 记录已加载文档的服务器，避免重复注入相同文档
  const loadedDocServers = new Set<string>();
  
  const addToolsFromGroup = async (groupId: ToolGroupId) => {
    const groupTools = getToolsForGroup(groupId);
    for (const { server, tool } of groupTools) {
      const fullName = `${server}__${tool.name}`;
      
      // 同一服务器的工具只在第一个工具中注入完整文档
      let doc = '';
      if (!loadedDocServers.has(server)) {
        doc = await getToolDoc({ toolFullName: fullName });
        if (doc) loadedDocServers.add(server);
      }
      
      tools.push({
        name: fullName,
        description: [tool.description || '', doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
        parameters: normalizeParams((tool as any).input_schema?.schema || { type: 'object' }),
      });
    }
  };

  // ========== 1. 核心层：始终加载 ==========
  
  // 1.1 核心文件工具（read, write, ls）
  await addToolsFromGroup('core');
  
  // 1.2 工具发现工具（让 AI 知道还有什么）
  for (const tool of TOOLS_REGISTRY_TOOLS) {
    const fullName = `${TOOLS_DISCOVER_SERVER_NAME}__${tool.name}`;
    tools.push({
      name: fullName,
      description: tool.description || '',
      parameters: normalizeParams((tool as any).input_schema?.schema || { type: 'object' }),
    });
  }

  // ========== 2. 意图检测层：根据用户输入自动注入 ==========
  
  const userContent = params.userContent || '';
  const detectedGroups = detectToolGroupIntents(userContent);
  const loadedGroups: ToolGroupId[] = ['core'];
  
  // 检测复杂任务 → 注入上下文管理工具
  if (detectComplexTaskIntent(userContent) && !detectedGroups.includes('ctx')) {
    detectedGroups.push('ctx');
  }
  
  // 网络搜索开关 → 注入网络工具
  if (params.includeWebSearch && !detectedGroups.includes('web')) {
    detectedGroups.push('web');
  }
  
  // 技能触发 → 注入技能工具
  if (params.includeSkills && !detectedGroups.includes('skills')) {
    detectedGroups.push('skills');
  }

  // ========== 3. AI 请求层：加载 AI 主动请求的工具组 ==========
  
  const store = useToolLoadRequestStore.getState();
  // 关键：已加载的组需要在后续轮次持续注入（否则会出现“上一轮能用、下一轮工具不见了”）
  // 说明：store.loadedGroups 会随着 tools__load 或意图检测逐步累积；这里把它作为“粘性工具组”基础集合。
  const stickyLoaded = (store.loadedGroups || []).filter((g) => g && g !== 'core');
  const pendingRequests = store.getPendingRequests();
  
  // 合并所有需要加载的组
  const groupsToLoad = [...new Set([...stickyLoaded, ...detectedGroups, ...pendingRequests])];
  
  // 加载各组工具
  for (const groupId of groupsToLoad) {
    if (groupId === 'skills') {
      // Skills 特殊处理：只在第一个工具注入文档
      let skillDocLoaded = false;
      for (const t of skillTools) {
        const fullName = `skills__${t.name}`;
        let doc = '';
        if (!skillDocLoaded) {
          doc = await getToolDoc({ toolFullName: fullName });
          if (doc) skillDocLoaded = true;
        }
        tools.push({
          name: fullName,
          description: [t.description || '', doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
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
    } else {
      await addToolsFromGroup(groupId);
    }
    loadedGroups.push(groupId);
  }

  // 更新已加载状态
  store.markLoaded(loadedGroups);

  // ========== 4. MCP 服务器工具（外部服务） ==========
  
  const TOOL_LIMIT = 15;
  for (const server of params.servers) {
    if (RESERVED_MCP_SERVER_NAMES.has(String(server || '').toLowerCase())) {
      continue;
    }
    try {
      const serverTools = await persistentCache.getToolsWithCache(server);
      if (!Array.isArray(serverTools)) continue;

      for (const tool of serverTools.slice(0, TOOL_LIMIT)) {
        if (!tool?.name) continue;
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

  console.log(`[PromptBuilder] 工具加载: 核心(core) + ${groupsToLoad.join(', ') || '无'}, 共 ${tools.length} 个`);

  return tools;
}

// Native-only：WebSearch 以原生 tool schema 暴露（见 buildNativeToolDefinitions），无需文本描述注入。

/**
 * 构建第一次追问提示词
 * 
 * 从 /tool-docs/followup_first.txt 加载提示词模板
 */
async function buildFirstFollowUpPrompt(originalQuestion: string, hasError?: boolean): Promise<string> {
  try {
    return await buildFirstFollowUpPromptFromDoc(originalQuestion, hasError);
  } catch {
    // 降级：使用内联提示词
    if (hasError) {
      return `工具调用遇到错误。请分析错误信息，调整参数后重试或换用其他方法。\n\n用户问题：${originalQuestion}`;
    }
    return `工具调用已完成。请基于结果回答用户问题。如信息不足，可继续调用工具补充。\n\n用户问题：${originalQuestion}`;
  }
}

/**
 * 构建强制回答提示词（第二次追问）
 * 
 * 从 /tool-docs/followup_forced.txt 加载提示词模板
 */
async function buildForcedAnswerPrompt(originalQuestion: string): Promise<string> {
  try {
    return await buildForcedAnswerPromptFromDoc(originalQuestion);
  } catch {
    // 降级：使用内联提示词
    return `【最终回答】你已完成所有工具调用，现在必须给出最终答案。\n\n用户问题：${originalQuestion}`;
  }
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

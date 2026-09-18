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
  getToolsForGroup,
  type ToolGroupId,
} from '@/lib/mcp/nativeTools/toolRegistry';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';
import { persistentCache } from '../persistentCache';
import { getGlobalEnabledServers, getAllConfiguredServers, getEnabledConfiguredServers } from '../chatIntegration';
import { getSkillManager } from '@/lib/skills';
import { shouldUseNativeToolCalls, getToolCallStrategy } from '@/lib/llm/types/tool-capability';
import { RESERVED_MCP_SERVER_NAMES } from '@/lib/mcp/serverNamePolicy';
import { getRuntimePlatform, getShellGuidance } from '@/lib/utils/runtimePlatform';
import { AGENT_MINIMAL_SYSTEM_PROMPT } from './promptTemplates';
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
 *    - 保持普通聊天，不把文本内容解释为可执行调用
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
  
  // 调试日志：追踪工具调用策略决策
  console.debug('[promptBuilder] 工具调用策略:', {
    providerName,
    modelName,
    useNativeTools,
    toolStrategy: toolStrategy.useNative ? 'native' : 'prompt',
    source: toolStrategy.source,
    note: toolStrategy.note,
  });

  // Models without native tool support remain ordinary chat models.
  
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
  
  // 2. External MCP tools are only injected after an explicit mention or a
  //    tools__search result. The search itself covers every enabled server,
  //    without dumping that entire directory into each model request.
  let enabled: string[] = [];
  const conversationId = context.conversationId || undefined;
  const requestedServers = conversationId
    ? useToolLoadRequestStore.getState().getLoadedMcpServers(conversationId)
    : [];
  const configuredEnabled = await getEnabledConfiguredServers();
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

    enabled = mentionedEnabled;
  }
  enabled = Array.from(new Set([
    ...enabled,
    ...requestedServers.filter((server) => configuredEnabled.includes(server)),
  ]));
  if (enabled.length > 0) {
    try {
      await persistentCache.preconnectServers(enabled);
    } catch (error) {
      console.warn('[InjectionManager] 预连接失败:', error);
    }
  }
  enabledServers.push(...enabled);
  
  // 4. 构建工具信息（仅在不支持原生工具调用时注入）
  const toolInfoParts: string[] = [];
  
  // Skills 通过 tools__search / tools__load 按需发现，不根据用户措辞预加载。
  const shouldExposeSkills = false;
  const shouldExposeWebSearch =
    !!signals.webSearchEnabled;

  // 构建原生工具定义（用于 native tool API 或文本注入）
  const nativeTools: InjectionResult['nativeTools'] = await buildNativeToolDefinitions({
    servers: enabled,
    includeSkills: shouldExposeSkills,
    includeWebSearch: shouldExposeWebSearch,
    userContent: context.userContent || '',
    conversationId: context.conversationId,
  });

  // Keep the default contract small. Native schemas carry the detailed
  // operation surface; prompt text must not become a second tool protocol.
  messages.push({
    role: 'system',
    content: AGENT_MINIMAL_SYSTEM_PROMPT
  });

  // Models without native tool support remain chat-only. Do not inject a
  // textual fallback protocol that can be mistaken for an executable call.

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
      // The current mount is the authority. Historic messages and prior
      // selections are deliberately not consulted here: unmounting a library
      // must remove both the tools and the prompt hint immediately.
      const kb = useConversationAttachmentStore.getState().getKnowledgeBase(convId);
      const { DatabaseService } = await import('@/lib/database/services/DatabaseService');
      const attachmentRows = await DatabaseService.getInstance().getDbManager().select<{ n: number }>(
        'SELECT COUNT(*) AS n FROM conversation_document_mappings WHERE conversation_id = ?', [convId],
      );
      if (kb?.id || Number(attachmentRows[0]?.n || 0) > 0) {
        messages.push({
          role: 'system',
          content:
            '【文档检索规则】\n' +
            '当前会话有可访问的知识库或临时附件。需要查资料时先使用 knowledge__list/knowledge__search，再用 knowledge__read 读取完整原文。\n' +
            '文档事实只能引用工具返回的 evidenceId，引用格式为 [[E1]]；不要编造文档、页码或引用。\n' +
            '如果只读取了部分长文档，必须说明覆盖范围；文档没有依据时明确说无法确认。一般知识和推断要与文档事实分开。',
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
    ...(shouldExposeSkills ? ['skill'] : []),
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
  if (shouldExposeSkills) {
    await injectSkillsIndex(messages);
  }
  
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
 * 1. 核心层（始终加载）：有界文件工具、Shell 与可选联网工具
 * 2. 发现层：tools__search 分页返回完整能力目录
 * 3. 会话层：搜索匹配的能力组在下一模型步生效
 */
async function buildNativeToolDefinitions(params: {
  servers: string[];
  includeWebSearch: boolean;
  includeSkills: boolean;
  userContent?: string;
  conversationId?: string;
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
  const coreToolStart = tools.length;
  await addToolsFromGroup('core');
  if (!params.includeWebSearch) {
    tools.splice(coreToolStart, tools.length - coreToolStart,
      ...tools.slice(coreToolStart).filter((tool) => !tool.name.startsWith(`${WEB_SEARCH_SERVER_NAME}__`)));
  }
  
  // 1.2 能力搜索工具（不预加载管理类工具）
  for (const tool of TOOLS_REGISTRY_TOOLS) {
    const fullName = `${TOOLS_DISCOVER_SERVER_NAME}__${tool.name}`;
    tools.push({
      name: fullName,
      description: tool.description || '',
      parameters: normalizeParams((tool as any).input_schema?.schema || { type: 'object' }),
    });
  }

  // ========== 2. 显式会话范围：不根据关键词替模型预先选择能力 ==========
  const loadedGroups: ToolGroupId[] = ['core'];
  const detectedGroups: ToolGroupId[] = [];

  try {
    const convId = params.conversationId || '';
    if (convId) {
      const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
      const kb = useConversationAttachmentStore.getState().getKnowledgeBase(convId);
      const { DatabaseService } = await import('@/lib/database/services/DatabaseService');
      const attachmentRows = await DatabaseService.getInstance().getDbManager().select<{ n: number }>(
        'SELECT COUNT(*) AS n FROM conversation_document_mappings WHERE conversation_id = ?', [convId],
      );
      if ((kb?.id || Number(attachmentRows[0]?.n || 0) > 0) && !detectedGroups.includes('knowledge')) {
        detectedGroups.push('knowledge');
      }
    }
  } catch {
    /* ignore */
  }

  // ========== 3. AI 请求层：加载 AI 主动请求的工具组 ==========
  
  const store = useToolLoadRequestStore.getState();
  const conversationId = params.conversationId || undefined;
  const session = store.sessions[String(conversationId || '__default__')] || { loadedGroups: ['core' as ToolGroupId], requestedGroups: [] };
  // 关键：已加载的组需要在后续轮次持续注入（否则会出现“上一轮能用、下一轮工具不见了”）
  // 说明：store.loadedGroups 会随着 tools__load 或意图检测逐步累积；这里把它作为“粘性工具组”基础集合。
  const stickyLoaded = (session.loadedGroups || []).filter((g) => g && g !== 'core');
  const pendingRequests = store.getPendingRequests(conversationId);
  
  // 合并所有需要加载的组
  const groupsToLoad = [...new Set([...stickyLoaded, ...detectedGroups, ...pendingRequests])];
  
  // 加载各组工具
  for (const groupId of groupsToLoad) {
    // 所有组（包括 skill）现在统一使用 addToolsFromGroup
    await addToolsFromGroup(groupId);
    loadedGroups.push(groupId);
  }

  // 更新已加载状态
  store.markLoaded(loadedGroups, conversationId);

  // ========== 4. MCP 服务器工具（外部服务） ==========
  
  for (const server of params.servers) {
    if (RESERVED_MCP_SERVER_NAMES.has(String(server || '').toLowerCase())) {
      continue;
    }
    try {
      const serverTools = await persistentCache.getToolsWithCache(server);
      if (!Array.isArray(serverTools)) continue;

      for (const tool of serverTools) {
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

/**
 * 将工具定义转换为文本格式的提示词
 * 用于不支持 native tool API 的模型
 * 
 * @param tools 工具定义列表
 * @returns 格式化的工具 schema 提示词
 */
function buildToolSchemaPrompt(tools: NativeToolDefinition[]): string {
  if (!tools || tools.length === 0) return '';

  const toolDescriptions = tools.map((tool, index) => {
    const { name, description, parameters } = tool;
    
    // 构建参数说明
    let paramsText = '';
    if (parameters && parameters.properties) {
      const props = parameters.properties as Record<string, { type?: string; description?: string; enum?: string[] }>;
      const required = parameters.required || [];
      
      const paramsList = Object.entries(props).map(([paramName, paramDef]) => {
        const isRequired = required.includes(paramName);
        const typeStr = paramDef.type || 'any';
        const desc = paramDef.description || '';
        const enumStr = paramDef.enum ? ` (可选值: ${paramDef.enum.join(', ')})` : '';
        const requiredMark = isRequired ? ' [必填]' : ' [可选]';
        return `    - ${paramName}: ${typeStr}${requiredMark}${enumStr}${desc ? ` - ${desc}` : ''}`;
      });
      
      paramsText = paramsList.length > 0 
        ? `\n  参数:\n${paramsList.join('\n')}` 
        : '\n  参数: 无';
    } else {
      paramsText = '\n  参数: 无';
    }

    return `${index + 1}. ${name}\n  描述: ${description}${paramsText}`;
  }).join('\n\n');

  return `【可用工具列表】

你可以使用以下工具来完成任务。调用工具时，请使用以下 JSON 格式：

\`\`\`json
{
  "server": "服务器名称",
  "tool": "工具名称",
  "arguments": {
    "参数名": "参数值"
  }
}
\`\`\`

**重要**：JSON 必须以 \`{"server":\` 开头，\`"tool":\` 紧随其后。

工具列表：

${toolDescriptions}

调用规则：
- 工具名格式为 "server__tool"，调用时 server 填 "__" 前的部分，tool 填后面的部分
- 例如：fs__read → server: "fs", tool: "read"
- 必填参数必须提供，可选参数可省略
- 一次只调用一个工具，等待结果后再决定下一步`;
}

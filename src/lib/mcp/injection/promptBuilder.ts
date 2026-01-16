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

import type { InjectionContext, InjectionResult, InjectionSignals } from './types';
import { MCPPrompts } from '@/lib/prompts/SystemPrompts';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { persistentCache } from '../persistentCache';
import { getConnectedServers, getGlobalEnabledServers, getAllConfiguredServers } from '../chatIntegration';
import { useWebSearchStore } from '@/store/webSearchStore';

/**
 * 构建初始调用阶段的提示词
 */
export async function buildInitialPrompt(
  context: InjectionContext,
  signals: InjectionSignals
): Promise<InjectionResult> {
  const messages: Array<{ role: 'system'; content: string }> = [];
  const enabledServers: string[] = [];
  
  // 1. 时间上下文（高优先级）
  await injectTimeContext(messages, context.userContent, signals.isTimeRelated);
  
  // 2. 获取启用的服务器
  const connected = await getConnectedServers();
  const globalEnabled = await getGlobalEnabledServers();
  let enabled = connected.filter(n => globalEnabled.includes(n));
  
  // 3. 处理 @mention 的服务器
  if (signals.hasExplicitMention && signals.mentionedServers.length > 0) {
    const all = await getAllConfiguredServers();
    const serverMap = new Map(all.map(n => [n.toLowerCase(), n] as const));
    
    const mentionedEnabled = signals.mentionedServers
      .map(n => serverMap.get(n.toLowerCase()))
      .filter((n): n is string => Boolean(n))
      .filter(n => globalEnabled.includes(n));
    
    if (mentionedEnabled.length > 0) {
      // 预连接被 @mention 的服务器
      try {
        await persistentCache.preconnectServers(mentionedEnabled);
      } catch (error) {
        console.warn('[InjectionManager] 预连接失败:', error);
      }
      
      enabled = Array.from(new Set([...mentionedEnabled, ...enabled]));
    }
  }
  
  enabledServers.push(...enabled);
  
  // 4. 构建工具信息（合并为单条消息）
  const toolInfoParts: string[] = [];
  
  // 4.1 构建工具列表
  const hasExplicitMention = signals.hasExplicitMention && signals.mentionedServers.length > 0;
  
  if (hasExplicitMention) {
    // @mention 模式：详细的工具描述
    await buildDetailedToolInfo(toolInfoParts, signals.mentionedServers, globalEnabled, context);
  } else {
    // 普通模式：简洁的工具列表
    await buildSimpleToolInfo(toolInfoParts, enabled.slice(0, 3), context);
  }
  
  // 4.2 添加网络搜索工具
  if (signals.webSearchEnabled) {
    await buildWebSearchToolInfo(toolInfoParts, context);
  }
  
  // 5. 合并工具信息为单条消息
  if (toolInfoParts.length > 0) {
    messages.push({ 
      role: 'system', 
      content: toolInfoParts.join('\n\n') 
    });
  }
  
  // 6. 协议规则（单条消息）
  const protocolParts: string[] = [
    MCPPrompts.protocolRules,
    MCPPrompts.decisionPolicy,
    MCPPrompts.outputContract
  ];
  
  messages.push({
    role: 'system',
    content: protocolParts.join('\n\n')
  });
  
  // 7. 启用服务器声明
  const allEnabled = signals.webSearchEnabled 
    ? [...enabled, WEB_SEARCH_SERVER_NAME]
    : enabled;
  
  if (allEnabled.length > 0) {
    const serversLine = MCPPrompts.buildEnabledServersLine(allEnabled);
    if (serversLine) {
      messages.push({ role: 'system', content: serversLine });
    }
  }
  
  // 8. 网络搜索策略（如果启用）
  if (signals.webSearchEnabled) {
    messages.push({ role: 'system', content: MCPPrompts.webSearchPolicy });
  }
  
  return {
    systemMessages: messages,
    enabledServers: allEnabled,
    hasToolInfo: toolInfoParts.length > 0
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
  
  if (depth >= 2 || context.hasToolError === false) {
    // 第二次追问或明确成功：强制回答
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

/**
 * 构建详细的工具信息（@mention 模式）
 */
async function buildDetailedToolInfo(
  parts: string[],
  mentionedServers: string[],
  globalEnabled: string[],
  _context: InjectionContext
): Promise<void> {
  const DETAIL_LIMIT = 10;
  
  for (const server of mentionedServers) {
    if (!globalEnabled.includes(server)) continue;
    
    try {
      const tools = await persistentCache.getToolsWithCache(server);
      
      if (!Array.isArray(tools) || tools.length === 0) {
        parts.push(`Tools@${server}: (connecting)`);
        continue;
      }
      
      const names = tools.map((t: { name?: string }) => t?.name).filter(Boolean);
      parts.push(`Tools@${server}: ${names.join(', ')}`);
      
      // 详细描述
      const detailLines: string[] = [`ToolsDesc@${server}:`];
      const subset = tools.slice(0, DETAIL_LIMIT);
      
      for (const t of subset) {
        const nm = String(t?.name || '');
        const desc = t?.description ? String(t.description) : '';
        const schema = (t?.inputSchema?.schema || t?.inputSchema || t?.input_schema?.schema || t?.input_schema) as Record<string, unknown>;
        const req: string[] = Array.isArray(schema?.required) ? schema.required as string[] : [];
        const props: Record<string, Record<string, unknown>> = (schema?.properties || {}) as Record<string, Record<string, unknown>>;
        const optional = Object.keys(props).filter(k => !req.includes(k));
        
        detailLines.push(`• ${nm}${desc ? ` - ${desc}` : ''}`);
        detailLines.push(`   required: ${req.length ? req.join(', ') : '(none)'}`);
        if (optional.length) detailLines.push(`   optional: ${optional.join(', ')}`);
      }
      
      parts.push(detailLines.join('\n'));
    } catch {
      parts.push(`Tools@${server}: (error)`);
    }
  }
}

/**
 * 构建简洁的工具信息（普通模式）
 */
async function buildSimpleToolInfo(
  parts: string[],
  servers: string[],
  _context: InjectionContext
): Promise<void> {
  const TOOL_LIMIT = 8;
  
  for (const server of servers) {
    try {
      const tools = await persistentCache.getToolsWithCache(server);
      if (!Array.isArray(tools) || tools.length === 0) continue;
      
      const names = tools
        .map((t: { name?: string }) => t?.name)
        .filter(Boolean)
        .slice(0, TOOL_LIMIT);
      
      if (names.length > 0) {
        parts.push(`Tools@${server}: ${names.join(', ')}`);
      }
    } catch {
      // 忽略错误
    }
  }
}

/**
 * 构建网络搜索工具信息
 */
async function buildWebSearchToolInfo(
  parts: string[],
  context: InjectionContext
): Promise<void> {
  // 获取 provider 信息
  let providerId = '';
  try {
    const s = useWebSearchStore.getState();
    providerId = context.conversationId 
      ? s.getConversationProvider(context.conversationId) 
      : s.provider;
  } catch {
    // 忽略错误
  }
  
  const hasWebFetch = providerId === 'ollama' || providerId === 'duckduckgo';
  const toolNames = hasWebFetch ? 'search, fetch' : 'search';
  
  const lines: string[] = [
    `Tools@${WEB_SEARCH_SERVER_NAME}: ${toolNames}`,
    `ToolsDesc@${WEB_SEARCH_SERVER_NAME}:`,
    `• search - 在互联网上搜索实时信息`,
    `   required: query`,
    `   example: {"query":"北京今天的天气"}`
  ];
  
  if (hasWebFetch) {
    lines.push(
      `• fetch - 抓取指定网页内容`,
      `   required: url`,
      `   example: {"url":"https://example.com"}`
    );
  }
  
  parts.push(lines.join('\n'));
}

/**
 * 构建第一次追问提示词
 */
function buildFirstFollowUpPrompt(originalQuestion: string, hasError?: boolean): string {
  if (hasError) {
    return `工具调用遇到问题。请基于错误信息处理：

【处理策略】：
1. 参数错误：调整参数后重新调用
2. 连接错误：直接重试（系统会自动重连）
3. 工具不可用：尝试其他工具
4. 无法解决：基于已有知识回答

用户问题：${originalQuestion}`;
  }
  
  return `基于工具调用结果，给用户一个完整的中文答案。

【核心任务】：
1. 工具已返回结果，你的任务是阅读和总结
2. 直接输出中文答案，不要输出工具调用指令
3. 答案简洁明了

用户问题：${originalQuestion}`;
}

/**
 * 构建强制回答提示词（第二次追问）
 */
function buildForcedAnswerPrompt(originalQuestion: string): string {
  return `【最终回答要求】

工具调用结果已提供，现在必须给出最终答案。

任务：
1. 阅读上面的工具调用结果
2. 直接输出中文答案（不超过150字）
3. 禁止输出任何工具调用指令

用户问题：${originalQuestion}

现在直接回答：`;
}


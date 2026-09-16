import { ParameterPolicyEngine } from '@/lib/llm/ParameterPolicy';
import { useChatStore } from '@/store/chatStore';

/**
 * 根据 provider/model 和会话上下文，组装对话参数（含策略与 MCP servers）。
 */
export async function composeChatOptions(
  provider: string,
  model: string,
  baseOptions: Record<string, any>,
  conversationId: string | null,
  userContent: string
): Promise<Record<string, any>> {
  // 1) 参数策略
  const refined = ParameterPolicyEngine.apply(provider, model, baseOptions || {});

  // 2) MCP servers（按会话启用 + 全局启用 + 当前连接 + 文本中的 @mention）
  try {
    const { getEnabledServersForConversation, getConnectedServers, getGlobalEnabledServers, getAllConfiguredServers } = await import('@/lib/mcp/chatIntegration');
    let enabled = conversationId ? await getEnabledServersForConversation(conversationId) : [];
    if (!enabled || enabled.length === 0) {
      const global = await getGlobalEnabledServers();
      if (global && global.length) enabled = global;
    }
    if (!enabled || enabled.length === 0) enabled = await getConnectedServers();

    // 将本条消息中的 @mcp 放到最前
    const mentionRe = /@([a-zA-Z0-9_-]{1,64})/g; const mentioned: string[] = []; let mm: RegExpExecArray | null;
    while ((mm = mentionRe.exec(userContent))) { const n = mm[1]; if (n && !mentioned.includes(n)) mentioned.push(n); }
    if (mentioned.length) {
      const all = await getAllConfiguredServers(); const map = new Map(all.map(n => [n.toLowerCase(), n] as const));
      const filtered = mentioned.map(n => map.get(n.toLowerCase())).filter(Boolean) as string[];
      if (filtered.length) enabled = Array.from(new Set<string>([...filtered, ...enabled]));
    }
    (refined as any).mcpServers = enabled || [];
  } catch {
    // ignore mcp fetch errors
  }

  // 3) 原生工具调用支持
  // 规则（明确区分）：
  // - chat 模式：仅允许 web_search（且仅当用户开启网络搜索）
  // - agent 模式：工具由 AgentLoopRunner Envelope 单次注入
  const st = useChatStore.getState();
  const conv: any =
    conversationId ? st.conversations.find((c: any) => c.id === conversationId) : null;
  const toolMode: 'chat' | 'agent' =
    (conv?.tool_mode as any) || (st as any).sessionToolMode || 'chat';

  
  if (toolMode === 'chat') {
    // Search results are injected before the model request by HistoryBuilder.
    // Avoid tools/tool_choice here: many OpenAI-compatible endpoints reject them.
    return refined;
  }

  // agent 模式：工具与 system 由 AgentLoopRunner 单次 Envelope 注入
  return refined;
}

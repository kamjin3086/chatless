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
  try {
    const { buildMcpSystemInjections, needsMcpInjection } = await import('@/lib/mcp/promptInjector');
    const st = useChatStore.getState();
    const conv: any =
      conversationId ? st.conversations.find((c: any) => c.id === conversationId) : null;
    const toolMode: 'chat' | 'agent' =
      (conv?.tool_mode as any) || (st as any).sessionToolMode || 'chat';
    const hasExplicitMention = /@([a-zA-Z0-9_-]{1,64})/.test(userContent);

    // 决策策略：
    // - agent：总是允许注入 tools（并强制注入，使模型即使面对“你好”也能调用工具）
    // - chat：默认不注入；但允许显式 @server 触发（用户明确想用工具时）
    const shouldInject =
      toolMode === 'agent' ? true : (hasExplicitMention ? true : needsMcpInjection(userContent, conversationId || undefined));
    if (!shouldInject) {
      // 普通聊天：不注入 tools（让不支持 tools 的模型也能正常对话）
      return refined;
    }
    const injection = await buildMcpSystemInjections(
      userContent,
      conversationId || undefined,
      provider,
      model,
      { forceInject: toolMode === 'agent' }
    );
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionComposer.ts:H1',message:'injection result',data:{useNativeTools:injection.useNativeTools,nativeToolsCount:injection.nativeTools?.length||0,provider,model},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    if (!injection.useNativeTools) {
      throw new Error(`Native tool calling is required. Unsupported provider/model: ${provider}/${model}`);
    }

    if (injection.nativeTools && injection.nativeTools.length > 0) {
      // 转换为 ToolDefinition 格式
      (refined as any).tools = injection.nativeTools.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
      (refined as any).toolChoice = 'auto';
      (refined as any).__useNativeTools = true;
      
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionComposer.ts:H1-enabled',message:'原生工具调用已启用',data:{toolCount:injection.nativeTools.length,toolNames:injection.nativeTools.slice(0,5).map((t:any)=>t.name)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      
      console.debug('[OptionComposer] 启用原生工具调用，工具数量:', injection.nativeTools.length);
    }
  } catch (e) {
    // Native-only：这里的失败应中断发送流程，由上层提示用户更换 provider/model
    throw e;
  }

  return refined;
}



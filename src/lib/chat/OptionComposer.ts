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
  // - agent 模式：允许注入全部工具（skills + mcp + web_search）
    const { buildMcpSystemInjections } = await import('@/lib/mcp/promptInjector');
  const wsMod: any = await import('@/store/webSearchStore').catch(() => null);
  const webSearchEnabled = !!wsMod?.useWebSearchStore?.getState?.().isWebSearchEnabled;
  const st = useChatStore.getState();
  const conv: any =
    conversationId ? st.conversations.find((c: any) => c.id === conversationId) : null;
  const toolMode: 'chat' | 'agent' =
    (conv?.tool_mode as any) || (st as any).sessionToolMode || 'chat';
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionComposer.ts:mode',message:'composeChatOptions mode decision',data:{provider,model,toolMode,webSearchEnabled,conversationId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H_mode'})}).catch(()=>{});
  // #endregion
  
  if (toolMode === 'chat') {
    if (!webSearchEnabled) {
      return refined;
    }
    
    const { WEB_SEARCH_SERVER_NAME, WEB_SEARCH_TOOL_SCHEMA, WEB_FETCH_TOOL_SCHEMA } = await import('@/lib/mcp/nativeTools/webSearch');
    const { shouldUseNativeToolCalls } = await import('@/lib/llm/types/tool-capability');
    const useNativeTools = shouldUseNativeToolCalls(provider, model);
    if (!useNativeTools) {
      throw new Error(`Chat mode web_search requires native tool calling. Unsupported provider/model: ${provider}/${model}`);
    }
    
    const normalizeParams = (p: any): { type: 'object'; properties: Record<string, unknown>; required: string[] } => {
      if (!p || typeof p !== 'object') return { type: 'object', properties: {}, required: [] };
      const props = (p as any).properties;
      const req = (p as any).required;
      return {
        type: 'object',
        properties: (props && typeof props === 'object') ? props : {},
        required: Array.isArray(req) ? req : [],
      };
    };
    
    const tools = [
      {
        name: `${WEB_SEARCH_SERVER_NAME}__${WEB_SEARCH_TOOL_SCHEMA.name}`,
        description: WEB_SEARCH_TOOL_SCHEMA.description,
        parameters: normalizeParams((WEB_SEARCH_TOOL_SCHEMA as any)?.input_schema?.schema),
      },
      {
        name: `${WEB_SEARCH_SERVER_NAME}__${WEB_FETCH_TOOL_SCHEMA.name}`,
        description: WEB_FETCH_TOOL_SCHEMA.description,
        parameters: normalizeParams((WEB_FETCH_TOOL_SCHEMA as any)?.input_schema?.schema),
      },
    ];
    
    (refined as any).tools = tools;
    (refined as any).toolChoice = 'auto';
    (refined as any).__useNativeTools = true;
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionComposer.ts:chat-websearch-only',message:'Chat mode: enabled web_search tools only',data:{toolNames:tools.map(t=>t.name)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H_mode'})}).catch(()=>{});
    // #endregion
    
    return refined;
  }
  
  // toolMode === 'agent'：注入全部工具
  const injection = await buildMcpSystemInjections(
    userContent,
    conversationId || undefined,
    provider,
    model,
    { forceInject: true }
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

  return refined;
}



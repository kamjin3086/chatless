import { shouldAutoAuthorize } from '@/lib/mcp/authorizationConfig';
import { useChatStore } from '@/store/chatStore';
import { normalizeToolArgs } from './util';

export interface ToolCallParsed {
  serverName?: string;
  server?: string;
  toolName?: string;
  tool?: string;
  arguments?: unknown;
  args?: unknown;
}

export interface HandleToolCallOptions {
  conversationId: string;
  assistantMessageId: string;
  parsed: ToolCallParsed;
  /**
   * 自动授权时的执行回调（可选）
   */
  onAutoExecute?: (server: string, tool: string, args: Record<string, unknown> | undefined, cardId: string) => void | Promise<void>;
  /**
   * 需要授权时的挂起回调（可选）：用于把授权请求注册到外部系统（如 store）
   */
  onRequestAuthorization?: (info: { server: string; tool: string; args: Record<string, unknown> | undefined; cardId: string }) => void | Promise<void>;
}

/**
 * 专责工具卡片的插入与状态初始化（含授权判定）
 */
export async function handleToolCall(options: HandleToolCallOptions): Promise<void> {
  const { assistantMessageId, conversationId, parsed } = options;
  const st = useChatStore.getState();
  
  const server = parsed.serverName || parsed.server || '';
  const tool = parsed.toolName || parsed.tool || '';
  const args = normalizeToolArgs(parsed.arguments !== undefined ? parsed.arguments : parsed.args);
  if (!server || !tool) return;
  
  const forcedAuth =
    String(server || '').toLowerCase() === 'filesystem' &&
    (String(tool || '').toLowerCase() === 'write_file' || String(tool || '').toLowerCase() === 'delete_file');
  const needAuth = forcedAuth ? true : !(await shouldAutoAuthorize(server));
  const cardId = crypto.randomUUID();
  
  // 写入卡片占位标记，确保 UI 始终可见
  const conv = st.conversations.find(c=>c.id===conversationId);
  const msg = conv?.messages.find(m=>m.id===assistantMessageId);
  const prev = (msg?.content || '') + '';
  const marker = JSON.stringify({
    __tool_call_card__: {
      id: cardId, server, tool,
      status: needAuth ? 'pending_auth' : 'running',
      args: args || {}, messageId: assistantMessageId
    }
  });
  const next = prev + (prev ? '\n' : '') + marker;
  st.updateMessageContentInMemory(assistantMessageId, next);
  
  if (needAuth) {
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_RESULT',
      server, tool,
      ok: false,
      errorMessage: 'pending_auth',
      cardId
    } as any);
    // 通知外部注册待授权请求（由调用方提供上下文执行逻辑）
    try { await options.onRequestAuthorization?.({ server, tool, args, cardId }); } catch { /* noop */ }
  } else {
    st.dispatchMessageAction(assistantMessageId, {
      type: 'TOOL_HIT',
      server, tool, args, cardId
    } as any);
    // 自动执行工具
    try { await options.onAutoExecute?.(server, tool, args, cardId); } catch { /* noop */ }
  }
}



import { useChatStore } from '@/store/chatStore';
import { HistoryBuilder } from '@/lib/chat/HistoryBuilder';

/**
 * 从某个“工具卡”触发后续：用于“跳过/停止”时把合成 tool output 喂回 agent，继续下一步。
 */
export async function continueAfterToolCardAction(params: {
  assistantMessageId: string;
  cardId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
}): Promise<boolean> {
  const { assistantMessageId, cardId, server, tool, args, result } = params;
  const st = useChatStore.getState();

  const conv = st.conversations.find(
    (c) => Array.isArray((c as any).messages) && (c as any).messages.some((m: any) => m?.id === assistantMessageId)
  );
  if (!conv) return false;
  // agent 模式：续写由 while(true) AgentLoop 统一驱动，避免从卡片触发旧的递归 continueWithToolResult
  if (((conv as any).tool_mode as any) === 'agent') return false;

  const provider = (conv as any).model_provider || '';
  const model = (conv as any).model_id || '';
  if (!model) return false;

  const msgs: any[] = Array.isArray((conv as any).messages) ? (conv as any).messages : [];
  const idx = msgs.findIndex((m) => m?.id === assistantMessageId);
  const slice = idx >= 0 ? msgs.slice(0, idx + 1) : msgs;

  let originalUserContent = '';
  for (let i = slice.length - 1; i >= 0; i--) {
    const m = slice[i];
    if (m?.role === 'user') {
      originalUserContent = String(m?.content || '');
      break;
    }
  }

  const hb = new HistoryBuilder();
  for (const m of slice) {
    if (!m) continue;
    if (m.role === 'user') hb.addUser(String(m.content || ''), m.images, m.context_data);
    else if (m.role === 'assistant') hb.addAssistant(String(m.content || ''));
  }
  const historyForLlm = hb.take();

  const { continueWithToolResult } = await import('@/lib/mcp/ToolCallOrchestrator');
  await continueWithToolResult({
    assistantMessageId,
    provider,
    model,
    conversationId: String((conv as any).id),
    historyForLlm: historyForLlm as any,
    originalUserContent,
    server,
    tool,
    args: args || {},
    cardId,
    result,
  } as any);

  return true;
}


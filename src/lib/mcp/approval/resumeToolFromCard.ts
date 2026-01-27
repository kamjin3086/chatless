import { useChatStore } from '@/store/chatStore';
import { HistoryBuilder } from '@/lib/chat/HistoryBuilder';

/**
 * 从“残留/恢复会话”的审批卡片恢复执行：
 * - 用 chatStore 找到所属会话、provider/model
 * - 重新构建 historyForLlm & originalUserContent
 * - 调用 executeToolCall 重新发起（配合 preApprove，可避免二次点审批）
 */
export async function resumeToolCallFromCard(params: {
  assistantMessageId: string;
  cardId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}): Promise<boolean> {
  const { assistantMessageId, cardId, server, tool, args } = params;
  const st = useChatStore.getState();

  // 找到 message 所属会话
  const conv = st.conversations.find((c) => Array.isArray((c as any).messages) && (c as any).messages.some((m: any) => m?.id === assistantMessageId));
  if (!conv) return false;

  const provider = (conv as any).model_provider || '';
  const model = (conv as any).model_id || '';
  if (!model) return false;

  const msgs: any[] = Array.isArray((conv as any).messages) ? (conv as any).messages : [];
  const idx = msgs.findIndex((m) => m?.id === assistantMessageId);
  const slice = idx >= 0 ? msgs.slice(0, idx + 1) : msgs;

  // 原始用户输入：取该 assistant 之前最近的一条 user 消息
  let originalUserContent = '';
  for (let i = slice.length - 1; i >= 0; i--) {
    const m = slice[i];
    if (m?.role === 'user') {
      originalUserContent = String(m?.content || '');
      break;
    }
  }

  // 构建历史
  const hb = new HistoryBuilder();
  for (const m of slice) {
    if (!m) continue;
    if (m.role === 'user') hb.addUser(String(m.content || ''), m.images, m.context_data);
    else if (m.role === 'assistant') hb.addAssistant(String(m.content || ''));
  }
  const historyForLlm = hb.take();

  const { executeToolCall } = await import('@/lib/mcp/ToolCallOrchestrator');
  await executeToolCall({
    assistantMessageId,
    conversationId: String((conv as any).id),
    server,
    tool,
    args: args || {},
    provider,
    model,
    historyForLlm: historyForLlm as any,
    originalUserContent,
    cardId,
  });

  return true;
}


/**
 * 工具调用事件处理器
 * 
 * 职责：
 * - 处理 tool_call 事件
 * - 清理内容中的工具调用指令
 * - 创建工具卡片
 * - 触发工具执行
 * 
 * ## 去重机制
 * 
 * 流式处理中，同一个工具调用指令可能被多次检测到（因为每个 delta 都会被独立解析）。
 * 为防止重复执行，维护一个全局的 Set 来跟踪已处理的工具调用。
 * 
 * Key 格式: `${messageId}:${server}.${tool}:${JSON.stringify(args)}`
 */

import type { StreamEvent } from '@/lib/llm/types/stream-events';
import type { EventHandler, StreamContext } from '../types';
import { useChatStore } from '@/store/chatStore';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { repairToolCall } from '@/lib/mcp/toolRepair/repairToolCall';


const coordinator = ToolCallCoordinator.getInstance();

export class ToolCallEventHandler implements EventHandler {
  canHandle(event: StreamEvent): boolean {
    return event.type === 'tool_call';
  }

  async handle(event: StreamEvent, context: StreamContext): Promise<void> {
    // 类型窄化
    if (event.type !== 'tool_call') {
      return;
    }

    
    // 输入验证
    if (!event || !event.parsed) {
      console.warn('[ToolCallHandler] Invalid event: missing parsed data');

      return;
    }

    if (!context || !context.messageId || !context.conversationId) {
      console.error('[ToolCallHandler] Invalid context: missing required fields');
      return;
    }

    const parsed = event.parsed || {};
    const parsedServer = parsed.serverName || '';
    const parsedTool = parsed.toolName || '';
    const parsedArguments = typeof parsed.arguments === 'string' ? String(parsed.arguments) : undefined;

    // 过滤无效工具调用：空值、unknown、包含错误格式标记
    const isInvalidServer = !parsedServer || parsedServer === 'unknown' || parsedServer.includes('use_mcp_tool') || parsedServer.includes('>');
    const isInvalidTool = !parsedTool || parsedTool === 'unknown' || parsedTool === 'default';
    
    if (isInvalidServer || isInvalidTool) {
      console.warn('[ToolCallHandler] Invalid tool call: invalid server or tool name', { server: parsedServer, tool: parsedTool });

      return;
    }

    // ============================================================
    // Tool Repair（工具名/参数 JSON 修复 + 常见字段别名修复）
    // ============================================================
    const repaired = repairToolCall({
      server: parsedServer,
      tool: parsedTool,
      rawArguments: parsedArguments,
    });
    const server = repaired.server;
    const tool = repaired.tool;
    const args = repaired.args;
    
    // ============================================================
    // 关键：全局工具调用去重（协调器）
    // ============================================================
    const rawCallId = typeof event.toolCall === 'string' ? event.toolCall : '';
    const normalizedCallId =
      rawCallId && rawCallId.length <= 256 && !/\s/.test(rawCallId) ? rawCallId : undefined;
    const stableCardId =
      normalizedCallId
        ? `tc_${normalizedCallId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}`
        : crypto.randomUUID();

    const lockResult = coordinator.tryAcquireToolCallLock({
      messageId: context.messageId,
      server,
      tool,
      args,
      callId: normalizedCallId,
      cardId: stableCardId,
      source: 'event',
    });

    if (!lockResult.acquired) {

      console.debug('[ToolCallHandler] 跳过重复工具调用 (协调器):', lockResult.key);
      return;
    }


    let cardId: string | undefined;

    try {
      // 标记“本条消息已启动过工具”（用于 StreamOrchestrator.handleComplete skipFallback）
      // 注意：不能用它来阻断后续 tool_call，否则同一条消息内的多工具调用会被丢弃（例如多城市天气）。
      context.toolStarted = true;

      // 注意：不需要清理 context.content
      // 原因：
      // 1. context.content 保留原始内容（包括指令）用于解析
      // 2. UI渲染的内容已经在 segments 层过滤了
      // 3. 这是线性委派的优势：各层职责清晰，不需要重复处理
      
      // 创建工具卡片ID
      cardId = stableCardId;

      // 更新FSM状态
      context.fsmState = 'TOOL_RUNNING';

      // 获取store
      const store = useChatStore.getState();
      
      if (!store) {
        throw new Error('Store not available');
      }
      
      // 派发工具卡片创建动作到FSM
      // FSM会通过 insertRunningCard 将卡片追加到segments
      if (typeof store.dispatchMessageAction === 'function') {
        store.dispatchMessageAction(context.messageId, { 
          type: 'TOOL_HIT', 
          server, 
          tool, 
          args, 
          cardId 
        });
      }

      // 修复失败：不进入执行，直接把结构化错误回灌给模型，要求其自修
      if (!repaired.ok) {
        const schemaHint = JSON.stringify(
          {
            code: 'TOOL_REPAIR_FAILED',
            issue: repaired.issue,
            repairs: repaired.repairs,
            rawArguments: repaired.rawArguments,
          },
          null,
          2
        );
        if (typeof store.dispatchMessageAction === 'function') {
          store.dispatchMessageAction(context.messageId, {
            type: 'TOOL_RESULT',
            server,
            tool,
            ok: false,
            errorMessage: repaired.issue?.message || 'tool repair failed',
            schemaHint,
            cardId,
          });
        }
        try {
          coordinator.markToolCallComplete(lockResult.key, 'failed');
        } catch {
          // ignore
        }
        try {
          const { continueWithToolResult } = await import('@/lib/mcp/ToolCallOrchestrator');
          await continueWithToolResult({
            assistantMessageId: context.messageId,
            provider: context.metadata.provider,
            model: context.metadata.model,
            conversationId: context.conversationId,
            historyForLlm: context.metadata.historyForLlm as any,
            originalUserContent: context.metadata.originalUserContent,
            server,
            tool,
            args,
            cardId,
            callId: normalizedCallId,
            result: {
              error: {
                code: 'TOOL_REPAIR_FAILED',
                issue: repaired.issue,
                repairs: repaired.repairs,
                rawArguments: repaired.rawArguments,
              },
            },
          });
        } catch (e) {
          console.warn('[ToolCallHandler] continueWithToolResult after repair-fail failed:', e);
        }
        return;
      }

      // 执行工具调用（独立的错误处理）
      try {

        
        const { executeToolCall } = await import('@/lib/mcp/ToolCallOrchestrator');
        await executeToolCall({
          assistantMessageId: context.messageId,
          conversationId: context.conversationId,
          server,
          tool,
          args,
          provider: context.metadata.provider,
          model: context.metadata.model,
          historyForLlm: context.metadata.historyForLlm as any,
          originalUserContent: context.metadata.originalUserContent,
          callId: normalizedCallId,
          cardId,
          lockKey: lockResult.key,
        });

      } catch (executeError) {
        console.error('[ToolCallHandler] Tool execution failed:', executeError);

        
        // 更新工具卡片为错误状态
        if (cardId && typeof store.dispatchMessageAction === 'function') {
          store.dispatchMessageAction(context.messageId, {
            type: 'TOOL_RESULT',
            server,
            tool,
            ok: false,
            errorMessage: executeError instanceof Error 
              ? executeError.message 
              : 'Tool execution failed',
            cardId,
          });
        }
        
        // 不重新抛出错误，允许流继续
      }
    } catch (error) {
      console.error('[ToolCallHandler] Handler failed:', error);
      
      // 如果创建了卡片，尝试更新为错误状态
      if (cardId) {
        try {
          const store = useChatStore.getState();
          if (store && typeof store.dispatchMessageAction === 'function') {
            store.dispatchMessageAction(context.messageId, {
              type: 'TOOL_RESULT',
              server,
              tool,
              ok: false,
              errorMessage: error instanceof Error 
                ? error.message 
                : 'Tool call handler failed',
              cardId,
            });
          }
        } catch { /* 忽略二次错误 */ }
      }
      
      // 重置工具启动标记，允许后续工具调用
      context.toolStarted = false;
      
      throw error; // 让 Orchestrator 处理
    }
  }
}

// 调试期间保留有限 console，勿全局禁用 no-console
// Conversation actions delegate generation to the unified Agent runtime.
import { useCallback, useState, useRef, useEffect } from 'react';
import { toast } from '@/components/ui/sonner';
import { showSendErrorToast } from '@/lib/chat/showSendErrorToast';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useChatStore } from "@/store/chatStore";
import { type Message as LlmMessage } from '@/lib/llm';
import { HistoryBuilder } from '@/lib/chat/HistoryBuilder';
import type { Message, Conversation } from "@/types/chat";
import { exportConversationMarkdown } from '@/lib/chat/actions/download';
// import { retryAssistantMessage } from '@/lib/chat/actions/retry';
import { MessageAutoSaver } from '@/lib/chat/MessageAutoSaver';
import { ModelParametersService } from '@/lib/model-parameters';
import { composeChatOptions } from '@/lib/chat/OptionComposer';
import { usePromptStore } from '@/store/promptStore';
import { renderPromptContent } from '@/lib/prompt/render';
import { performanceMonitor } from '@/lib/performance/PerformanceMonitor';
import {
  startIdleGenerationWatch,
  type IdleGenerationWatchHandle,
} from '@/lib/chat/idleGenerationWatch';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { AgentLoopRunner } from '@/lib/mcp/agentLoop';
import { useAuthorizationStore } from '@/store/authorizationStore';
import { getProcessSandbox } from '@/lib/skills/sandbox';
// 动态导入 Title 相关函数，避免静态未用告警

// type StoreMessage = any;

export const useChatActions = (selectedModelId: string | null, currentProviderName: string, sessionParameters?: any) => {
  const router = useRouter();
  const currentConversationId = useChatStore((state) => state.currentConversationId);
  const currentConversation = useChatStore((state) => 
    currentConversationId ? state.conversations.find(c => c.id === currentConversationId) : null
  );
  
  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const updateConversation = useChatStore((state) => state.updateConversation);
  const setInputDraft = useChatStore((s)=>s.setInputDraft);
  const notifyStreamStart = useChatStore((s)=>s.notifyStreamStart);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const createConversation = useChatStore((state) => state.createConversation);
  const setLastUsedModelForChat = useChatStore((state) => state.setLastUsedModelForChat);
  
  // 添加滚动到底部的回调函数
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  
  // 设置滚动回调函数
  const setScrollToBottomCallback = useCallback((callback: () => void) => {
    scrollToBottomRef.current = callback;
  }, []);
  
  const isGenerating = useChatStore((state) => {
    const current = state.conversations.find(c => c.id === state.currentConversationId);
    return current?.messages?.some(m => m.status === 'loading') ?? false;
  });

  // MCP 工具递归计数已迁移到 streamToolMiddleware

  const [isStale, setIsStale] = useState(false);
  const lastActivityTimeRef = useRef<number>(Date.now());
  
  // 运行状态来自 AgentRunState；UI 不再扫描工具卡片推断是否仍在执行。
  const agentRunActive = useChatStore((state) => {
    const cid = state.currentConversationId;
    if (!cid) return false;
    const conv = state.conversations.find((c) => c.id === cid);
    const assistant = [...(conv?.messages || [])].reverse().find((m) => m.role === 'assistant');
    return Boolean(assistant?.id && state.agentRuns?.[assistant.id]?.running);
  });

  const isLoading = (isGenerating && !isStale) || agentRunActive;

  // 优化的流式更新状态管理
  const currentContentRef = useRef<string>('');
  const pendingContentRef = useRef<string>('');
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  
  // 批量更新机制
  const batchUpdateRef = useRef<{
    tokenCount: number;
    lastUpdateTime: number;
    pendingUpdate: boolean;
  }>({
    tokenCount: 0,
    lastUpdateTime: 0,
    pendingUpdate: false
  });
  
  const idleWatchRef = useRef<IdleGenerationWatchHandle | null>(null);
  const autoSaverRef = useRef<MessageAutoSaver | null>(null);
  
  // 添加内容变化检测变量
  const lastSavedContentRef = useRef('');
  
  // 防抖状态引用移除，保持最小必要状态
  const debouncedTokenUpdateRef = useRef<NodeJS.Timeout | null>(null);

  // stop 二次确认：第一次 stop 停生成/链路；短时间内再次 stop 则尝试强制取消正在运行的工具
  const [stopGenerationHint, setStopGenerationHint] = useState<string | null>(null);

  const navigateToSettings = useCallback((tab: string = 'localModels') => {
    router.push(`/settings?tab=${tab}`);
  }, [router]);

  // 将错误信息压缩为短文本，避免右下角提示过长
  // onError is handled by StreamOrchestrator; this helper remains for retry
  // and provider setup paths.
  // const _briefErrorText = useCallback((err: unknown, maxLen: number = 180): string => trimToastDescription(err, maxLen) || '', []);

  const checkApiKeyValidity = useCallback(async (providerName: string, modelId: string): Promise<boolean> => {
    try {
      // 获取provider配置信息
      const { providerRepository } = await import('@/lib/provider/ProviderRepository');
      const providers = await providerRepository.getAll();
      const provider = providers.find(p => p.name === providerName);
      
      if (!provider) {
        console.warn(`Provider ${providerName} not found`);
        return false;
      }
      
      // 如果provider不需要密钥，直接返回true
      if (!provider.requiresKey) {
        return true;
      }
      
      // 如果provider需要密钥，检查是否有有效的API密钥
      const { KeyManager } = await import('@/lib/llm/KeyManager');
      
      // 先检查模型级别的API密钥
      const modelKey = await KeyManager.getModelKey(providerName, modelId);
      if (modelKey && modelKey.trim()) {
        return true;
      }
      
      // 再检查provider级别的API密钥
      const providerKey = await KeyManager.getProviderKey(providerName);
      if (providerKey && providerKey.trim()) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking API key validity:', error);
      return false;
    }
  }, []);

  // 优化的批量更新函数
  const batchUpdateMessage = useCallback((messageId: string, content: string, thinking_start_time: number) => {
    // 立即更新UI状态，保证响应性
    currentContentRef.current = content;
    pendingContentRef.current = content;
    
    // 增加token计数
    batchUpdateRef.current.tokenCount++;
    
    // 调试日志移除以减少控制台噪音
    
    // 判断是否需要更新数据库
    const shouldUpdate = 
      batchUpdateRef.current.tokenCount >= 10 || // 每10个token更新一次
      Date.now() - batchUpdateRef.current.lastUpdateTime >= 2000; // 或每2秒更新一次
    
    if (shouldUpdate && !batchUpdateRef.current.pendingUpdate) {
      batchUpdateRef.current.pendingUpdate = true;
      batchUpdateRef.current.lastUpdateTime = Date.now();
      
      // 异步更新数据库
      void updateMessage(messageId, {
        content: content,
        thinking_start_time: thinking_start_time,
      }).then(() => {
        lastSavedContentRef.current = content;
        batchUpdateRef.current.tokenCount = 0;
        batchUpdateRef.current.pendingUpdate = false;
      }).catch((_error) => {
        // 静默失败，避免打断流
        batchUpdateRef.current.pendingUpdate = false;
      });
    } else if (shouldUpdate && batchUpdateRef.current.pendingUpdate) {
      // 跳过：已有更新在进行中
    } else {
      // 跳过：未满足触发条件
    }
  }, [updateMessage]);

  // 已移除未使用的防抖函数，避免无意义的闭包与告警

  // 性能监控（目前由 performanceMonitor 统一处理，保留以供未来扩展）
  // const _performanceRef = useRef({
  //   tokenCount: 0,
  //   updateCount: 0,
  //   lastUpdateTime: Date.now()
  // });

  // 性能监控函数（目前新架构中由 performanceMonitor 统一处理）
  // const _logPerformance = useCallback(() => {
  //   const now = Date.now();
  //   const timeDiff = now - performanceRef.current.lastUpdateTime;
  //   if (timeDiff > 5000) {
  //     performanceRef.current = {
  //       tokenCount: 0,
  //       updateCount: 0,
  //       lastUpdateTime: now
  //     };
  //   }
  // }, []);

  /**
   * 构建发送给LLM的消息历史
   * 
   * @param conversationId 会话ID
   * @param messages 消息列表
   * @param userContent 用户当前输入的内容
   * @param provider Provider 名称（用于检测工具调用能力）
   * @param model 模型名称（用于检测工具调用能力）
   * @param options 可选参数
   * @returns 构建好的历史消息数组
   */
  const buildLlmHistory = useCallback(async (
    conversationId: string,
    messages: Message[],
    userContent: string,
    provider?: string,
    model?: string,
    options?: {
      images?: string[];
      contextData?: string;
      excludeMessagesAfterIndex?: number; // 用于重试时排除后续消息
    }
  ): Promise<LlmMessage[]> => {
    const hb = new HistoryBuilder();
    
    // 0. 注入当前时间（永远置顶），帮助模型理解“今天/最新/现在”等时间语义，并提升实时信息查询准确性
    try {
      const wsMod: any = await import('@/store/webSearchStore').catch(() => null);
      const webSearchEnabled = !!wsMod?.useWebSearchStore?.getState?.().isWebSearchEnabled;
      const { buildTimeContextMessage, isTimeRelatedQuery } = await import('@/lib/prompts/TimeContext');
      const includeInSearch = webSearchEnabled || isTimeRelatedQuery(userContent);
      const timeMsg = buildTimeContextMessage(includeInSearch);
      if (timeMsg && timeMsg.trim()) hb.addSystem(timeMsg);

    } catch { /* ignore */ }

    // Web search is a native tool in the unified Agent runtime.  Do not run a
    // hidden pre-search here: the model must decide whether current information
    // is needed and the result must remain part of the structured run history.
    
    // 1. 添加系统提示词
    try {
      const conv = useChatStore.getState().conversations.find((c: any) => c.id === conversationId);
      const applied = conv?.system_prompt_applied;
      if (applied?.promptId) {
        const prompt = usePromptStore.getState().prompts.find((p: any) => p.id === applied.promptId);
        if (prompt) {
          const rendered = renderPromptContent(prompt.content, applied.variableValues);
          if (rendered && rendered.trim()) hb.addSystem(rendered);
        }
      }


      // 2. 添加MCP系统注入（agent 模式由 AgentLoopRunner Envelope 单次注入）
      // MCP and Skills are assembled by AgentLoopRunner once per run.  Keeping
      // them out of this history builder prevents duplicate, stale injections.
    } catch { /* 忽略系统提示构建失败 */ }
    
    // 3. 处理历史消息
    if (messages && messages.length > 0) {
      // 如果指定了excludeMessagesAfterIndex，只取该索引之前的消息
      const messagesToUse = options?.excludeMessagesAfterIndex !== undefined
        ? messages.slice(0, options.excludeMessagesAfterIndex)
        : messages;
      
      // 对于有版本的消息，只使用每个版本组的最新版本
      const { getLatestVersionMessages } = await import('@/lib/chat/MessageVersionHelper');
      const latestVersionMessages = getLatestVersionMessages(messagesToUse);
      
      hb.addMany(latestVersionMessages
        .filter((msg: any) => msg.role === 'user' || msg.role === 'assistant')
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content || '',
          images: msg.images,
          contextData: msg.context_data
        })) as any);
    }
    
    // 4. 添加当前用户输入
    hb.addUser(userContent, options?.images, options?.contextData);
    
    return hb.take();
  }, []);

  const stopGenerationIdleWatch = useCallback(() => {
    idleWatchRef.current?.stop();
    idleWatchRef.current = null;
  }, []);

  const handleSendMessage = useCallback(async (
    content: string, 
    documentData?: { 
      documentReference: { 
        fileName: string; 
        fileType: string; 
        fileSize: number; 
        summary: string 
      }; 
      contextData: string 
      sourceContent?: string
    },
    knowledgeBase?: { id: string; name: string },
    options?: { conversation?: Conversation, conversationId?: string, images?: string[], planOnly?: boolean }
  ) => {
    // 运行中输入是当前任务的补充，而不是启动竞争的第二个循环。
    const steeringConversationId = options?.conversationId || currentConversationId;
    if (steeringConversationId) {
      const state = useChatStore.getState();
      const activeConversation = state.conversations.find((c) => c.id === steeringConversationId);
      const activeRunId = Object.entries(state.agentRuns || {})
        .find(([, run]) => run.running && run.conversationId === steeringConversationId)?.[0];
      const activeAssistant = activeRunId
        ? { id: activeRunId }
        : [...(activeConversation?.messages || [])]
          .reverse()
          .find((message: any) => message?.role === 'assistant' && message?.status === 'loading');
      const steeringContent = documentData?.contextData
        ? `${content.trim()}\n\n[补充资料]\n${documentData.contextData.slice(0, 12000)}`.trim()
        : content;
      if (activeAssistant?.id && options?.images?.length) {
        toast.info('当前步骤完成后再发送图片', { description: '图片会保留在输入框中。' });
        return;
      }
      if (activeAssistant?.id && await AgentLoopRunner.steer(activeAssistant.id, steeringContent)) {
        toast.info('补充已排队', { description: '当前步骤完成后交给模型处理。' });
        return;
      }
    }

    const modelToUse = selectedModelId;
    if (!modelToUse) {
      toast.error('请先选择一个AI模型', {
        description: '点击此处前往设置页面选择模型',
        action: {
          label: '前往设置',
          onClick: () => navigateToSettings('localModels')
        }
      });
      return;
    }
    
    if (!currentProviderName) {
      toast.error('模型提供商信息丢失', {
        description: '无法确定当前模型所属的提供商，请重新选择模型。',
      });
      return;
    }

    // —— 统一计算本次会话应当使用的 Provider ——
    let effectiveProvider = currentProviderName;
    try {
      const { specializedStorage } = await import('@/lib/storage');
      const lastPair = await specializedStorage.models.getLastSelectedModelPair();
      if (lastPair && lastPair.modelId === modelToUse && lastPair.provider) {
        effectiveProvider = lastPair.provider;
      }
    } catch { /* ignore, fallback to currentProviderName */ }

    const apiKeyValid = await checkApiKeyValidity(effectiveProvider, modelToUse);
    if (!apiKeyValid) {
      toast.error('API密钥无效', {
        description: '请前往设置页面配置有效的API密钥',
        action: {
          label: '前往设置',
          onClick: () => navigateToSettings('localModels')
        }
      });
      return;
    }

    // 重置流式更新状态（仅内部缓存）。tokenCount 在 onStart 开始流时再置零，避免提前清零影响可视化
    currentContentRef.current = '';
    pendingContentRef.current = '';
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    
    // 重置批量更新状态
    batchUpdateRef.current = {
      tokenCount: 0,
      lastUpdateTime: 0,
      pendingUpdate: false
    };

    let conversationId = options?.conversationId || currentConversationId;
    
    // const isCreatingNewConversation = !conversationId;
    if (!conversationId) {
      try {
        conversationId = await createConversation(`新对话 ${new Date().toLocaleTimeString()}`, modelToUse, effectiveProvider);
      } catch {
        toast.error('创建对话失败', { description: '无法创建新的对话，请重试。' });
        return;
      }
    }

    const finalConversationId = conversationId;
    
    if (currentConversation?.model_id !== modelToUse && finalConversationId) {
      void updateConversation(finalConversationId, { model_id: modelToUse });
    }

    void setLastUsedModelForChat(finalConversationId, modelToUse);

    const now = Date.now();
    const userMessageId = uuidv4();
    const newMessage: Message = {
      id: userMessageId,
      conversation_id: finalConversationId,
      role: 'user',
      content,
      created_at: now,
      updated_at: now,
      status: 'sent',
      model: modelToUse,
      document_reference: documentData?.documentReference,
      context_data: documentData?.contextData,
      knowledge_base_reference: knowledgeBase,
      images: options?.images
    };
    if (documentData?.sourceContent?.trim()) {
      try {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        const { sha256Hex } = await import('@/lib/utils/sha256');
        useConversationAttachmentStore.getState().setSessionDocument(finalConversationId, {
          id: `attachment_${finalConversationId}_${documentData.documentReference.fileName}`,
          name: documentData.documentReference.fileName,
          fileType: documentData.documentReference.fileType,
          fileSize: documentData.documentReference.fileSize,
          content: documentData.sourceContent,
          documentHash: await sha256Hex(documentData.sourceContent),
        });
      } catch {
        /* session attachment is best-effort; message context remains available */
      }
    }
    await addMessage(newMessage);

    // 标题生成改为在首次 AI 回复完成后触发，避免并发与限流压力。

    // 发送消息后立即滚动到底部
    if (scrollToBottomRef.current) {
      // 使用 setTimeout 确保 DOM 更新完成后再滚动
      setTimeout(() => {
        scrollToBottomRef.current?.();
      }, 0);
      
      // 额外确保滚动到底部，防止某些情况下滚动失败
      setTimeout(() => {
        scrollToBottomRef.current?.();
      }, 100);
    }

    const thinking_start_time = Date.now();
    const assistantMessageId = uuidv4();
    const assistantMessage: Message = {
      id: assistantMessageId,
      conversation_id: finalConversationId,
      role: 'assistant',
      content: '',
      created_at: now,
      updated_at: now,
      status: 'loading',
      model: modelToUse,
      thinking_start_time: thinking_start_time,
    };
    await addMessage(assistantMessage);

    // 尝试在 Provider 串起流之前，做一次“必需条件”的同步校验，例如 API Key
    try {
      const ok = await checkApiKeyValidity(effectiveProvider, modelToUse);
      if (!ok) {
        // 模拟 onError 早失败：删除AI占位与用户消息并回填
        void deleteMessage(assistantMessageId);
        void deleteMessage(userMessageId);
        try { if (finalConversationId) setInputDraft(finalConversationId, content); } catch { /* noop */ }
        toast.error('未配置 API 密钥', { description: '请在设置中配置有效的密钥后重试。' });
        return;
      }
    } catch { /* 若校验不可用则继续，让 Provider 触发 onError */ }

    if (finalConversationId) {
      try {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        if (knowledgeBase) {
          useConversationAttachmentStore.getState().setKnowledgeBase(finalConversationId, {
            id: knowledgeBase.id,
            name: knowledgeBase.name,
          });
        } else {
          useConversationAttachmentStore.getState().clearKnowledgeBase(finalConversationId);
        }
      } catch {
        /* noop */
      }
    }

    // 构建历史消息（含系统提示词 + MCP 上下文【混合模式】）
    const historyForLlm = await buildLlmHistory(
      finalConversationId,
      currentConversation?.messages || [],
      content,
      effectiveProvider,
      modelToUse,
      {
        images: options?.images,
        contextData: documentData?.contextData,
      }
    );

    // 调试信息已移除，避免控制台噪音

    let sendErrorNotified = false;

    if (modelToUse) {
      // 参数优先级：会话参数（可覆盖/可显式禁用） > 模型级参数 > 系统默认
      let baseOptions: Record<string, any> = {};

      try {
        // 1) 取模型级参数并转换为通用聊天选项
        const modelParams = await ModelParametersService.getModelParameters(effectiveProvider, modelToUse);
        const modelOpts = ModelParametersService.convertToChatOptions(modelParams);

        // 2) 取会话级参数（可能为空），转换为聊天选项
        let sessionOpts: Record<string, any> = {};
        if (sessionParameters) {
          sessionOpts = ModelParametersService.convertToChatOptions(sessionParameters);
        }

        // 3) 处理“显式禁用”的会话级开关：
        //    若用户在会话级将某项 enableX = false，则需要从继承的模型参数里删除对应项
        const filteredModelOpts: Record<string, any> = { ...modelOpts };
        const maybeDelete = (flag: boolean | undefined, key: string) => {
          if (flag === false && key in filteredModelOpts) delete filteredModelOpts[key];
        };
        if (sessionParameters) {
          const sp: any = sessionParameters;
          maybeDelete(sp.enableTemperature, 'temperature');
          maybeDelete(sp.enableMaxTokens, 'maxTokens');
          maybeDelete(sp.enableTopP, 'topP');
          maybeDelete(sp.enableTopK, 'topK');
          maybeDelete(sp.enableMinP, 'minP');
          maybeDelete(sp.enableFrequencyPenalty, 'frequencyPenalty');
          maybeDelete(sp.enablePresencePenalty, 'presencePenalty');
          // Stop 序列在 convertToChatOptions 中映射为 stop
          maybeDelete(sp.enableStopSequences, 'stop');
        }

        // 4) 合并，确保会话级覆盖模型级
        baseOptions = { ...filteredModelOpts, ...sessionOpts };

        const composed = await composeChatOptions(effectiveProvider, modelToUse, baseOptions, currentConversationId || null, content);

        try { notifyStreamStart(finalConversationId); } catch { /* noop */ }
        await AgentLoopRunner.run({
            assistantMessageId,
            conversationId: finalConversationId,
            provider: effectiveProvider,
            model: modelToUse,
            historyForLlm: historyForLlm as any,
            originalUserContent: content,
            options: composed,
            planOnly: options?.planOnly,
            runtimeHooks: {
              onAgentStart: () => {
                lastActivityTimeRef.current = Date.now();
                setTokenCount(0);
                batchUpdateRef.current = { tokenCount: 0, lastUpdateTime: 0, pendingUpdate: false };
              },
              onStreamError: () => {
                sendErrorNotified = true;
                stopGenerationIdleWatch();
              },
              onStreamEvent: (event: any) => {
                lastActivityTimeRef.current = Date.now();

                const t = String(event?.type || '');
                if (t === 'content_token' || t === 'thinking_token') {
                  batchUpdateRef.current.tokenCount += 1;
                  if (batchUpdateRef.current.tokenCount >= 10) {
                    const delta = batchUpdateRef.current.tokenCount;
                    batchUpdateRef.current.tokenCount = 0;
                    setTokenCount((prev) => prev + delta);
                  }
                }

                const perfId = `onEvent_agentloop_${event?.type}`;
                performanceMonitor.start(perfId, { type: event?.type, mode: 'agentloop', messageId: assistantMessageId });
                try {
                  // no-op：事件本体由 StreamOrchestrator 处理
                } finally {
                  performanceMonitor.end(perfId);
                }
              },
            },
        });
        return;

      } catch (err) {
        if (!sendErrorNotified) {
          showSendErrorToast(err, { providerName: effectiveProvider });
        }
        const msg = err instanceof Error ? err.message : String(err);
        void updateMessage(assistantMessageId, {
          status: 'error',
          content: `发送失败：${msg}`,
        });
        return;
      }
    } else {
       // 未选择模型
       void updateMessage(assistantMessageId, { status: 'error', content: "未选择模型", thinking_duration: 0 });
       toast.error('未选择模型', { description: "在发送消息前，请先在顶部选择一个AI模型。" });
    }
  }, [selectedModelId, currentProviderName, sessionParameters, currentConversationId, currentConversation, createConversation, updateConversation, setLastUsedModelForChat, addMessage, updateMessage, navigateToSettings, checkApiKeyValidity, batchUpdateMessage]);
  
  const handleEmptyStatePromptClick = useCallback(async (prompt: string) => {
    if (!selectedModelId) {
      toast.error('请先选择一个模型', {
        description: '点击此处前往设置页面选择模型',
        action: { label: '前往设置', onClick: () => navigateToSettings('localModels') }
      });
      return;
    }
    const apiKeyValid = await checkApiKeyValidity(currentProviderName, selectedModelId);
    if (!apiKeyValid) {
      toast.error('API密钥无效', {
        description: '请前往设置页面配置有效的API密钥',
        action: { label: '前往设置', onClick: () => navigateToSettings('localModels') }
      });
      return;
    }
    await handleSendMessage(prompt);
  }, [selectedModelId, currentProviderName, handleSendMessage, checkApiKeyValidity, navigateToSettings]);

  const handleStopGeneration = useCallback(() => {
    setStopGenerationHint('正在停止生成…');
    // 停止并尽量落盘当前内容，防止丢尾部
    autoSaverRef.current?.stop();
    void autoSaverRef.current?.flush().catch(() => {}).finally(() => {
      autoSaverRef.current = null;
    });

    stopGenerationIdleWatch();
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    if (debouncedTokenUpdateRef.current) clearTimeout(debouncedTokenUpdateRef.current);
    
    // 不清空 currentContentRef，保留已生成文本；也不重置 tokenCount，让用户看到该次统计
    
    // 更新当前消息状态为已停止
    if (currentConversation?.messages) {
      const lastAssistantMessage = currentConversation.messages
        .filter((msg: Message) => msg.role === 'assistant')
        .pop();
      
      if (lastAssistantMessage) {
        // 停止不仅要停 SSE，还要停止整个 agent loop（阻止后续 follow-up / tool 链路继续推进）
        try {
          ToolCallCoordinator.getInstance().cancelMessage(lastAssistantMessage.id);
        } catch {
          // ignore
        }
        try {
          AgentLoopRunner.cancel({ assistantMessageId: lastAssistantMessage.id });
        } catch {
          // ignore
        }
        try {
          useAuthorizationStore.getState().rejectAuthorizationsByMessageId(lastAssistantMessage.id);
        } catch {
          // ignore
        }

        // 需求：点击停止后，把该次 agent 运行中的卡片都置为“已停止”，并 best-effort 取消执行
        try {
          const st = useChatStore.getState();
          const conv = st.conversations.find((c) => c.id === currentConversationId);
          const msg: any = conv?.messages.find((m) => m.id === lastAssistantMessage.id);
          const rawSegs: any[] = Array.isArray(msg?.segments) ? msg.segments : [];
          const vmItems: any[] = Array.isArray(msg?.segments_vm?.items) ? msg.segments_vm.items : [];
          const segs = rawSegs.length > 0 ? rawSegs : vmItems;

          const coord = ToolCallCoordinator.getInstance();
          const sandbox = getProcessSandbox();

          for (const s of segs) {
            if (!s || s.kind !== 'toolCard' || !s.id) continue;
            if (s.status !== 'running' && s.status !== 'pending_auth') continue;
            const cid = String(s.id);
            coord.cancelToolCard(lastAssistantMessage.id, cid);

            // 如果是 shell_executor，尝试取消后端执行
            if (String(s.server || '').toLowerCase() === 'shell_executor') {
              try {
                const executionId = `shell:${lastAssistantMessage.id}:${cid}`;
                void sandbox.cancel(executionId);
              } catch {
                // ignore
              }
            }

            try {
              st.dispatchMessageAction(lastAssistantMessage.id, {
                type: 'TOOL_RESULT',
                server: String(s.server),
                tool: String(s.tool),
                ok: false,
                errorMessage: 'stopped',
                cardId: cid,
              } as any);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }

        const thinking_duration = lastAssistantMessage.thinking_start_time
          ? Math.floor((Date.now() - lastAssistantMessage.thinking_start_time) / 1000)
          : 0;

        // 若用户主动停止且思考栏仍在计时，手动发出 THINK_END 以终止计时显示
        try {
          const st = useChatStore.getState();
          const conv = st.conversations.find(c => c.id === currentConversationId);
          const msg: any = conv?.messages.find(m => m.id === lastAssistantMessage.id);
          const segs = Array.isArray(msg?.segments) ? msg.segments : [];
          const stillThinking = segs.length && segs[segs.length - 1]?.kind === 'think';
          if (stillThinking) {
            st.dispatchMessageAction(lastAssistantMessage.id, { type: 'THINK_END' } as any);
          }
        } catch { /* noop */ }

        void updateMessage(lastAssistantMessage.id, {
          status: 'error',
          content: lastAssistantMessage.content + '\n\n[用户停止了生成]',
          thinking_duration: thinking_duration,
        });
      }
    }
  }, [currentConversation, updateMessage, currentConversationId]);

  useEffect(() => {
    if (!isLoading) {
      setStopGenerationHint((prev) => {
        if (prev === '正在停止生成…') return null;
        return prev;
      });
    }
  }, [isLoading]);

  // 清理函数
  useEffect(() => {
    return () => {
      idleWatchRef.current?.stop();
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      if (debouncedTokenUpdateRef.current) clearTimeout(debouncedTokenUpdateRef.current);
    };
  }, []);

  // 统一空闲超时：isGenerating 期间由 IdleWatch 监控；工具 running 时不误杀
  useEffect(() => {
    if (!isGenerating) {
      setIsStale(false);
      stopGenerationIdleWatch();
      return;
    }

    setIsStale(false);
    lastActivityTimeRef.current = Date.now();

    const st = useChatStore.getState();
    const cid = st.currentConversationId;
    if (!cid) return;

    stopGenerationIdleWatch();
    idleWatchRef.current = startIdleGenerationWatch({
      conversationId: cid,
      getLastActivityMs: () => lastActivityTimeRef.current,
      onIdle: () => {
        setIsStale(true);
        handleStopGeneration();
        const currentState = useChatStore.getState();
        const current = currentState.conversations.find((c) => c.id === currentState.currentConversationId);
        const loadingMessage = current?.messages?.find((m) => m.status === 'loading');
        if (loadingMessage) {
          const content = currentContentRef.current || '';
          void currentState.finalizeStreamedMessage(
            loadingMessage.id,
            'aborted',
            content,
            loadingMessage.model,
          ).catch(() => {});
          void updateMessage(loadingMessage.id, {
            status: 'error',
            content: content.trim() || '响应超时',
          });
        }
        toast.error('响应超时', { description: '模型长时间未返回数据，请检查网络或模型服务状态。' });
        stopGenerationIdleWatch();
      },
    });

    return () => {
      stopGenerationIdleWatch();
    };
  }, [isGenerating, handleStopGeneration, updateMessage, stopGenerationIdleWatch]);

  const handleTitleChange = useCallback((newTitle: string) => {
    if (currentConversationId && newTitle && newTitle.trim() !== '') {
      void renameConversation(currentConversationId, newTitle);
    }
  }, [currentConversationId, renameConversation]);
  
  const handleDeleteConversation = useCallback(() => {
    if (currentConversationId) {
      void deleteConversation(currentConversationId);
    }
  }, [currentConversationId, deleteConversation]);

  const handleRetryMessage = useCallback(async (messageIdToRetry: string) => {
    const st = useChatStore.getState();
    const conv = currentConversationId ? st.conversations.find(c => c.id === currentConversationId) : null;
    if (!conv) return;
    const idx = conv.messages.findIndex(m => m.id === messageIdToRetry);
    if (idx < 0) return;
    const target = conv.messages[idx];
    if (target.role !== 'assistant') return;
    const continueStoppedRun = target.status === 'aborted' || String(target.content || '').includes('[用户停止了生成]');
    // 找前一个 user
    let userIdx = idx - 1;
    while (userIdx >= 0 && conv.messages[userIdx].role !== 'user') userIdx--;
    if (userIdx < 0) return;
    const userMsg = conv.messages[userIdx];

    // 版本组信息：如果是第一次重试，建立版本组；否则使用已有版本组
    const groupId = target.version_group_id || userMsg.id;
    
    // 如果原消息还没有版本组ID，先给它设置上（作为版本0）
    if (!target.version_group_id) {
      await updateMessage(target.id, {
        version_group_id: groupId,
        version_index: 0,
      });
    }
    
    const siblings = conv.messages.filter(m => m.role==='assistant' && m.version_group_id === groupId);
    const nextIndex = (siblings.length > 0 ? Math.max(...siblings.map(s => s.version_index || 0)) + 1 : 1);

    // 创建新版本消息（不是插入到列表后面，而是与原消息关联为同一组）
    const newAssistantId = uuidv4();
    const newVersionMsg: Message = {
      id: newAssistantId,
      conversation_id: conv.id,
      role: 'assistant',
      content: '',
      created_at: Date.now(),
      updated_at: Date.now(),
      status: 'loading',
      model: conv.model_id,
      version_group_id: groupId,
      version_index: nextIndex,
    } as any;
    
    // 直接添加到消息列表中（会被分组逻辑处理）
    await st.addMessage(newVersionMsg);

    // 选择 provider/model 与参数（提前获取，供 buildLlmHistory 使用）
    const modelToUse = conv.model_id;
    let effectiveProvider = currentProviderName;
    try {
      const { specializedStorage } = await import('@/lib/storage');
      const lastPair = await specializedStorage.models.getLastSelectedModelPair();
      if (lastPair && lastPair.modelId === modelToUse && lastPair.provider) {
        effectiveProvider = lastPair.provider;
      }
    } catch { /* noop */ }

    // 构建历史（不包含当前被重试的 assistant 内容）
    // 使用统一的 buildLlmHistory 函数，传入 userIdx 作为截止索引
    const historyForLlm = await buildLlmHistory(
      conv.id,
      conv.messages,
      userMsg.content,
      effectiveProvider,
      modelToUse,
      {
        images: userMsg.images,
        contextData: userMsg.context_data,
        excludeMessagesAfterIndex: userIdx, // 只取到 user 消息为止，不包含后续的 assistant 消息
      }
    );


    const apiKeyValid = await checkApiKeyValidity(effectiveProvider, modelToUse);
    if (!apiKeyValid) {
      toast.error('API密钥无效', { description: '请前往设置页面配置有效的API密钥' });
      // 占位转错误
      void updateMessage(newAssistantId, { status: 'error', content: '未配置 API 密钥' });
      return;
    }

    try {
      const modelParams = await ModelParametersService.getModelParameters(effectiveProvider, modelToUse);
      const modelOpts = ModelParametersService.convertToChatOptions(modelParams);
      let sessionOpts: Record<string, any> = {};
      if (sessionParameters) {
        sessionOpts = ModelParametersService.convertToChatOptions(sessionParameters);
      }
      const filteredModelOpts: Record<string, any> = { ...modelOpts };
      const maybeDelete = (flag: boolean | undefined, key: string) => {
        if (flag === false && key in filteredModelOpts) delete filteredModelOpts[key];
      };
      if (sessionParameters) {
        const sp: any = sessionParameters;
        maybeDelete(sp.enableTemperature, 'temperature');
        maybeDelete(sp.enableMaxTokens, 'maxTokens');
        maybeDelete(sp.enableTopP, 'topP');
        maybeDelete(sp.enableTopK, 'topK');
        maybeDelete(sp.enableMinP, 'minP');
        maybeDelete(sp.enableFrequencyPenalty, 'frequencyPenalty');
        maybeDelete(sp.enablePresencePenalty, 'presencePenalty');
        maybeDelete(sp.enableStopSequences, 'stop');
      }
      const composed = await composeChatOptions(
        effectiveProvider,
        modelToUse,
        { ...filteredModelOpts, ...sessionOpts },
        conv.id,
        userMsg.content,
      );
      try { notifyStreamStart(conv.id); } catch { /* noop */ }
      await AgentLoopRunner.run({
        assistantMessageId: newAssistantId,
        conversationId: conv.id,
        provider: effectiveProvider,
        model: modelToUse,
        historyForLlm: historyForLlm as any,
        originalUserContent: userMsg.content,
        continuationRunId: continueStoppedRun ? target.id : undefined,
        continuationPrompt: continueStoppedRun ? '继续完成尚未完成的任务。不要重复已经完成的操作。' : undefined,
        // Regenerating revises the answer from the existing record.  It must
        // never silently repeat a prior write, shell command, or MCP action.
        regenerate: !continueStoppedRun,
        options: composed,
        runtimeHooks: {
          onAgentStart: () => {
            lastActivityTimeRef.current = Date.now();
            setTokenCount(0);
            batchUpdateRef.current = { tokenCount: 0, lastUpdateTime: 0, pendingUpdate: false };
          },
          onStreamError: () => {
            stopGenerationIdleWatch();
          },
          onStreamEvent: (event: any) => {
            lastActivityTimeRef.current = Date.now();
            const t = String(event?.type || '');
            if (t === 'content_token' || t === 'thinking_token') {
              batchUpdateRef.current.tokenCount += 1;
              if (batchUpdateRef.current.tokenCount >= 10) {
                const delta = batchUpdateRef.current.tokenCount;
                batchUpdateRef.current.tokenCount = 0;
                setTokenCount((prev) => prev + delta);
              }
            }
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '重试失败';
      void updateMessage(newAssistantId, { status: 'error', content: message });
    }
  }, [
    currentConversationId,
    currentConversation,
    currentProviderName,
    sessionParameters,
    notifyStreamStart,
    stopGenerationIdleWatch,
    checkApiKeyValidity,
    updateMessage,
  ]);

  // Placeholder handler for share（仍待实现）
  const handleShare = useCallback(() => {}, []);

  const handleDownload = useCallback(async () => {
    await exportConversationMarkdown(currentConversation ?? null, currentConversationId ?? null);
  }, [currentConversationId, currentConversation]);
  const handleImageUpload = useCallback((_file: File) => {}, []);
  const handleFileUpload = useCallback((_file: File) => {}, []);

  return {
    isLoading,
    isGenerating,
    handleSendMessage,
    handleStopGeneration,
    handleEmptyStatePromptClick,
    stopGenerationHint,
    handleTitleChange,
    handleDeleteConversation,
    handleRetryMessage,
    handleShare,
    handleDownload,
    handleImageUpload,
    handleFileUpload,
    tokenCount,
    setScrollToBottomCallback,
  };
};

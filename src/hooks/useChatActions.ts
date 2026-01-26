// 调试期间保留有限 console，勿全局禁用 no-console
// NOTE: 由于在聊天流程中集成 RAG 流式逻辑，临时超出 500 行限制。
// 后续可提取为专用 Hook 或工具文件以符合文件规模规范。
import { useCallback, useState, useRef, useEffect } from 'react';
import { toast } from '@/components/ui/sonner';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useChatStore } from "@/store/chatStore";
import { cancelStream, type Message as LlmMessage, StreamCallbacks } from '@/lib/llm';
import { ChatGateway } from '@/lib/chat/ChatGateway';
import { HistoryBuilder } from '@/lib/chat/HistoryBuilder';
import type { Message, Conversation } from "@/types/chat";
import { exportConversationMarkdown } from '@/lib/chat/actions/download';
// import { retryAssistantMessage } from '@/lib/chat/actions/retry';
import { runRagFlow } from '@/lib/chat/actions/ragFlow';
import { MessageAutoSaver } from '@/lib/chat/MessageAutoSaver';
import { ModelParametersService } from '@/lib/model-parameters';
import { composeChatOptions } from '@/lib/chat/OptionComposer';
import { usePromptStore } from '@/store/promptStore';
import { renderPromptContent } from '@/lib/prompt/render';
import { performanceMonitor } from '@/lib/performance/PerformanceMonitor';
import { StreamOrchestrator } from '@/lib/chat/stream';
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
  const updateMessageContentInMemory = useChatStore((state) => state.updateMessageContentInMemory);
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

  const [generationTimeout, setGenerationTimeout] = useState<NodeJS.Timeout | null>(null);
  const lastActivityTimeRef = useRef<number>(Date.now());
  const [isStale, setIsStale] = useState(false);
  
  const isLoading = isGenerating && !isStale;

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
  
  // 全局计时器引用（未使用，移除以减噪）
  const genTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaverRef = useRef<MessageAutoSaver | null>(null);
  
  // 添加内容变化检测变量
  const lastSavedContentRef = useRef('');
  
  // 防抖状态引用移除，保持最小必要状态
  const debouncedTokenUpdateRef = useRef<NodeJS.Timeout | null>(null);

  const navigateToSettings = useCallback((tab: string = 'localModels') => {
    router.push(`/settings?tab=${tab}`);
  }, [router]);

  // 将错误信息压缩为短文本，避免右下角提示过长
  // 注意：目前新架构中 onError 由 StreamOrchestrator 统一处理，此函数暂时保留供重试等场景使用
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
   * @param options 可选参数
   * @returns 构建好的历史消息数组
   */
  const buildLlmHistory = useCallback(async (
    conversationId: string,
    messages: Message[],
    userContent: string,
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
      
      // 2. 添加MCP系统注入
      try {
        const { buildMcpSystemInjections } = await import('@/lib/mcp/promptInjector');
        const injection = await buildMcpSystemInjections(userContent, conversationId);
        for (const m of injection.systemMessages) {
          const c = String((m as any).content || '');
          // 避免重复注入时间（因为我们已经在顶部注入了）
          if (c.startsWith('【当前时间】') || c.startsWith('当前时间：')) continue;
          hb.addSystem(c);
        }
      } catch { /* 忽略MCP注入失败 */ }
    } catch { /* 忽略系统提示构建失败 */ }
    
    // 3. 处理历史消息
    if (messages && messages.length > 0) {
      // 如果指定了excludeMessagesAfterIndex，只取该索引之前的消息
      const messagesToUse = options?.excludeMessagesAfterIndex !== undefined
        ? messages.slice(0, options.excludeMessagesAfterIndex)
        : messages.slice(-10); // 默认只取最近10条
      
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
    },
    knowledgeBase?: { id: string; name: string },
    options?: { conversation?: Conversation, conversationId?: string, images?: string[] }
  ) => {
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
    // 为本次生成定义一个“流实例ID”，并在回调中校验，避免并发/二次流导致的串写
    const streamInstanceId = uuidv4();
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

    // 如果选择了知识库，则优先走 RAG 流程
    if (knowledgeBase) {
      const handled = await runRagFlow({
        query: content,
        knowledgeBaseId: knowledgeBase.id,
        assistantMessageId,
        thinkingStartTime: thinking_start_time,
        conversationId: finalConversationId,
        currentContentRef,
        updateMessage,
        updateMessageContentInMemory,
        setTokenCount,
        modelId: modelToUse,
        provider: effectiveProvider,
        apiKey: undefined, // API密钥会从设置中自动获取
      });
      if (handled) return;
    }

    // 构建历史消息（含系统提示词 + MCP 上下文【混合模式】）
    const historyForLlm = await buildLlmHistory(
      finalConversationId,
      currentConversation?.messages || [],
      content,
      {
        images: options?.images,
        contextData: documentData?.contextData,
      }
    );

    // 调试信息已移除，避免控制台噪音

    // 构建一个按秒保存的自动保存器（在 onStart 时初始化）

    // 使用新的 StreamOrchestrator 架构
    const orchestrator = new StreamOrchestrator({
      messageId: assistantMessageId,
      conversationId: finalConversationId,
      provider: effectiveProvider,
      model: modelToUse,
      originalUserContent: content,
      historyForLlm: historyForLlm as any,
      onUIUpdate: (_updatedContent) => {
        // UI 更新回调（可选）
        // MessageAutoSaver 在 onStart 中初始化，这里暂不处理
      },
      onError: (error) => {
        console.error('[StreamOrchestrator] 错误:', error);
        toast.error('流式处理错误', { description: error.message });
      },
    });
    
    const streamCallbacks = orchestrator.createCallbacks();
    
    // 包装 onStart 以保留现有逻辑
    const originalOnStart = streamCallbacks.onStart;
    streamCallbacks.onStart = () => {
      originalOnStart?.();
      
      // 通知 UI
      try { notifyStreamStart(finalConversationId); } catch { /* noop */ }
      
      // 自动保存器
      autoSaverRef.current = new MessageAutoSaver(async (latest) => {
        await updateMessage(assistantMessageId, {
          content: latest,
          thinking_start_time: thinking_start_time,
        });
      }, 1000);
      
      // 超时监控
      if (genTimeoutRef.current) clearTimeout(genTimeoutRef.current);
      genTimeoutRef.current = setInterval(() => {
        if (Date.now() - lastActivityTimeRef.current > 120000) {
          handleStopGeneration();
          void updateMessage(assistantMessageId, { 
            status: 'error', 
            content: '响应超时', 
            thinking_duration: Math.floor((Date.now() - thinking_start_time) / 1000) 
          });
          toast.error('响应超时', { description: '模型长时间未返回数据，请检查网络或模型服务状态。' });
          if (genTimeoutRef.current) clearInterval(genTimeoutRef.current);
        }
      }, 5000);
      setGenerationTimeout(genTimeoutRef.current);
      
      // Token 计数重置
      setTokenCount(0);
      batchUpdateRef.current = { tokenCount: 0, lastUpdateTime: 0, pendingUpdate: false };
    };
    
    // 包装 onEvent 以保留性能监控
    const originalOnEvent = streamCallbacks.onEvent;
    streamCallbacks.onEvent = (event: any) => {
      if ((streamCallbacks as any).__instanceId !== streamInstanceId) return;
      lastActivityTimeRef.current = Date.now();
      
      // 简化的性能监控
      const perfId = `onEvent_${event?.type}`;
      performanceMonitor.start(perfId, { type: event?.type, messageId: assistantMessageId });
      try {
        originalOnEvent?.(event);
      } finally {
        performanceMonitor.end(perfId);
      }
    };
    
    // 包装 onComplete
    const originalOnComplete = streamCallbacks.onComplete;
    streamCallbacks.onComplete = async () => {
      try {
        await originalOnComplete?.();
      } finally {
        // 清理
        autoSaverRef.current?.flush();
        if (genTimeoutRef.current) {
          clearInterval(genTimeoutRef.current);
          setGenerationTimeout(null);
        }
        // isGenerating 由 store 管理，无需手动设置
      }
    };
    
    // 包装 onError
    const originalOnError = streamCallbacks.onError;
    streamCallbacks.onError = (error: Error) => {
      originalOnError?.(error);
      autoSaverRef.current?.flush();
      if (genTimeoutRef.current) {
        clearInterval(genTimeoutRef.current);
        setGenerationTimeout(null);
      }
      // isGenerating 由 store 管理，无需手动设置
    };

    // 标记当前回调归属的流实例
    (streamCallbacks as any).__instanceId = streamInstanceId;

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
        const gateway = new ChatGateway({ provider: effectiveProvider, model: modelToUse, options: composed });
        await gateway.stream(historyForLlm, streamCallbacks);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void updateMessage(assistantMessageId, {
          status: 'error',
          content: `发送失败：${msg}`,
        });
        toast.error('发送失败', {
          description: msg,
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
    try {
      cancelStream();
    } catch {
      // 取消流失败，忽略
    }
    
    // 停止并尽量落盘当前内容，防止丢尾部
    autoSaverRef.current?.stop();
    void autoSaverRef.current?.flush().catch(() => {}).finally(() => {
      autoSaverRef.current = null;
    });

    // 清理所有定时器
    if (genTimeoutRef.current) clearInterval(genTimeoutRef.current);
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    if (debouncedTokenUpdateRef.current) clearTimeout(debouncedTokenUpdateRef.current);
    setGenerationTimeout(null);
    
    // 不清空 currentContentRef，保留已生成文本；也不重置 tokenCount，让用户看到该次统计
    
    // 更新当前消息状态为已停止
    if (currentConversation?.messages) {
      const lastAssistantMessage = currentConversation.messages
        .filter((msg: Message) => msg.role === 'assistant')
        .pop();
      
      if (lastAssistantMessage && lastAssistantMessage.status === 'loading') {
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
  }, [currentConversation, updateMessage]);

  // 清理函数
  useEffect(() => {
    return () => {
      if (genTimeoutRef.current) clearInterval(genTimeoutRef.current);
      if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
      if (debouncedTokenUpdateRef.current) clearTimeout(debouncedTokenUpdateRef.current);
    };
  }, []);

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

    // 构建历史（不包含当前被重试的 assistant 内容）
    // 使用统一的 buildLlmHistory 函数，传入 userIdx 作为截止索引
    const historyForLlm = await buildLlmHistory(
      conv.id,
      conv.messages,
      userMsg.content,
      {
        images: userMsg.images,
        contextData: userMsg.context_data,
        excludeMessagesAfterIndex: userIdx, // 只取到 user 消息为止，不包含后续的 assistant 消息
      }
    );


    // 重新生成时增加轻微扰动，降低“逐字复读”的概率（不影响工具调用链路）
    try {
      (historyForLlm as any).unshift({
        role: 'system',
        content: `【重试生成】这是同一问题的重新生成版本。请避免复用上一版本的句子组织方式与措辞；如果内容相同也要换一种表达方式。\nnonce=${Date.now()}`,
      });
    } catch { /* noop */ }

    // 选择 provider/model 与参数
    const modelToUse = conv.model_id;
    let effectiveProvider = currentProviderName;
    try {
      const { specializedStorage } = await import('@/lib/storage');
      const lastPair = await specializedStorage.models.getLastSelectedModelPair();
      if (lastPair && lastPair.modelId === modelToUse && lastPair.provider) {
        effectiveProvider = lastPair.provider;
      }
    } catch { /* noop */ }

    const apiKeyValid = await checkApiKeyValidity(effectiveProvider, modelToUse);
    if (!apiKeyValid) {
      toast.error('API密钥无效', { description: '请前往设置页面配置有效的API密钥' });
      // 占位转错误
      void updateMessage(newAssistantId, { status: 'error', content: '未配置 API 密钥' });
      return;
    }

    // —— 使用新架构：StreamOrchestrator（带早期抑制阀与GPT‑OSS工具指令识别） ——
    const thinking_start_time = Date.now();
    const streamInstanceId = uuidv4();
    const orchestrator = new StreamOrchestrator({
      messageId: newAssistantId,
      conversationId: conv.id,
      provider: effectiveProvider,
      model: modelToUse,
      originalUserContent: userMsg.content,
      historyForLlm: historyForLlm as any,
      onUIUpdate: () => {},
      onError: (error) => {
        autoSaverRef.current?.flush();
        toast.error('流式处理错误', { description: error.message });
      },
    });
    const streamCallbacks: StreamCallbacks = orchestrator.createCallbacks();
    const originalOnStart = streamCallbacks.onStart;
    streamCallbacks.onStart = () => {
      originalOnStart?.();
      // 重置引用与自动保存
      currentContentRef.current = '';
      pendingContentRef.current = '';
      autoSaverRef.current = new MessageAutoSaver(async (latest) => {
        await updateMessage(newAssistantId, {
          content: latest,
          thinking_start_time,
        });
      }, 1000);
      setTokenCount(0);
      batchUpdateRef.current = { tokenCount: 0, lastUpdateTime: 0, pendingUpdate: false };
    };
    const originalOnEvent = streamCallbacks.onEvent;
    streamCallbacks.onEvent = (event: any) => {
      if ((streamCallbacks as any).__instanceId !== streamInstanceId) return;
      lastActivityTimeRef.current = Date.now();
      const perfId = `onEvent_retry_${event?.type}`;
      performanceMonitor.start(perfId, { type: event?.type, mode: 'orchestrator-retry', messageId: newAssistantId });
      try {
        originalOnEvent?.(event);
      } finally {
        performanceMonitor.end(perfId);
      }
    };
    const originalOnComplete = streamCallbacks.onComplete;
    streamCallbacks.onComplete = async () => {
      try {
        await originalOnComplete?.();
      } finally {
        autoSaverRef.current?.flush();
        setTokenCount(0);
        autoSaverRef.current = null;
      }
    };
    const originalOnError = streamCallbacks.onError;
    streamCallbacks.onError = (error: Error) => {
      originalOnError?.(error);
      autoSaverRef.current?.flush();
      setTokenCount(0);
      autoSaverRef.current = null;
    };
    (streamCallbacks as any).__instanceId = streamInstanceId;

    try {
      const modelParams = await ModelParametersService.getModelParameters(effectiveProvider, modelToUse);
      const modelOpts = ModelParametersService.convertToChatOptions(modelParams);
      const composed = await composeChatOptions(effectiveProvider, modelToUse, modelOpts, currentConversationId || null, userMsg.content);
      const gateway = new ChatGateway({ provider: effectiveProvider, model: modelToUse, options: composed });
      await gateway.stream(historyForLlm as any, streamCallbacks);
    } catch {
      try {
        const composed = await composeChatOptions(effectiveProvider, modelToUse, {}, currentConversationId || null, userMsg.content);
        const gateway = new ChatGateway({ provider: effectiveProvider, model: modelToUse, options: composed });
        await gateway.stream(historyForLlm as any, streamCallbacks);
      } catch (err) {
        void updateMessage(newAssistantId, { status: 'error', content: (err instanceof Error ? err.message : '重试失败') });
      }
    }
  }, [currentConversationId, currentConversation, currentProviderName, checkApiKeyValidity, updateMessage, updateMessageContentInMemory]);

  useEffect(() => {
    if (isGenerating) {
      setIsStale(false);
      lastActivityTimeRef.current = Date.now();
      
      if (generationTimeout) clearTimeout(generationTimeout);
      
      const timeout = setTimeout(() => {
        if (Date.now() - lastActivityTimeRef.current > 120000) {
          setIsStale(true);
          const currentState = useChatStore.getState();
          const current = currentState.conversations.find(c => c.id === currentState.currentConversationId);
          const loadingMessage = current?.messages?.find(m => m.status === 'loading');
          
          if (loadingMessage) {
            const content = currentContentRef.current || '';
            currentState.finalizeStreamedMessage(loadingMessage.id, 'aborted', content, loadingMessage.model)
              .catch(() => {});
          }
        }
      }, 120000);
      setGenerationTimeout(timeout);
    } else {
      if (generationTimeout) {
        clearTimeout(generationTimeout);
        setGenerationTimeout(null);
      }
      setIsStale(false);
    }
    
    return () => {
      if (generationTimeout) clearTimeout(generationTimeout);
    };
  }, [isGenerating]);

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

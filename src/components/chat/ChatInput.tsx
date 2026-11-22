"use client";

import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import {
  commitHistory,
  composerHistory,
  historyShortcut,
  redoHistory,
  undoHistory,
} from "./composerHistory";
import { composerFloor, nextInputHeight } from "./inputHeight";
import { Bookmark, FolderOpen, ListChecks, Paperclip, Send, StopCircle } from "lucide-react";
import { KnowledgeService, KnowledgeBase } from '@/lib/knowledgeService';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
// 输入框上方“长条附加项”已移除：保留输入框下方彩色标签条即可
import { McpMentionPanel } from './input/McpMentionPanel';
import { SkillMentionPanel } from './input/SkillMentionPanel';
import { AttachmentMenu } from './input/AttachmentMenu';
import { AndroidDocumentAttachmentStatus, useAndroidDocumentAttachment } from './input/AndroidDocumentAttachment';
import { useAndroidChatNavigation } from './androidChatNavigation';
import { AndroidPhotoPreview } from './input/AndroidPhotoPreview';
import { useAndroidPhotoDraft } from './input/useAndroidPhotoDraft';
import { AndroidAttachmentChips } from './input/AndroidAttachmentChips';
import { useAndroidAttachmentSelections } from './input/androidAttachmentSelection';
import { type AndroidPhotoSendCallbacks, type AndroidPhotoSendOptions, shouldClearPhotoDraft } from '@/lib/android/androidPhotoSend';
import type { AndroidPhotoDraftHandoff } from '@/lib/android/androidPhotoDraftHandoff';
import { findComposerQuery, insertComposerTrigger, replaceComposerQuery, type ComposerTrigger } from './input/composerTriggers';
import { useConversationAttachmentStore } from '@/store/conversationAttachmentStore';
import { useLocaleStore } from '@/store/localeStore';
import { ActiveCapabilitiesBar } from './input/ActiveCapabilitiesBar';
import { WebSearchToggle } from './input/WebSearchToggle';
import { McpQuickToggle } from './input/McpQuickToggle';
import type { Skill } from '@/lib/skills/types';
import type { ModelParameters } from '@/types/model-params';
import { createSafePreview } from '@/lib/utils/tokenBudget';
import { getCurrentKnowledgeBaseConfig } from '@/lib/knowledgeBaseConfig';
import { SlashPromptPanel } from './SlashPromptPanel';
import { usePromptStore } from '@/store/promptStore';
import { useChatStore } from '@/store/chatStore';
import { afterStartupPaint, startupMonitor } from '@/lib/utils/startupPerformanceMonitor';
import { renderPromptContent } from '@/lib/prompt/render';
import { mcpPreheater } from '@/lib/mcp/mcpPreheater';
import { useUiSession } from '@/store/uiSession';
import { useRouter, useSearchParams } from 'next/navigation';
import { useKnowledgeBaseSelection } from '@/hooks/useKnowledgeBaseSelection';
import { detectTauriEnvironment } from "@/lib/utils/environment";
import { getProcessSandbox } from "@/lib/skills/sandbox";
import {
  hasInlineReferences,
  renderInlineReferencesForOverlay,
} from './input/inlineReferenceHighlight';
import {
} from "@/lib/mcp/chatIntegration";

interface EditingMessageData {
  content: string;
  documentReference?: {
    fileName: string;
    fileType: string;
    fileSize: number;
    summary: string;
  };
  contextData?: string;
  knowledgeBaseReference?: {
    id: string;
    name: string;
  };
}

interface ChatInputProps {
  onSendMessage: (
    content: string,
    documentData?: {
      documentReference: {
        fileName: string;
        fileType: string;
        fileSize: number;
        summary: string;
      };
      contextData: string;
      sourceContent?: string;
      sourceBytes?: Uint8Array;
    },
    knowledgeBase?: {
      id: string;
      name: string;
    },
    options?: Partial<AndroidPhotoSendOptions> & AndroidPhotoSendCallbacks & { planOnly?: boolean }
  ) => void | Promise<void>;
  androidPhotoHandoff?: AndroidPhotoDraftHandoff;
  onImageUpload?: (file: File) => void;
  onFileUpload?: (file: File) => void;
  isLoading?: boolean;
  tokenCount?: number;
  disabled?: boolean;
  onStopGeneration?: () => void;
  /** 停止按钮旁的提示文案（如二次确认强制中止） */
  stopGenerationHint?: string | null;
  onBeforeSendMessage?: () => Promise<boolean>;
  selectedKnowledgeBaseId?: string; // 来自URL参数或父组件的知识库ID
  editingMessage?: EditingMessageData | null;
  onCancelEdit?: () => void;
  // 会话参数相关
  providerName?: string;
  modelId?: string;
  modelLabel?: string;
  conversationId?: string; // 添加会话ID参数
  showStarterActions?: boolean;
  onSessionParametersChange?: (parameters: ModelParameters) => void;
}

export function ChatInput({
  onSendMessage,
  onImageUpload: _onImageUpload,
  onFileUpload,
  isLoading = false,
  disabled = false,
  onStopGeneration,
  stopGenerationHint,
  onBeforeSendMessage,
  selectedKnowledgeBaseId,
  tokenCount = 0,
  editingMessage = null,
  onCancelEdit,
  providerName,
  modelId,
  modelLabel: _modelLabel,
  onSessionParametersChange: _onSessionParametersChange,
  conversationId,
  showStarterActions = false,
  androidPhotoHandoff,
}: ChatInputProps) {
  const android = Boolean(useAndroidChatNavigation());
  const androidDocument = useAndroidDocumentAttachment(android ? conversationId : undefined);
  const [inputValue, setInputValue] = useState("");
  const [composerSelection, setComposerSelection] = useState<{ text: string; caret: number } | null>(null);
  // 直接应用提示词，无需弹窗
  const inlineVarsRef = useRef<Record<string,string>>({});
  const [isParsingDocument, setIsParsingDocument] = useState(false);
  const [attachedDocument, setAttachedDocument] = useState<{
    name: string;
    content: string;
    fullContent: string;
    summary: string;
    fileSize: number;
    bytes: Uint8Array;
  } | null>(null);

  // 知识库选择相关状态
  const [allKnowledgeBases, setAllKnowledgeBases] = useState<KnowledgeBase[]>([]);

  // 加载知识库列表
  useEffect(() => {
    (async () => {
      try {
        await KnowledgeService.initDb();
        const kbs = await KnowledgeService.getAllKnowledgeBases();
        setAllKnowledgeBases(kbs);
      } catch {
        // ignore
      }
    })();
  }, []);

  // 知识库选项（用于上拉选择）
  const knowledgeBaseOptions = useMemo(() =>
    allKnowledgeBases.map(kb => ({ id: kb.id, label: kb.name })),
    [allKnowledgeBases]
  );

  // 会话参数设置弹窗：已迁移到右上角三点菜单统一入口（避免占用输入区空间）

  const _router = useRouter();
  const t = useLocaleStore((state) => state.t);
  useLocaleStore((state) => state.locale);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const searchParams = useSearchParams();
  const consumeKnowledgeBaseDeepLink = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('knowledgeBase')) return;
    params.delete('knowledgeBase');
    const query = params.toString();
    _router.replace(`${window.location.pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }, [_router]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const storedConversationId = useChatStore((s) => s.currentConversationId);
  const loadingConversations = useChatStore((s) => s.isLoadingConversations);
  const hasLoadedConversations = useChatStore((s) => s.hasLoadedConversations);
  useEffect(() => {
    if (!hasLoadedConversations || disabled || isParsingDocument) return;
    return afterStartupPaint(() => {
      const input = textareaRef.current;
      if (input && !input.disabled && input.getClientRects().length > 0) {
        startupMonitor.markChatReady('composerEditable');
      }
    });
  }, [hasLoadedConversations, disabled, isParsingDocument]);
  const currentConvId = conversationId || storedConversationId;
  // The photo batch and folder of this chat: the chips above the composer show them, the
  // attachment sheet is the only place that picks or forgets them.
  const androidAttachments = useAndroidAttachmentSelections(
    android ? currentConvId ?? undefined : undefined,
  );
  const workspaceDirectory = useConversationAttachmentStore((s) => {
    if (android) return undefined;
    if (!currentConvId) return undefined;
    return s.mountedDirByConversation[currentConvId] ?? (s.workspaceExistsByConversation[currentConvId]
      ? s.sessionDirByConversation[currentConvId]
      : undefined);
  });
  const { selectedKnowledgeBase, selectKnowledgeBase, removeSelectedKnowledgeBase } = useKnowledgeBaseSelection({
    conversationId: currentConvId || null,
    deepLinkId: selectedKnowledgeBaseId,
    deepLinkConversationId: searchParams.get('conversation') || searchParams.get('conversationId') || undefined,
    consumeDeepLink: consumeKnowledgeBaseDeepLink,
    ready: !loadingConversations,
  });
  // —— 输入框高度控制：默认自适应，支持顶部拖拽，最大不超过视口 40% ——
  // The drag handle's floor until the element's own metrics are read; the composer's real
  // floor is `composerFloor(...)` - two lines - measured per element in `adjustTextareaHeight`.
  const MIN_INPUT_HEIGHT = 66;
  // The composer's own undo list; see ./composerHistory for why native undo is not enough.
  const historyRef = useRef(composerHistory(""));
  const historyScopeRef = useRef<string | null>(conversationId ?? null);
  const historyScope = conversationId ?? null;
  const [maxInputHeight, setMaxInputHeight] = useState<number>(Math.floor(window.innerHeight * 0.4));
  const sessionManualHeight = useUiSession((s: any)=> s.chatInputHeight);
  const setSessionManualHeight = useUiSession((s: any)=> s.setChatInputHeight);
  const planOnly = useUiSession((s: any) => s.getPlanOnly(currentConvId));
  const setPlanOnly = useUiSession((s: any) => s.setPlanOnly);
  const [manualHeight, setManualHeight] = useState<number | null>(sessionManualHeight);
  const [resizing, setResizing] = useState<{ startY: number; startH: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imagePasteGuardRef = useRef<boolean>(false);

  // 统一追加图片到附加区
  const appendImageFromBlob = async (blob: Blob, nameHint: string) => {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const base64Data = dataUrl.split(',')[1];
    setAttachedImages(prev => [...prev, { name: nameHint, dataUrl, base64Data, fileSize: blob.size }]);
  };

  // === 会话内草稿：仅在切换会话/失焦/卸载时提交，避免输入过程中重渲染导致光标跳动 ===
  // 统一的“agent 是否仍在运行”信号：不要只依赖父组件 isLoading（它只覆盖 LLM stream 阶段）
  const storeAgentRunning = useChatStore((s: any) => {
    const cid = conversationId || s.currentConversationId;
    if (!cid) return false;
    const conv = (s.conversations || []).find((c: any) => c && c.id === cid);
    const lastAssistant = [...(Array.isArray(conv?.messages) ? conv.messages : [])]
      .reverse()
      .find((m: any) => m?.role === 'assistant' && m.id);
    return Boolean(lastAssistant?.id && s.agentRuns?.[lastAssistant.id]?.running);
  });
  const effectiveLoading = isLoading || storeAgentRunning;
  const clearInputDraft = useChatStore((s)=>s.clearInputDraft);
  const setInputDraft = useChatStore((s)=>s.setInputDraft);
  const prevConvRef = useRef<string | null>(null);

  // 切换会话时：提交上一个会话草稿，并加载新会话草稿到本地状态（不强制移动光标）
  useEffect(() => {
    const prev = prevConvRef.current;
    if (prev && prev !== currentConvId) {
      try { setInputDraft(prev, inputValue); } catch {}
    }
    if (currentConvId) {
      const drafts = useChatStore.getState().inputDrafts || {};
      const stored = drafts[currentConvId];
      if (typeof stored === 'string') {
        setInputValue(stored);
      } else {
        // 特殊优化：切到“新建且空白的会话”时，沿用上一个会话的输入内容
        const conv = (useChatStore.getState().conversations || []).find(c => c.id === currentConvId);
        const hasAnyMessage = !!(conv && Array.isArray(conv.messages) && conv.messages.length > 0);
        if (!hasAnyMessage) setInputValue(inputValue); else setInputValue('');
      }
    } else {
      setInputValue('');
    }
    prevConvRef.current = currentConvId || null;
    setComposerSelection(null);
  }, [currentConvId]);

  const clearAndroidPhotoText = useCallback((id: string) => {
    setInputValue('');
    historyRef.current = composerHistory('');
    clearInputDraft(id);
  }, [clearInputDraft]);
  const androidPhoto = useAndroidPhotoDraft(
    currentConvId, inputValue, android ? providerName : undefined, modelId,
    android ? androidPhotoHandoff : undefined, setInputValue, clearAndroidPhotoText,
  );
  const photoConflictsWithDraft = Boolean(attachedDocument || editingMessage || isParsingDocument);
  const photoSendBlocked = androidPhoto.acquiring || androidPhoto.sending || Boolean(
    androidPhoto.snapshot && (!androidPhoto.recipient || effectiveLoading || photoConflictsWithDraft),
  );

  // 组件卸载时：提交当前草稿
  useEffect(() => {
    return () => {
      const conv = prevConvRef.current;
      if (conv) {
        try { setInputDraft(conv, inputValue); } catch {}
      }
    };
  }, [inputValue, setInputDraft]);

  // 在“真正开始流”时再清空输入框，避免瞬间清空带来的不佳体验
  const streamStartCounter = useChatStore((s)=> s.streamStartCounter || 0);
  const lastStreamConvId = useChatStore((s)=> s.lastStreamConvId);
  const ignoredPhotoStreamStart = useRef<number | null>(null);
  useEffect(()=>{
    if (android) {
      if (ignoredPhotoStreamStart.current === streamStartCounter) return;
      if (!shouldClearPhotoDraft(androidPhoto.snapshot)) {
        ignoredPhotoStreamStart.current = streamStartCounter;
        return;
      }
    }
    const convId = conversationId || useChatStore.getState().currentConversationId;
    if (lastStreamConvId && convId && lastStreamConvId === convId) {
      setInputValue("");
      // The cleared box is a fresh baseline: undo after a send must not put the sent text back.
      historyRef.current = composerHistory("");
      setAttachedDocument(null);
      setAttachedImages([]);
      try { clearInputDraft(convId); } catch { /* noop */ }
      // 开始流时不强制重置为最小值，保持用户手动高度或自动自适应
      if (textareaRef.current) {
        // 若用户手动设置过高度，则保持；否则自适应到内容高度
        const mh = (sessionManualHeight ?? manualHeight);
        if (mh !== null) {
          const styles = window.getComputedStyle(textareaRef.current);
          textareaRef.current.style.height = `${nextInputHeight({
            contentHeight: mh,
            floor: composerFloor({
              lineHeight: styles.lineHeight,
              fontSize: styles.fontSize,
              paddingTop: styles.paddingTop,
              paddingBottom: styles.paddingBottom,
            }),
            limit: Math.max(
              composerFloor({
                lineHeight: styles.lineHeight,
                fontSize: styles.fontSize,
                paddingTop: styles.paddingTop,
                paddingBottom: styles.paddingBottom,
              }),
              maxInputHeight,
            ),
            manual: mh,
          })}px`;
        } else {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
  }, [android, androidPhoto.snapshot, streamStartCounter, lastStreamConvId, conversationId, manualHeight, sessionManualHeight, clearInputDraft]);

  useEffect(() => {
    const timer = setTimeout(() => {
      // A different conversation is a different draft, not an edit of this one: without this,
      // undo would carry text from one conversation into another.
      if (historyScopeRef.current !== historyScope) {
        historyScopeRef.current = historyScope;
        historyRef.current = composerHistory(inputValue);
      } else {
        historyRef.current = commitHistory(historyRef.current, inputValue);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [inputValue, conversationId, historyScope]);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // The floor is a line count measured against the element's own metrics - two lines for
    // an empty composer - so it neither collapses to a one-row search field nor depends on a
    // constant that a font or density change silently invalidates.
    const styles =
      typeof window !== 'undefined' ? window.getComputedStyle(textarea) : ({} as CSSStyleDeclaration);
    const floor = Math.max(
      24,
      composerFloor({
        lineHeight: styles.lineHeight,
        fontSize: styles.fontSize,
        paddingTop: styles.paddingTop,
        paddingBottom: styles.paddingBottom,
      }),
    );
    const limit = Math.max(floor, maxInputHeight);
    const contentHeight = (() => {
      const previous = textarea.style.height;
      textarea.style.height = 'auto';
      const height = textarea.scrollHeight;
      textarea.style.height = previous;
      return height;
    })();
    textarea.style.height = `${nextInputHeight({
      contentHeight,
      floor,
      limit,
      manual: manualHeight,
    })}px`;
    textarea.style.maxHeight = `${limit}px`;
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, manualHeight, maxInputHeight]);

  // MCP预热：当用户输入@mention时自动预热相关服务器
  useEffect(() => {
    if (inputValue && inputValue.includes('@')) {
      // 异步预热，不阻塞用户输入
      mcpPreheater.preheatFromInput(inputValue).catch(error => {
        console.debug('[ChatInput] MCP预热失败:', error);
      });
    }
  }, [inputValue]);

  // shell_executor 预热：提前初始化 sandbox，减少“第一条工具卡片要等几秒才真正开跑”的体感
  useEffect(() => {
    try {
      if (!detectTauriEnvironment()) return;
      void getProcessSandbox().isAvailable().catch(() => {});
    } catch {
      // ignore
    }
  }, []);

  // 动态更新 60% 视口高度限制
  useEffect(() => {
    const onResize = () => setMaxInputHeight(Math.floor(window.innerHeight * 0.6));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 监听来自面板的内联变量赋值
  useEffect(() => {
    const handler = (e: any) => {
      const detail = (e as CustomEvent).detail as Record<string,string>;
      if (detail && typeof detail === 'object') {
        inlineVarsRef.current = detail;
      }
    };
    window.addEventListener('prompt-inline-vars', handler as any);
    return () => window.removeEventListener('prompt-inline-vars', handler as any);
  }, []);

  // Parse a leading prompt and its optional prose delimiter.
  const parseLeadingPrompt = (text: string):
    | { leadingSpace: string; token: string; varPart: string; postText: string; hasDelimiter: boolean; prefixRaw: string; postRaw: string; delimiterRaw: string }
    | null => {
    const m = text.match(/^(\s*)#([^\s#|｜]+)([\s\S]*)$/u);
    if (!m) return null;
    const leadingSpace = m[1] || '';
    const token = m[2];
    const tail = m[3] || '';
    const idx1 = tail.indexOf('|');
    const idx2 = tail.indexOf('｜');
    const cand = [idx1, idx2].filter((v) => v >= 0).sort((a, b) => a - b);
    if (cand.length > 0) {
      const idx = cand[0];
      const before = tail.slice(0, idx); // 原样保留（包含空格）
      const hasSpace = tail.charAt(idx + 1) === ' ';
      const delimiterRaw = tail.slice(idx, idx + 1 + (hasSpace ? 1 : 0));
      const afterRaw = tail.slice(idx + 1 + (hasSpace ? 1 : 0)); // 原样保留
      const varPart = before.trim();
      const postText = afterRaw.trim();
      return { leadingSpace, token, varPart, postText, hasDelimiter: true, prefixRaw: before, postRaw: afterRaw, delimiterRaw };
    }
    return { leadingSpace, token, varPart: tail.trim(), postText: '', hasDelimiter: false, prefixRaw: tail, postRaw: '', delimiterRaw: '' };
  };

  // 覆盖层与 textarea 使用一致字体度量，避免像素误差
  const [overlayFont, setOverlayFont] = useState<string>('');
  const [overlayFontSize, setOverlayFontSize] = useState<string>('');
  const [overlayLineHeight, setOverlayLineHeight] = useState<string>('');
  const composerQuery = !disabled && !isParsingDocument && composerSelection?.text === inputValue
    ? findComposerQuery(inputValue, composerSelection.caret)
    : null;
  const closeComposerPanel = () => setComposerSelection(null);
  const setComposerText = (text: string, caret: number) => {
    setInputValue(text);
    const el = textareaRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      if (!el.isConnected || el.value !== text) return;
      el.setSelectionRange(caret, caret);
      el.focus();
    });
  };
  const openComposerPanel = (trigger: ComposerTrigger) => {
    const el = textareaRef.current;
    if (!el || el.disabled) return;
    const next = insertComposerTrigger(inputValue, el.selectionStart, el.selectionEnd, trigger);
    setComposerText(next.text, next.caret);
    setComposerSelection(next);
  };
  const pickComposerItem = (replacement: string) => {
    if (!composerQuery) return;
    const next = replaceComposerQuery(inputValue, composerQuery, replacement);
    closeComposerPanel();
    setComposerText(next.text, next.caret);
  };
  const [textareaScroll, setTextareaScroll] = useState<number>(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    setOverlayFont(cs.fontFamily);
    setOverlayFontSize(cs.fontSize);
    setOverlayLineHeight(cs.lineHeight);

    // 监听textarea滚动，同步到覆盖层
    const handleScroll = () => {
      setTextareaScroll(el.scrollTop);
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [textareaRef.current]);

  // 拖拽过程事件（全局监听，释放时清理）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing) return;
      e.preventDefault();
      const delta = resizing.startY - e.clientY; // 向上拖动增高
      const next = Math.max(MIN_INPUT_HEIGHT, resizing.startH + delta);
      setManualHeight(next);
      try { setSessionManualHeight(next); } catch { /* noop */ }
    };
    const onUp = () => setResizing(null);
    if (resizing) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  // Keep the textarea overlay aligned with prompt and mention syntax.
  const parsedPrompt = parseLeadingPrompt(inputValue);
  const { mcp: hasMentionOverlay, skill: hasSkillMentionOverlay } = useMemo(
    () => hasInlineReferences(inputValue),
    [inputValue]
  );

  // 当进入编辑模式时，预填充内容
  useEffect(() => {
    if (editingMessage) {
      setInputValue(editingMessage.content);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, [editingMessage]);

  // 监听全局回填事件：当发送失败且AI无任何输出时，把用户文本回填输入框
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent<string>).detail;
        if (typeof detail === 'string') {
          setInputValue(detail);
          const el = textareaRef.current; if (el) { setTimeout(()=>{ el.focus(); el.selectionStart = el.selectionEnd = el.value.length; },0); }
        }
      } catch { /* noop */ }
    };
    window.addEventListener('chat-input-fill', handler as EventListener);
    return () => window.removeEventListener('chat-input-fill', handler as EventListener);
  }, []);

  const handleSend = async () => {
    if (photoSendBlocked || (!inputValue.trim() && !attachedDocument && !androidPhoto.snapshot)) return;

    // 发送前检查
    if (onBeforeSendMessage) {
      const canSend = await onBeforeSendMessage();
      if (!canSend) {
        // 具体错误信息应由父组件处理和显示
        return;
      }
    }

    let userMessage = inputValue.trim();

    // Render an exact saved shortcut when submitted without choosing from the panel.
    if (userMessage.startsWith('#')) {
      try {
        const prompts = usePromptStore.getState().prompts;
        const parsedForAfter = parseLeadingPrompt(userMessage);
        const token = parsedForAfter?.token.toLowerCase();
        const rest = parsedForAfter?.varPart ?? '';
        const afterTail = parsedForAfter && parsedForAfter.hasDelimiter && parsedForAfter.postText
          ? `\n${parsedForAfter.postText}`
          : '';
        const matched = token && prompts.find((p) => p.shortcuts?.some((s) => s.toLowerCase() === token));
        if (matched) {
          // 解析变量：key=value 或 位置参数（支持 | 与 ｜）
          const inline: Record<string,string> = {};
          const varRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/gu;
          let m: RegExpExecArray | null;
          while ((m = varRe.exec(rest))) { inline[m[1]] = (m[3] ?? m[4] ?? m[5] ?? '').toString(); }
          let values: Record<string,string> = {};
          const keys: string[] = (() => {
            // 优先元数据中定义的顺序
            if (Array.isArray(matched.variables) && matched.variables.length>0) return matched.variables.map((v:any)=>v.key);
            const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
            const ks: string[] = []; let mm: RegExpExecArray | null;
            while ((mm = pattern.exec(String(matched.content||'')))) { const k = mm[1]; if (k && !ks.includes(k)) ks.push(k); }
            return ks;
          })();
          // 位置参数
          if (Object.keys(inline).length === 0 && rest) {
            const pos = /[|｜]/.test(rest) ? rest.split(/[|｜]/g).map(s=>s.trim()).filter(Boolean) : [rest];
            values = Object.fromEntries(keys.map((k, idx)=> [k, pos[idx] ?? '']));
          } else {
            // 合并默认值
            const defaults: Record<string,string> = Object.fromEntries((matched.variables||[]).map((v:any)=> [v.key, v.defaultValue ?? '']));
            values = { ...defaults, ...inline };
          }
          const rendered = renderPromptContent(String(matched.content||''), values);
          if (rendered && rendered.trim()) {
            // 同步“发送”动作的行为：若存在“| ”后的文本且模板未显式消化它，也要附加到末尾
            userMessage = `${rendered.trim()}${afterTail}`;
            // 计数一次使用（兜底渲染也算使用）
            try { usePromptStore.getState().touchUsage(matched.id as string); } catch {}
          }
        }
      } catch { /* noop */ }
    }

    if (androidPhoto.snapshot) {
      await androidPhoto.submit(
        androidPhoto.snapshot,
        userMessage || t('androidPhoto.message'),
        (content, options) => onSendMessage(
          content,
          undefined,
          selectedKnowledgeBase ? { id: selectedKnowledgeBase.id, name: selectedKnowledgeBase.name } : undefined,
          { ...options, planOnly },
        ),
      );
      return;
    }

    if (attachedImages.length > 0) {
      const imagesData = attachedImages.map(img => img.base64Data);
      await onSendMessage(userMessage || '[图片]', undefined, selectedKnowledgeBase ? { id: selectedKnowledgeBase.id, name: selectedKnowledgeBase.name } : undefined, { images: imagesData, planOnly });
    } else if (editingMessage) {
      // 编辑模式下，保留原引用信息
      const docRef = editingMessage.documentReference
        ? {
            documentReference: editingMessage.documentReference,
            contextData: editingMessage.contextData || ''
          }
        : undefined;
      await onSendMessage(
        userMessage,
        docRef,
        editingMessage.knowledgeBaseReference,
        { planOnly }
      );
      // 退出编辑模式
      onCancelEdit?.();
    } else if (attachedDocument) {
      // 可选：自动拼接文档预览到提示词
      let contentToSend = userMessage;
      try {
        const cfg = getCurrentKnowledgeBaseConfig();
        if (cfg.documentProcessing.autoAttachDocumentPreview) {
          const { preview } = createSafePreview(attachedDocument.content, cfg.documentProcessing.previewTokenLimit);
          contentToSend = `${userMessage}\n\n[Document Preview]\n${preview}`;
        }
      } catch { /* noop */ }

      await onSendMessage(contentToSend, {
        documentReference: {
          fileName: attachedDocument.name,
          fileType: attachedDocument.name.split('.').pop() || 'unknown',
          fileSize: attachedDocument.fileSize,
          summary: attachedDocument.summary
        },
        contextData: attachedDocument.content,
        sourceContent: attachedDocument.fullContent,
        sourceBytes: attachedDocument.bytes,
      }, selectedKnowledgeBase ? { id: selectedKnowledgeBase.id, name: selectedKnowledgeBase.name } : undefined, { planOnly });
    } else {
      // 普通消息，如果有选中的知识库则传递
      await onSendMessage(userMessage, undefined, selectedKnowledgeBase ? { id: selectedKnowledgeBase.id, name: selectedKnowledgeBase.name } : undefined, { planOnly });
    }

    // onSendMessage only resolves after the supplement and its attachments are
    // durable, so every accepted input can now be cleared consistently.
    if (effectiveLoading) {
      setInputValue('');
      setAttachedDocument(null);
      setAttachedImages([]);
      const convId = conversationId || useChatStore.getState().currentConversationId;
      if (convId) clearInputDraft(convId);
    }

    // 不立即把高度重置为 auto，保持用户手动高度（或让 onStart 信号处理）

    // 如果会话提示词为 oneOff，则清除
    try {
      const convId = conversationId;
      if (convId) {
        const conv = useChatStore.getState().conversations.find((c:any)=>c.id===convId);
        const applied = conv?.system_prompt_applied;
        if (applied?.mode === 'oneOff') {
          useChatStore.getState().updateConversation(convId, { system_prompt_applied: null } as any);
        }
      }
      } catch { /* noop */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+Z / Cmd+Z undo, Ctrl+Shift+Z (and Ctrl+Y on Windows) redo - while the composer is
    // the thing being typed in. Prevented here so the browser does not also undo underneath.
    const isComposing =
      (e.nativeEvent as { isComposing?: boolean })?.isComposing === true;
    const shortcut = isComposing ? null : historyShortcut(e);
    if (shortcut) {
      // Whatever is on screen right now is part of the user's text, so commit it before
      // stepping - otherwise a Ctrl+Z within the debounce window throws away what was just
      // typed and cannot redo it.
      historyRef.current =
        historyScopeRef.current === historyScope
          ? commitHistory(historyRef.current, inputValue)
          : composerHistory(inputValue);
      historyScopeRef.current = historyScope;
      const step =
        shortcut === "undo" ? undoHistory(historyRef.current) : redoHistory(historyRef.current);
      if (step === historyRef.current) return; // nothing to do: let the browser try
      e.preventDefault();
      historyRef.current = step;
      setInputValue(step.present);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(step.present.length, step.present.length);
        adjustTextareaHeight();
      });
      return;
    }
    if (!android && !isComposing && e.key === "Enter" && !e.shiftKey) {
      if (composerQuery) { e.preventDefault(); return; }
      e.preventDefault();
      handleSend();
    }
  };

  const [attachedImages, setAttachedImages] = useState<{ name: string; dataUrl: string; base64Data: string; fileSize: number }[]>([]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });

      // 将Data URL转换为纯base64字符串（Ollama API要求）
      const base64Data = dataUrl.split(',')[1];

      setAttachedImages(prev => [...prev, {
        name: file.name,
        dataUrl, // 保留原始Data URL用于UI显示
        base64Data, // 纯base64数据用于API调用
        fileSize: file.size
      }]);
    }
    e.target.value = "";
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查是否是可解析的文档类型
    const fileExtension = file.name.toLowerCase().split('.').pop();
    const supportedTypes = ['pdf', 'docx', 'md', 'markdown', 'txt', 'json', 'csv', 'xlsx', 'xls', 'html', 'htm', 'rtf', 'epub'];
    const MAX_SIZE = 20 * 1024 * 1024; // 20MB，与后端限制一致
    if (file.size > MAX_SIZE) {
      toast.error('文档过大', { description: `当前限制为 ${Math.round(MAX_SIZE/1024/1024)}MB，请拆分后再试` });
      e.target.value = "";
      return;
    }

    if (supportedTypes.includes(fileExtension || '')) {
      // 处理文档解析
      await handleDocumentParsing(file);
    } else if (onFileUpload) {
      // 处理其他类型文件上传
      onFileUpload(file);
    }

    e.target.value = "";
  };

  const handleDocumentParsing = async (file: File) => {
    setIsParsingDocument(true);

    try {
      const { DocumentParser } = await import('@/lib/documentParser');
      const result = await DocumentParser.parseFileObject(file, { maxFileSize: 20 * 1024 * 1024, timeoutMs: 30_000 });

      if (result.success && result.content) {
        const summary = DocumentParser.getDocumentSummary(result.content, 150);
        // 生成安全预览，防止误把超长文本拼进后续提示词
        const { preview } = createSafePreview(result.content, 6000);

        setAttachedDocument({
          name: file.name,
          content: DocumentParser.cleanDocumentContent(preview),
          fullContent: DocumentParser.cleanDocumentContent(result.content),
          summary,
          fileSize: file.size,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      } else {
        // 解析失败，显示错误信息
        toast.error(`文档解析失败`, {
          description: result.error || '未知错误'
        });
      }

      // 自动聚焦到文本输入框
      if (textareaRef.current) {
        textareaRef.current.focus();
      }

    } catch (error) {
      console.error('文档解析失败:', error);
      toast.error(`文档解析失败`, {
        description: error instanceof Error ? error.message : '未知错误'
      });
    } finally {
      setIsParsingDocument(false);
    }
  };

  const removeAttachedDocument = () => {
    setAttachedDocument(null);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (android || !el) return;
    const onPaste = async (e: ClipboardEvent) => {
      try {
        if (!e.clipboardData) return;
        const items = Array.from(e.clipboardData.items || []);
        const imageItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
        if (!imageItem) return;
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (!file) return;
        imagePasteGuardRef.current = true;
        await appendImageFromBlob(file, file.name || 'pasted.png');
      } catch { /* noop */ } finally {
        setTimeout(()=>{ imagePasteGuardRef.current = false; }, 0);
      }
    };
    const onDragOver = (e: DragEvent) => {
      const dt = e.dataTransfer; if (!dt) return;
      const hasFile = Array.from(dt.items || []).some((it)=> it.kind==='file');
      if (hasFile || dt.getData('text/uri-list')) { e.preventDefault(); dt.dropEffect = 'copy'; }
    };
    const onDrop = async (e: DragEvent) => {
      const dt = e.dataTransfer; if (!dt) return;
      const files = Array.from(dt.files || []);
      const images = files.filter(f=> f.type.startsWith('image/'));
      if (images.length>0) { e.preventDefault(); for (const f of images) await appendImageFromBlob(f, f.name||'dropped.png'); return; }
      const url = dt.getData('text/uri-list') || dt.getData('text/plain');
      if (url && /^(https?:|data:)/i.test(url)) { e.preventDefault(); try { const resp = await fetch(url); const blob = await resp.blob(); if (blob.type.startsWith('image/')) await appendImageFromBlob(blob, `dropped-${Date.now()}.${(blob.type.split('/')[1]||'png')}`); } catch { /* noop */ } }
    };
    el.addEventListener('paste', onPaste as any);
    el.addEventListener('dragover', onDragOver as any);
    el.addEventListener('drop', onDrop as any);
    return () => {
      el.removeEventListener('paste', onPaste as any);
      el.removeEventListener('dragover', onDragOver as any);
      el.removeEventListener('drop', onDrop as any);
    };
  }, [android, textareaRef.current]);

  return (
    <div className={cn(
      "input-area chat-content mb-5",
      disabled && "opacity-45 pointer-events-none"
    )}>
      {/* 编辑模式提示栏 */}
      {editingMessage && (
        <div className="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700 text-xs text-yellow-800 dark:text-yellow-200 rounded-md px-3 py-1 mb-2">
          <span>正在编辑之前的消息，发送后将作为新消息重新提交</span>
          <button className="text-xs underline" onClick={onCancelEdit}>取消编辑</button>
        </div>
      )}

      {android && (
        <AndroidDocumentAttachmentStatus
          state={androidDocument.state}
          disabled={disabled || effectiveLoading}
          onRemove={androidDocument.remove}
        />
      )}

      {/* 已移除输入框上方“长条附加项”（知识库/工作目录/文档），仅在下方彩色标签条展示 */}

      {android && (
        <AndroidPhotoPreview
          photo={androidPhoto.snapshot?.photo}
          providerName={providerName}
          modelId={modelId}
          status={androidPhoto.support}
          feedback={androidPhoto.acquiring ? 'acquiring' : androidPhoto.snapshot && effectiveLoading ? 'busy' : androidPhoto.snapshot && photoConflictsWithDraft ? 'other_attachment' : androidPhoto.feedback}
          disabled={androidPhoto.acquiring || androidPhoto.sending}
          onRemove={androidPhoto.remove}
        />
      )}
      {attachedImages.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachedImages.map((img, idx) => (
            <div key={idx} className="relative group">
              <img src={img.dataUrl} alt="img" className="w-24 h-24 object-cover rounded-md" />
              <button
                className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-5 h-5 text-xs hidden group-hover:block"
                onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 文档附加展示已移至下方彩色标签条 */}

      {/* 本对话的附件选择状态：紧凑 chips，选择/更换/取消都在附件面板里 */}
      {android && (
        <AndroidAttachmentChips
          photoBatch={androidAttachments.photoBatch}
          directory={androidAttachments.directory}
        />
      )}

      <div
        className="relative flex w-full overflow-hidden rounded-2xl border border-slate-300/40 dark:border-slate-600/40 bg-white/30 dark:bg-slate-900/35 hover:border-slate-400/50 dark:hover:border-slate-500/50 focus-within:border-sky-400/45 dark:focus-within:border-sky-400/40 focus-within:ring-0 transition-colors duration-200 composer-box"
        onDragOver={(e) => {
          if (android) return;
          const dt = (e as React.DragEvent).dataTransfer;
          if (!dt) return;
          const hasFile = Array.from(dt.items || []).some((it) => it.kind === "file");
          if (hasFile || dt.getData("text/uri-list")) {
            e.preventDefault();
            dt.dropEffect = "copy";
          }
        }}
        onDrop={async (e) => {
          if (android) return;
          const dt = (e as React.DragEvent).dataTransfer;
          if (!dt) return;
          const files = Array.from(dt.files || []);
          const imgs = files.filter((f) => f.type.startsWith("image/"));
          if (imgs.length > 0) {
            e.preventDefault();
            for (const f of imgs) await appendImageFromBlob(f, f.name || "dropped.png");
            return;
          }
          const url = dt.getData("text/uri-list") || dt.getData("text/plain");
          if (url && /^(https?:|data:)/i.test(url)) {
            e.preventDefault();
            try {
              const resp = await fetch(url);
              const blob = await resp.blob();
              if (blob.type.startsWith("image/"))
                await appendImageFromBlob(blob, `dropped-${Date.now()}.${blob.type.split("/")[1] || "png"}`);
            } catch {
              /* noop */
            }
          }
        }}
      >
        {/* 顶部拖拽手柄：按住可向上/下调整高度，封顶 60vh */}
        <div
          className={cn("absolute top-0 left-0 right-0 h-2 cursor-n-resize z-[3]", android && "hidden")}
          onMouseDown={(e) => {
            if (disabled) return;
            const el = textareaRef.current; if (!el) return;
            const cs = parseFloat(getComputedStyle(el).height || '0');
            setResizing({ startY: e.clientY, startH: cs || MIN_INPUT_HEIGHT });
          }}
          onDoubleClick={() => { setManualHeight(null); setSessionManualHeight(null); setResizing(null); setTimeout(adjustTextareaHeight, 0); }}
        />
        <SlashPromptPanel
          open={composerQuery?.trigger === '#'}
          onOpenChange={closeComposerPanel}
          onSelect={(id, opts) => {
            const merged = { ...(inlineVarsRef.current||{}) };
            inlineVarsRef.current = {};
            const action = opts?.action || 'apply';
            if (action === 'fill') {
              const prompt = usePromptStore.getState().prompts.find(p=>p.id===id);
              if (prompt) {
                // 渲染内容
                let variableValues: Record<string,string> = merged as any;
                const pos = (merged as any).__positional as string[] | undefined;
                if (Array.isArray(pos)) {
                  const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
                  const keys: string[] = [];
                  let m: RegExpExecArray | null;
                  while ((m = pattern.exec(String(prompt.content||'')))) { const k = m[1]; if (k && !keys.includes(k)) keys.push(k); }
                  if (keys.length > 0) {
                    variableValues = Object.fromEntries(keys.map((k, idx)=> [k, pos[idx] ?? '']));
                  } else if (prompt.variables && prompt.variables.length > 0) {
                    variableValues = Object.fromEntries((prompt.variables||[]).map((v:any, idx:number)=> [v.key, pos[idx] ?? v.defaultValue ?? '']));
                  }
                }
                const rendered = (renderPromptContent as any)(prompt.content, variableValues);
                if (rendered && rendered.trim()) {
                  pickComposerItem(rendered);
                  // 计数一次使用（代入即视为使用）
                  try { usePromptStore.getState().touchUsage(id); } catch {}
                }
              }
              closeComposerPanel();
              return;
            }
            if (action === 'send') {
              // 直接发送一次：渲染提示词内容并发送
              const prompt = usePromptStore.getState().prompts.find(p=>p.id===id);
              if (prompt) {
                let variableValues: Record<string,string> = merged as any;
                const pos = (merged as any).__positional as string[] | undefined;
                if (Array.isArray(pos)) {
                  // 优先使用模板中的 {{var}} 顺序推导键名
                  const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
                  const keys: string[] = [];
                  let m: RegExpExecArray | null;
                  while ((m = pattern.exec(String(prompt.content||'')))) { const k = m[1]; if (k && !keys.includes(k)) keys.push(k); }
                  if (keys.length > 0) {
                    variableValues = Object.fromEntries(keys.map((k, idx)=> [k, pos[idx] ?? '']));
                  } else if (prompt.variables && prompt.variables.length > 0) {
                    variableValues = Object.fromEntries((prompt.variables||[]).map((v:any, idx:number)=> [v.key, pos[idx] ?? v.defaultValue ?? '']));
                  }
                }
                const rendered = (renderPromptContent as any)(prompt.content, variableValues);
                if (rendered && rendered.trim()) {
                  // 组装：若存在 "| " 分隔的后续文本，将其按换行拼接
                  const parsed = parseLeadingPrompt(inputValue);
                  const after = parsed && parsed.hasDelimiter && parsed.postText ? `\n${parsed.postText}` : '';
                  // 只设置一次，避免随后 strip 再次覆盖导致丢失后续文本
                  setInputValue(`${rendered}${after}`);
                  // 计数一次使用
                  try { usePromptStore.getState().touchUsage(id); } catch {}
                  // A draft photo is sent only through the explicit Send button.
                  if (!androidPhoto.snapshot && !androidPhoto.acquiring) {
                    setTimeout(() => { handleSend(); }, 0);
                  }
                }
              }
              closeComposerPanel();
              return;
            }
            // Applying a system prompt requires an existing conversation.
            if (!currentConvId) { closeComposerPanel(); return; }
            const mode = opts?.mode || 'permanent';
            try {
              const prompt = usePromptStore.getState().prompts.find(p=>p.id===id);
              let variableValues: Record<string,string> = merged as any;
              const pos = (merged as any).__positional as string[] | undefined;
               if (prompt && Array.isArray(pos)) {
                const pattern = /\{\{\s*([^\s{}=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^}]+)))?\s*\}\}/gu;
                const keys: string[] = [];
                let m: RegExpExecArray | null;
                while ((m = pattern.exec(String(prompt.content||'')))) { const k = m[1]; if (k && !keys.includes(k)) keys.push(k); }
                if (keys.length > 0) {
                  variableValues = Object.fromEntries(keys.map((k, idx)=> [k, pos[idx] ?? '']));
                } else if (prompt.variables && prompt.variables.length > 0) {
                  variableValues = Object.fromEntries((prompt.variables||[]).map((v:any, idx:number)=> [v.key, pos[idx] ?? v.defaultValue ?? '']));
                }
              }
              useChatStore.getState().updateConversation(currentConvId, { system_prompt_applied: { promptId: id, variableValues, mode } as any });
              pickComposerItem('');
              toast.success(mode === 'oneOff' ? '已作为一次性系统提示词应用' : '已应用到当前会话');
            } catch {}
            closeComposerPanel();
          }}
          anchorRef={textareaRef as any}
          queryText={composerQuery?.trigger === '#' ? `#${composerQuery.query}` : ''}
        />
        {/* 高亮覆盖层：与 textarea 完全重叠，渲染 "#指令 + 变量 + (可选) | + 后续文本"。
            为避免重影，textarea 在有 #指令 时使用 text-transparent，仅显示插入符。 */}
        {(() => {
          const parsed = parsedPrompt;
          const overlayNeedsTailNewline = /\r?\n$/.test(inputValue);
          if (!parsed && (hasMentionOverlay || hasSkillMentionOverlay)) {
            // 无 # 指令时，仅做 @ 提示的淡绿色高亮（严格对齐：不添加任何额外字符/空格）
            return (
              <div ref={overlayRef} className="absolute inset-0 pointer-events-none select-none overflow-hidden">
                <div
                  className={cn(
                    "pl-8 sm:pl-10 pr-32 sm:pr-36 py-[10px] pb-10 whitespace-pre-wrap text-sm sm:text-base tabular-nums",
                    // 关键：当文本以换行结尾时，pre-wrap 往往不渲染“最后的空行高度”，
                    // 用伪元素仅在该场景补一个换行（不改原文、不影响复制/发送）
                    overlayNeedsTailNewline ? "after:content-['\\A'] after:whitespace-pre" : ""
                  )}
                  style={{
                    fontFamily: overlayFont || undefined,
                    fontSize: overlayFontSize || undefined,
                    lineHeight: overlayLineHeight || undefined,
                    letterSpacing: 'normal',
                    wordBreak: 'break-word',
                    transform: `translateY(-${textareaScroll}px)`,
                  }}
                >
                  {renderInlineReferencesForOverlay(inputValue)}
                </div>
              </div>
            );
          }
          if (!parsed) return null;
          const { leadingSpace, token, prefixRaw, hasDelimiter, postRaw, delimiterRaw } = parsed;
          const prefixText = `#${token}${prefixRaw}${hasDelimiter ? delimiterRaw : ''}`;
          return (
            <div ref={overlayRef} className="absolute inset-0 pointer-events-none select-none overflow-hidden">
              <div
                className={cn(
                  "pl-8 sm:pl-10 pr-32 sm:pr-36 py-[10px] pb-10 whitespace-pre-wrap text-sm sm:text-base tabular-nums",
                  overlayNeedsTailNewline ? "after:content-['\\A'] after:whitespace-pre" : ""
                )}
                style={{
                  fontFamily: overlayFont || undefined,
                  fontSize: overlayFontSize || undefined,
                  lineHeight: overlayLineHeight || undefined,
                  letterSpacing: 'normal',
                  wordBreak: 'break-word',
                  transform: `translateY(-${textareaScroll}px)`,
                }}
              >
                {/* 保留前导空格 */}
                {leadingSpace}
                {/* 高亮整段 #token + 变量 + 可选" | "，保持与原文本完全一致，避免光标错位 */}
                <span className="bg-amber-100/90 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200" style={{ fontFeatureSettings: '"liga" 0, "clig" 0', fontFamily: overlayFont || undefined, fontSize: overlayFontSize || undefined, lineHeight: overlayLineHeight || undefined, display: 'inline', boxShadow: '0 0 0 3px rgba(251, 191, 36, 0.2)', borderRadius: '2px' }}>{prefixText}</span>
                {/* 竖线后的普通文本按原样展示（不高亮）*/}
                {hasDelimiter && postRaw ? <>{renderInlineReferencesForOverlay(postRaw)}</> : null}
              </div>
            </div>
          );
        })()}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => {
            const { value: text, selectionStart: caret } = e.currentTarget;
            setInputValue(text);
            setComposerSelection({ text, caret });
          }}
          onSelect={(e) => {
            if (composerSelection?.text === e.currentTarget.value && e.currentTarget.selectionStart !== composerSelection.caret) {
              closeComposerPanel();
            }
          }}
          onKeyDown={handleKeyDown}
          enterKeyHint={android ? "enter" : undefined}
          placeholder={disabled ? "请先选择模型" : "发送消息"}
          className={cn(
            "relative z-[1] w-full pl-8 sm:pl-10 pr-20 sm:pr-24 pt-2.5 pb-9 resize-none rounded-lg border-0 bg-transparent focus:outline-none transition-all text-sm sm:text-base min-h-[58px] placeholder:text-[13px] placeholder:text-slate-400 dark:placeholder:text-slate-500",
            (parsedPrompt || hasMentionOverlay || hasSkillMentionOverlay) ? "text-transparent caret-slate-900 dark:caret-slate-100 tabular-nums [&::selection]:bg-blue-200/30 dark:[&::selection]:bg-blue-800/30 [&::selection]:text-transparent" : "text-slate-900 dark:text-slate-100 tabular-nums"
          )}
          style={{ maxHeight: `${Math.max(MIN_INPUT_HEIGHT, maxInputHeight)}px` }} // adjustTextareaHeight owns the real limit
          rows={1}
          disabled={disabled || isParsingDocument}
        />
        {composerQuery?.trigger === '@' && (
          <McpMentionPanel
            key={workspaceDirectory}
            anchorRef={textareaRef}
            filterQuery={composerQuery.query}
            workspaceDirectory={workspaceDirectory}
            onSelect={(name) => pickComposerItem(`@${name} `)}
            onSelectFile={(path) => pickComposerItem(`${JSON.stringify(path)} `)}
            onBrowse={() => {
              const next = replaceComposerQuery(inputValue, composerQuery, '@');
              setComposerText(next.text, next.caret);
              setComposerSelection(next);
            }}
            onClose={closeComposerPanel}
          />
        )}
        <SkillMentionPanel
          open={composerQuery?.trigger === '/'}
          anchorRef={textareaRef as any}
          filterQuery={composerQuery?.trigger === '/' ? composerQuery.query : ''}
          onSelect={(skill: Skill) => pickComposerItem(`/${skill.id} `)}
          onClose={closeComposerPanel}
        />
        {/* 左下角工具栏：次要能力统一弱图标 */}
        <div className="absolute left-2 sm:left-3 bottom-2.5 z-[2] flex items-center gap-0.5">
          {/* 仅规划开关：运行期间锁定，避免同一回合改变执行语义 */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPlanOnly(!planOnly, currentConvId)}
            disabled={disabled || effectiveLoading}
            className={cn(
              "composer-tool h-8 w-8 rounded-md border-0 bg-transparent shadow-none hover:bg-slate-100 dark:hover:bg-slate-800",
              planOnly && "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40"
            )}
            title={planOnly ? "仅规划：关闭后才会执行写入和命令" : "仅规划"}
            aria-label={planOnly ? "关闭仅规划" : "开启仅规划"}
          >
            <ListChecks className="w-4 h-4" />
          </Button>

          {/* 附件菜单 */}
          <AttachmentMenu
            open={attachmentMenuOpen}
            onOpenChange={setAttachmentMenuOpen}
            disabled={disabled || effectiveLoading}
            isParsingDocument={android ? androidDocument.state?.busy : isParsingDocument}
            hasDocument={!!attachedDocument}
            selectedKnowledgeBase={selectedKnowledgeBase}
            onOpenComposerPanel={openComposerPanel}
            onPickImage={android ? () => void androidPhoto.acquire('pick') : () => imageInputRef.current?.click()}
            onCapturePhoto={android ? () => void androidPhoto.acquire('capture') : undefined}
            photoActionsDisabled={androidPhoto.acquiring || androidPhoto.sending}
            androidAttachments={android ? androidAttachments : undefined}
            onPickDocument={android ? androidDocument.pick : () => fileInputRef.current?.click()}
            documentLabel={android ? t('androidDocument.attach') : undefined}
            documentDescription={android ? t('androidDocument.formats') : undefined}
            onSelectKnowledgeBase={(kb) => {
              if (kb) {
                selectKnowledgeBase(kb);
              } else {
                removeSelectedKnowledgeBase();
              }
            }}
          />

          {/* 网络搜索 */}
          <WebSearchToggle
            conversationId={conversationId}
            disabled={disabled || effectiveLoading}
          />

          {/* MCP 服务器 */}
          <McpQuickToggle
            onInsertMention={(name) => {
              const el = textareaRef.current;
              if (!el) return;
              const start = el.selectionStart || 0;
              const end = el.selectionEnd || 0;
              const mention = `@${name} `;
              const next = inputValue.slice(0, start) + mention + inputValue.slice(end);
              setInputValue(next);
              setTimeout(() => { el.selectionStart = el.selectionEnd = start + mention.length; el.focus(); }, 0);
            }}
          />

          {/* 输入框齿轮按钮已移除：会话参数入口迁移到右上角三点菜单 */}

          {/* 隐藏的文件输入 */}
          {!android && (
            <>
              <input
                type="file"
                ref={imageInputRef}
                onChange={handleImageUpload}
                className="hidden"
                accept="image/*"
                disabled={disabled}
              />
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf, .docx, .md, .markdown, .txt, .json, .csv, .xlsx, .xls, .html, .htm, .rtf, .epub"
                disabled={disabled}
              />
            </>
          )}
        </div>
        <div className={cn("absolute right-2 sm:right-3 z-[2] flex items-center gap-1.5 sm:gap-2", android ? "bottom-1" : "bottom-2.5")}>
            {tokenCount > 0 && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500 mr-1 select-none font-mono tabular-nums hidden sm:inline">
                T:{tokenCount}
              </span>
            )}
            {effectiveLoading ? (
              <div className="flex items-center gap-2">
                {stopGenerationHint && (
                  <span className="hidden sm:inline text-[10px] text-amber-600 dark:text-amber-400 max-w-[180px] leading-tight text-right">
                    {stopGenerationHint}
                  </span>
                )}
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 select-none">
                  <span className="relative inline-flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-500" />
                  </span>
                  {'处理中'}
                </span>
                {!photoSendBlocked && (inputValue.trim() || attachedDocument) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSend}
                    className={cn("composer-tool rounded-md border-0 bg-transparent text-slate-600 shadow-none hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800", android ? "size-10" : "size-8")}
                    title="排队补充"
                    aria-label="排队补充"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onStopGeneration}
                  className={cn(
                    "composer-tool rounded-md border-0 bg-transparent shadow-none hover:bg-transparent dark:hover:bg-transparent",
                    android ? "size-10" : "size-8",
                    "text-slate-600 dark:text-slate-300"
                  )}
                  title={stopGenerationHint || "停止（停止生成/停止工具链路）"}
                  aria-label={stopGenerationHint || "停止生成"}
                >
                  <StopCircle className="w-5 h-5" />
                </Button>
              </div>
            ) : disabled ? (
              <div
                className="composer-tool h-8 w-8 rounded-md text-slate-400 dark:text-slate-500 flex items-center justify-center"
                aria-hidden
              >
                <Send className="w-4 h-4" />
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSend}
                disabled={photoSendBlocked || (!inputValue.trim() && !attachedDocument && !androidPhoto.snapshot)}
                className={cn(
                  "composer-tool composer-send rounded-md border-0 shadow-none transition-colors",
                  android ? "size-10" : "size-8",
                  (photoSendBlocked || (!inputValue.trim() && !attachedDocument && !androidPhoto.snapshot))
                    ? "pointer-events-none bg-transparent text-slate-300 dark:text-slate-600"
                    : "bg-sky-600 text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-white"
                )}
                title={android ? "发送" : "发送 (Enter)"}
                aria-label="发送消息"
              >
                <Send className="w-4 h-4" />
              </Button>
          )}

        </div>
      </div>

      {/* 已启用能力标签条 */}
      <ActiveCapabilitiesBar
        // 状态栏仅展示“附加内容”，搜索/MCP 入口在输入框按钮处
        webSearchEnabled={false}
        selectedKnowledgeBase={selectedKnowledgeBase}
        availableKnowledgeBases={knowledgeBaseOptions}
        onRemoveKnowledgeBase={removeSelectedKnowledgeBase}
        onSelectKnowledgeBase={(id) => {
          const kb = allKnowledgeBases.find(k => k.id === id);
          if (kb) selectKnowledgeBase(kb);
        }}
        attachedDocument={attachedDocument ? { name: attachedDocument.name, fileSize: attachedDocument.fileSize } : undefined}
        onRemoveDocument={() => removeAttachedDocument()}
        enabledMcpServers={[]}
      />

      {showStarterActions && !disabled && !effectiveLoading && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5" data-chat-starter-actions>
          <Button type="button" variant="ghost" size="sm" disabled={isParsingDocument}
            className="gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => workspaceDirectory ? openComposerPanel('@') : setAttachmentMenuOpen(true)}>
            {workspaceDirectory ? <FolderOpen aria-hidden="true" className="size-3.5" /> : <Paperclip aria-hidden="true" className="size-3.5" />}
            {t(workspaceDirectory ? 'chatStarter.workspaceFiles' : 'chatStarter.attach')}
            {workspaceDirectory && <kbd className="rounded border border-border px-1 text-[11px] leading-4">@</kbd>}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isParsingDocument}
            className="gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => openComposerPanel('#')}>
            <Bookmark aria-hidden="true" className="size-3.5" />
            {t('chatStarter.prompts')}
            {!android && <kbd className="rounded border border-border px-1 text-[11px] leading-4">#</kbd>}
          </Button>
        </div>
      )}
    </div>
  );
}

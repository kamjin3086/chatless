"use client";

import React, { useRef, useState, useEffect, useMemo } from "react";
import { Send, StopCircle, CornerDownLeft } from "lucide-react";
import { DocumentParser } from '@/lib/documentParser';
import { KnowledgeService, KnowledgeBase } from '@/lib/knowledgeService';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { AttachedDocumentView } from "./input/AttachedDocumentView";
import { SelectedKnowledgeBaseView } from "./input/SelectedKnowledgeBaseView";
import { SessionParametersDialog } from './SessionParametersDialog';
import { McpMentionPanel } from './input/McpMentionPanel';
import { SkillMentionPanel } from './input/SkillMentionPanel';
import { ChatModeSelector, type ChatMode } from './input/ChatModeSelector';
import { AttachmentMenu } from './input/AttachmentMenu';
import { MoreOptionsMenu } from './input/MoreOptionsMenu';
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
import { renderPromptContent } from '@/lib/prompt/render';
import { mcpPreheater } from '@/lib/mcp/mcpPreheater';
import { useUiSession } from '@/store/uiSession';
import { useWebSearchStore } from '@/store/webSearchStore';
import { useRouter } from 'next/navigation';
import { detectTauriEnvironment } from "@/lib/utils/environment";
import { getProcessSandbox } from "@/lib/skills/sandbox";
import {
  hasInlineReferences,
  renderInlineReferencesForOverlay,
} from './input/inlineReferenceHighlight';
import {
  getEnabledConfiguredServers,
  getConnectedServers,
  getGlobalEnabledServers,
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
    },
    knowledgeBase?: {
      id: string;
      name: string;
    },
    options?: { images?: string[] }
  ) => void;
  onImageUpload?: (file: File) => void;
  onFileUpload?: (file: File) => void;
  isLoading?: boolean;
  tokenCount?: number;
  disabled?: boolean;
  onStopGeneration?: () => void;
  onBeforeSendMessage?: () => Promise<boolean>;
  selectedKnowledgeBaseId?: string; // 来自URL参数或父组件的知识库ID
  editingMessage?: EditingMessageData | null;
  onCancelEdit?: () => void;
  // 会话参数相关
  providerName?: string;
  modelId?: string;
  modelLabel?: string;
  conversationId?: string; // 添加会话ID参数
  onSessionParametersChange?: (parameters: ModelParameters) => void;
  currentSessionParameters?: ModelParameters;
}

export function ChatInput({
  onSendMessage,
  onImageUpload: _onImageUpload,
  onFileUpload,
  isLoading = false,
  disabled = false,
  onStopGeneration,
  onBeforeSendMessage,
  selectedKnowledgeBaseId,
  tokenCount = 0,
  editingMessage = null,
  onCancelEdit,
  providerName,
  modelId,
  modelLabel,
  onSessionParametersChange,
  currentSessionParameters,
  conversationId
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // 直接应用提示词，无需弹窗
  const inlineVarsRef = useRef<Record<string,string>>({});
  const [isParsingDocument, setIsParsingDocument] = useState(false);
  const [attachedDocument, setAttachedDocument] = useState<{
    name: string;
    content: string;
    summary: string;
    fileSize: number;
  } | null>(null);

  // 知识库选择相关状态
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<KnowledgeBase | null>(null);
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
  
  // 会话参数设置弹窗状态
  const [sessionParametersDialogOpen, setSessionParametersDialogOpen] = useState(false);
  
  const _webSearch = useWebSearchStore();
  const _router = useRouter();
  const setConversationToolMode = useChatStore((s: any) => s.setConversationToolMode);
  const currentToolMode = useChatStore((s: any) => {
    const id = s.currentConversationId;
    const conv = id ? s.conversations.find((c: any) => c.id === id) : null;
    return (conv?.tool_mode as ('chat'|'agent') | undefined) || s.sessionToolMode || 'chat';
  });
  
  // MCP 服务器状态
  const [_mcpServers, setMcpServers] = useState<{ all: string[]; connected: string[]; enabled: string[] }>({
    all: [],
    connected: [],
    enabled: [],
  });
  
  // 加载 MCP 服务器状态
  useEffect(() => {
    (async () => {
      try {
        const all = await getEnabledConfiguredServers();
        const connected = await getConnectedServers();
        const enabled = await getGlobalEnabledServers() || all;
        setMcpServers({ all, connected, enabled });
      } catch {
        // ignore
      }
    })();
  }, []);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // —— 输入框高度控制：默认自适应，支持顶部拖拽，最大不超过视口 40% ——
  const MIN_INPUT_HEIGHT = 66; // 与样式中的 min-h 保持一致
  const [maxInputHeight, setMaxInputHeight] = useState<number>(Math.floor(window.innerHeight * 0.4));
  const sessionManualHeight = useUiSession((s)=> s.chatInputHeight);
  const setSessionManualHeight = useUiSession((s)=> s.setChatInputHeight);
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
  const currentConvId = conversationId || useChatStore((s)=>s.currentConversationId);
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
  }, [currentConvId]);

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
  useEffect(()=>{
    const convId = conversationId || useChatStore.getState().currentConversationId;
    if (lastStreamConvId && convId && lastStreamConvId === convId) {
      setInputValue("");
      setAttachedDocument(null);
      setAttachedImages([]);
      try { clearInputDraft(convId); } catch { /* noop */ }
      // 开始流时不强制重置为最小值，保持用户手动高度或自动自适应
      if (textareaRef.current) {
        // 若用户手动设置过高度，则保持；否则自适应到内容高度
        const mh = (sessionManualHeight ?? manualHeight);
        if (mh !== null) {
          textareaRef.current.style.height = `${Math.max(MIN_INPUT_HEIGHT, mh)}px`;
        } else {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
  }, [streamStartCounter, lastStreamConvId, conversationId, manualHeight, sessionManualHeight, clearInputDraft]);

  // 根据URL参数设置初始知识库
  useEffect(() => {
    if (selectedKnowledgeBaseId && !selectedKnowledgeBase) {
      loadSelectedKnowledgeBase(selectedKnowledgeBaseId);
    } else if (!selectedKnowledgeBaseId) {
      // 如果URL参数被移除，则清空选择
      setSelectedKnowledgeBase(null);
    }
  }, [selectedKnowledgeBaseId]);

  // 加载指定的知识库
  const loadSelectedKnowledgeBase = async (knowledgeBaseId: string) => {
    try {
      const kb = await KnowledgeService.getKnowledgeBase(knowledgeBaseId);
      if (kb) {
        setSelectedKnowledgeBase(kb);
      }
    } catch (error) {
      console.error('加载知识库失败:', error);
    }
  };

  // 移除知识库选择
  const handleRemoveKnowledgeBase = () => {
    setSelectedKnowledgeBase(null);
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const limit = Math.max(MIN_INPUT_HEIGHT, maxInputHeight);
    // 若用户未手动设置高度，则根据内容自适应增长，封顶 limit
    if (manualHeight === null) {
      textarea.style.height = 'auto';
      const next = Math.min(Math.max(textarea.scrollHeight, MIN_INPUT_HEIGHT), limit);
      textarea.style.height = `${next}px`;
    } else {
      // 采用手动高度，但仍然设置最大高度限制
      const applied = Math.min(Math.max(manualHeight, MIN_INPUT_HEIGHT), limit);
      textarea.style.height = `${applied}px`;
    }
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

  // 保留：如需联想 /token 列表可启用
  // const slashTokens = useMemo(() => { return []; }, [inputValue]);

  const stripFirstSlashToken = (text: string): string => {
    // 去除首个 /token（支持中文）
    return text.replace(/(^|\s)\/[^\s]+/u, (match) => (match.startsWith(' ') ? ' ' : ''));
  };

  // 解析起始的 /指令 及其参数与可选分隔符与后续文本（分隔符支持半/全角 |，后随可选空格）
  const parseLeadingSlash = (text: string):
    | { leadingSpace: string; token: string; varPart: string; postText: string; hasDelimiter: boolean; prefixRaw: string; postRaw: string; delimiterRaw: string }
    | null => {
    const m = text.match(/^(\s*)\/([^\s]+)(.*)$/u);
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
  const [mentionOpen, setMentionOpen] = useState<boolean>(false);
  const [skillMentionOpen, setSkillMentionOpen] = useState<boolean>(false);
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

  // 是否需要覆盖层渲染（/ 指令、@ 提示或 # 技能引用）
  const hasSlashOverlay = useMemo(() => !!parseLeadingSlash(inputValue), [inputValue]);
  const { mcp: hasMentionOverlay, skill: hasSkillMentionOverlay } = useMemo(
    () => hasInlineReferences(inputValue),
    [inputValue]
  );

  // 用渲染结果替换 /指令与其变量片段；若存在 “| ”，会将其后的内容以换行附加在渲染结果后
  const replaceSlashWithRendered = (text: string, rendered: string): string => {
    const parsed = parseLeadingSlash(text);
    if (!parsed) {
      // 兼容：只有一个斜线，或以空格+斜线结尾的情况
      // 保留前导空白，将末尾的单个 '/' 替换为渲染内容
      if (/^\s*\/$/u.test(text)) return text.replace(/\//u, rendered);
      if (/(^|\s)\/$/u.test(text)) return text.replace(/(^|\s)\/$/u, `$1${rendered}`);
      return text;
    }
    const { leadingSpace, varPart, postText, hasDelimiter } = parsed;
    const after = hasDelimiter && postText ? `\n${postText}` : '';
    // 构造要替换的前缀（/token + 可选空格 + varPart，不包含分隔符）
    const prefix = new RegExp(`^${leadingSpace.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&')}\\/[^\s]+(?:\\s+[^|｜]*)?`, 'u');
    return text.replace(prefix, `${leadingSpace}${rendered}${after}`);
  };

  // 从输入中移除 /指令与变量片段；若存在 “| ” 则保留其后的普通文本
  // const stripSlashTokenAndVars = (text: string): string => {
  //   const parsed = parseLeadingSlash(text);
  //   if (!parsed) return stripFirstSlashToken(text);
  //   const { leadingSpace, postText, hasDelimiter } = parsed;
  //   return hasDelimiter ? `${leadingSpace}${postText}` : leadingSpace;
  // };

  // 斜杠面板开关逻辑：当输入框以 / 开头或包含以空格分隔的 /token 时打开
  useEffect(() => {
    const val = inputValue;
    // 以 / 开头 或 光标前为 / 时唤起，但不改变输入框焦点
    const open = val.startsWith('/') || /\s\/$/.test(val);
    setIsPanelOpen(open);
    // @ 提示：当末尾形如 @xxx 时打开 MCP 引用面板（允许字母数字和 - _）
    setMentionOpen(/@([a-zA-Z0-9_-]*)$/.test(val));
    // # 提示：当末尾形如 #xxx 时打开技能引用面板
    setSkillMentionOpen(/#([a-zA-Z0-9_-]*)$/.test(val));
  }, [inputValue]);

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
    if (!inputValue.trim() && !attachedDocument) return;
    if (isLoading) return;

    // 发送前检查
    if (onBeforeSendMessage) {
      const canSend = await onBeforeSendMessage();
      if (!canSend) {
        // 具体错误信息应由父组件处理和显示
        return;
      }
    }

    let userMessage = inputValue.trim();

    // 兜底：若以 / 指令开头但未通过面板选择，尝试在发送前渲染提示词
    if (userMessage.startsWith('/')) {
      try {
        const prompts = usePromptStore.getState().prompts as any[];
        const parts = userMessage.split(/\s+/);
        const token = parts[0].replace(/^\//, '').toLowerCase();
        const rest = userMessage.slice(parts[0].length).trim();
        // 若用户使用了“| ”或“｜ ”分隔的后续文本（例如：/trans 英文 | 你好），兜底时也需要保留
        const parsedForAfter = parseLeadingSlash(userMessage);
        const afterTail = parsedForAfter && parsedForAfter.hasDelimiter && parsedForAfter.postText
          ? `\n${parsedForAfter.postText}`
          : '';
        // 精确匹配已保存的快捷词
        let matched = prompts.find((p:any)=> (p.shortcuts||[]).some((s:string)=> s.toLowerCase()===token));
        if (!matched) {
          // 回退：根据名称/标签生成候选，选择第一个以 token 开头的项
          matched = prompts.find((p:any)=> {
            const hay = `${p.name} ${(p.tags||[]).join(' ')} ${(p.languages||[]).join(' ')}`.toLowerCase();
            return hay.includes(token);
          });
        }
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
    
    // 规则（明确区分）：
    // - chat -> agent 只能通过：手动切换，或在 @/# 面板中“选择”了 MCP/Skill（见面板 onSelect）
    // - 仅输入文本中包含 @xxx / #xxx 不触发自动切换

    if (attachedImages.length > 0) {
      const imagesData = attachedImages.map(img => img.base64Data);
      onSendMessage(userMessage || '[图片]', undefined, selectedKnowledgeBase ? { id: selectedKnowledgeBase.id, name: selectedKnowledgeBase.name } : undefined, { images: imagesData });
    } else if (editingMessage) {
      // 编辑模式下，保留原引用信息
      const docRef = editingMessage.documentReference
        ? {
            documentReference: editingMessage.documentReference,
            contextData: editingMessage.contextData || ''
          }
        : undefined;
      onSendMessage(
        userMessage,
        docRef,
        editingMessage.knowledgeBaseReference
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

      onSendMessage(contentToSend, {
        documentReference: {
          fileName: attachedDocument.name,
          fileType: attachedDocument.name.split('.').pop() || 'unknown',
          fileSize: attachedDocument.fileSize,
          summary: attachedDocument.summary
        },
        contextData: attachedDocument.content
      }, selectedKnowledgeBase ? { id: selectedKnowledgeBase.id, name: selectedKnowledgeBase.name } : undefined);
    } else {
      // 普通消息，如果有选中的知识库则传递
      onSendMessage(userMessage, undefined, selectedKnowledgeBase ? { id: selectedKnowledgeBase.id, name: selectedKnowledgeBase.name } : undefined);
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
    if (e.key === "Enter" && !e.shiftKey) {
      // 1) 若 @ 面板打开，回车只代入选择，不发送（由面板自身处理 onSelect）
      if (mentionOpen) { e.preventDefault(); return; }
      // 2) 若 # 技能面板打开，回车只代入选择，不发送
      if (skillMentionOpen) { e.preventDefault(); return; }
      // 3) 若 / 面板打开，也不直接发送
      if (isPanelOpen) { e.preventDefault(); return; }
      // 4) 正常发送
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
      // 使用DocumentParser解析文件
      const result = await DocumentParser.parseFileObject(file, { maxFileSize: 20 * 1024 * 1024, timeoutMs: 30_000 });
      
      if (result.success && result.content) {
        const summary = DocumentParser.getDocumentSummary(result.content, 150);
        // 生成安全预览，防止误把超长文本拼进后续提示词
        const { preview } = createSafePreview(result.content, 6000);

        setAttachedDocument({
          name: file.name,
          content: DocumentParser.cleanDocumentContent(preview),
          summary,
          fileSize: file.size
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
    if (!el) return;
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
  }, [textareaRef.current]);

  return (
    <div className="input-area w-full bg-gradient-to-br from-white/40 via-slate-50/30 to-white/40 dark:from-gray-800/80 dark:via-slate-900/70 dark:to-gray-800/80 backdrop-blur-xl shadow-lg rounded-2xl mx-0 mb-4 p-2 sm:p-3 overflow-x-hidden border border-slate-200/40 dark:border-slate-700/40 max-w-full transition-all">
      {/* 编辑模式提示栏 */}
      {editingMessage && (
        <div className="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700 text-xs text-yellow-800 dark:text-yellow-200 rounded-md px-3 py-1 mb-2">
          <span>正在编辑之前的消息，发送后将作为新消息重新提交</span>
          <button className="text-xs underline" onClick={onCancelEdit}>取消编辑</button>
        </div>
      )}

      {selectedKnowledgeBase && (
        <SelectedKnowledgeBaseView
          knowledgeBase={selectedKnowledgeBase}
          onRemove={handleRemoveKnowledgeBase}
        />
      )}

      {attachedImages.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachedImages.map((img, idx) => (
            <div key={idx} className="relative group">
              <img src={img.dataUrl} alt="img" className="w-24 h-24 object-cover rounded" />
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

      {attachedDocument && (
        <div className="w-full max-w-full overflow-hidden px-1">
          <AttachedDocumentView
            document={attachedDocument}
            onRemove={removeAttachedDocument}
            onIndexed={(kbId) => setSelectedKnowledgeBase(prev => prev || { id: kbId, name: '临时收纳箱' } as any)}
          />
        </div>
      )}

      <div className="relative flex w-full rounded-xl border border-slate-300/50 dark:border-slate-600/50 bg-white dark:bg-slate-900/90 backdrop-blur-sm shadow-sm hover:border-slate-400/60 dark:hover:border-slate-500/60 focus-within:border-blue-400/60 dark:focus-within:border-blue-500/60 focus-within:ring-2 focus-within:ring-blue-100/50 dark:focus-within:ring-blue-900/30 transition-all duration-200" onDragOver={(e)=>{ const dt=(e as React.DragEvent).dataTransfer; if (!dt) return; const hasFile = Array.from(dt.items||[]).some((it)=> it.kind==='file'); if (hasFile || dt.getData('text/uri-list')) { e.preventDefault(); dt.dropEffect='copy'; } }} onDrop={async (e)=>{ const dt=(e as React.DragEvent).dataTransfer; if (!dt) return; const files=Array.from(dt.files||[]); const imgs=files.filter(f=>f.type.startsWith('image/')); if (imgs.length>0){ e.preventDefault(); for (const f of imgs) await appendImageFromBlob(f, f.name||'dropped.png'); return; } const url = dt.getData('text/uri-list')||dt.getData('text/plain'); if (url && /^(https?:|data:)/i.test(url)){ e.preventDefault(); try{ const resp=await fetch(url); const blob=await resp.blob(); if (blob.type.startsWith('image/')) await appendImageFromBlob(blob, `dropped-${Date.now()}.${(blob.type.split('/')[1]||'png')}`);}catch{ /* noop */ }} } }>
        {/* 顶部拖拽手柄：按住可向上/下调整高度，封顶 60vh */}
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-n-resize z-[3]"
          onMouseDown={(e) => {
            if (disabled) return;
            const el = textareaRef.current; if (!el) return;
            const cs = parseFloat(getComputedStyle(el).height || '0');
            setResizing({ startY: e.clientY, startH: cs || MIN_INPUT_HEIGHT });
          }}
          onDoubleClick={() => { setManualHeight(null); setSessionManualHeight(null); setResizing(null); setTimeout(adjustTextareaHeight, 0); }}
        />
        <SlashPromptPanel
          open={isPanelOpen}
          onOpenChange={setIsPanelOpen}
          onSelect={(id, opts) => {
            if (!conversationId) { setIsPanelOpen(false); return; }
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
                  // 用渲染结果替换 /指令+变量 片段（支持 | 分隔后文本拼接）
                  setInputValue(v => replaceSlashWithRendered(v, rendered));
                  // 计数一次使用（代入即视为使用）
                  try { usePromptStore.getState().touchUsage(id); } catch {}
                }
              }
              setIsPanelOpen(false);
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
                  const parsed = parseLeadingSlash(inputValue);
                  const after = parsed && parsed.hasDelimiter && parsed.postText ? `\n${parsed.postText}` : '';
                  // 只设置一次，避免随后 strip 再次覆盖导致丢失后续文本
                  setInputValue(`${rendered}${after}`);
                  // 计数一次使用
                  try { usePromptStore.getState().touchUsage(id); } catch {}
                  // 立即发送
                  setTimeout(() => { handleSend(); }, 0);
                }
              }
              setIsPanelOpen(false);
              return;
            }
            // 应用为 system：支持 permanent / oneOff
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
              useChatStore.getState().updateConversation(conversationId, { system_prompt_applied: { promptId: id, variableValues, mode } as any });
              setInputValue(v => stripFirstSlashToken(v));
              toast.success(mode === 'oneOff' ? '已作为一次性系统提示词应用' : '已应用到当前会话');
            } catch {}
            setIsPanelOpen(false);
          }}
          anchorRef={textareaRef as any}
          queryText={inputValue}
        />
        {/* 高亮覆盖层：与 textarea 完全重叠，渲染 "/指令 + 变量 + (可选) | + 后续文本"。
            为避免重影，textarea 在有 /指令 时使用 text-transparent，仅显示插入符。 */}
        {(() => {
          const parsed = parseLeadingSlash(inputValue);
          const overlayNeedsTailNewline = /\r?\n$/.test(inputValue);
          if (!parsed && (hasMentionOverlay || hasSkillMentionOverlay)) {
            // 无 / 指令时，仅做 @ 提示的淡绿色高亮（严格对齐：不添加任何额外字符/空格）
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
          const prefixText = `/${token}${prefixRaw}${hasDelimiter ? delimiterRaw : ''}`;
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
                {/* 高亮整段 /token + 变量 + 可选" | "，保持与原文本完全一致，避免光标错位 */}
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
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="开始对话吧… 输入 / 调用提示词 @ 指定MCP # 引用技能"
          className={cn(
            "relative z-[1] w-full pl-8 sm:pl-10 pr-32 sm:pr-36 py-[10px] pb-10 resize-none rounded-lg border-0 bg-transparent focus:outline-none transition-all text-sm sm:text-base min-h-[66px] placeholder:text-[12px] sm:placeholder:text-[13px] placeholder:text-gray-400/80 dark:placeholder:text-gray-400/70",
            (hasSlashOverlay || hasMentionOverlay || hasSkillMentionOverlay) ? "text-transparent caret-gray-900 dark:caret-gray-100 tabular-nums [&::selection]:bg-blue-200/30 dark:[&::selection]:bg-blue-800/30 [&::selection]:text-transparent" : "text-gray-900 dark:text-gray-100 tabular-nums"
          )}
          style={{ maxHeight: `${Math.max(MIN_INPUT_HEIGHT, maxInputHeight)}px` }}
          rows={3}
          disabled={disabled || isParsingDocument}
        />
        <McpMentionPanel
          open={mentionOpen}
          anchorRef={textareaRef as any}
          filterQuery={(inputValue.match(/@([a-zA-Z0-9_-]*)$/)?.[1] || '')}
          onSelect={(name)=>{
            const el = textareaRef.current; if (!el) return;
            const next = inputValue.replace(/@([a-zA-Z0-9_-]*)$/, `@${name} `);
            setInputValue(next);
            setTimeout(()=>{ el.selectionStart = el.selectionEnd = next.length; el.focus(); },0);
            setMentionOpen(false);
            // 显式使用 @mcp：自动切到 agent（仅此情形）
            try {
              const convId = currentConvId || conversationId || '';
              if (convId && currentToolMode === 'chat') {
                void setConversationToolMode?.(convId, 'agent');
              }
            } catch { /* ignore */ }
          }}
          onClose={()=>setMentionOpen(false)}
        />
        <SkillMentionPanel
          open={skillMentionOpen}
          anchorRef={textareaRef as any}
          filterQuery={(inputValue.match(/#([a-zA-Z0-9_-]*)$/)?.[1] || '')}
          onSelect={(skill: Skill)=>{
            const el = textareaRef.current; if (!el) return;
            // 将 #query 替换为 #skill-id，保留技能引用
            const next = inputValue.replace(/#([a-zA-Z0-9_-]*)$/, `#${skill.id} `);
            setInputValue(next);
            setTimeout(()=>{ el.selectionStart = el.selectionEnd = next.length; el.focus(); },0);
            setSkillMentionOpen(false);
            // 显式使用 #skill：自动切到 agent（仅此情形）
            try {
              const convId = currentConvId || conversationId || '';
              if (convId && currentToolMode === 'chat') {
                void setConversationToolMode?.(convId, 'agent');
              }
            } catch { /* ignore */ }
          }}
          onClose={()=>setSkillMentionOpen(false)}
        />
        {/* 左下角工具栏：模式切换 + 附件 + 搜索 + MCP + 更多 */}
        <div className="absolute left-2 sm:left-3 bottom-3 z-[2] flex items-center gap-1">
          {/* 模式选择器 */}
          <ChatModeSelector
            mode={currentToolMode as ChatMode}
            onModeChange={(mode) => {
              void setConversationToolMode?.(conversationId || '', mode);
            }}
            disabled={disabled || isLoading}
          />

          {/* 附件菜单 */}
          <AttachmentMenu
            disabled={disabled || isLoading}
            isParsingDocument={isParsingDocument}
            hasDocument={!!attachedDocument}
            selectedKnowledgeBase={selectedKnowledgeBase}
            onPickImage={() => imageInputRef.current?.click()}
            onPickDocument={() => fileInputRef.current?.click()}
            onSelectKnowledgeBase={setSelectedKnowledgeBase}
            conversationId={conversationId}
          />

          {/* 网络搜索 */}
          <WebSearchToggle
            conversationId={conversationId}
            disabled={disabled || isLoading}
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

          {/* 更多选项（会话参数） */}
          {providerName && modelId && conversationId && (
            <MoreOptionsMenu
              disabled={disabled || isLoading}
              hasSessionParameters={!!currentSessionParameters}
              canEditSessionParameters={true}
              onOpenSessionParameters={() => setSessionParametersDialogOpen(true)}
            />
          )}

          {/* 隐藏的文件输入 */}
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
        </div>
        <div className="absolute right-2 sm:right-3 bottom-3 z-[2] flex items-center gap-1.5 sm:gap-2">
       
          <div className="p-0.5 text-gray-400" title="Shift+Enter 换行">
                  <CornerDownLeft className="w-4 h-4" />
                </div>
            {/* Token 指示：放在按钮左侧，等宽数字 + 最小宽度，样式 T: 277 */}
            {tokenCount > 0 && (
              <span className="text-xs text-gray-500 mr-2 select-none font-mono tabular-nums inline-flex items-center justify-end min-w-[64px]">
                T: {tokenCount}
              </span>
            )}
            {isLoading ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 select-none">
                  <span className="relative inline-flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                  </span>
                  Agent 运行中
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onStopGeneration}
                  className="h-8 w-8 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-full"
                  title="停止（停止生成/停止工具链路）"
                >
                  <StopCircle className="w-5 h-5" />
                </Button>
              </div>
            ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSend}
                disabled={disabled || isLoading || (!inputValue.trim() && !attachedDocument)}
                className={cn(
                  "h-8 w-8 rounded-full text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-opacity",
                  (disabled || isLoading || (!inputValue.trim() && !attachedDocument)) && 'opacity-0 pointer-events-none'
                )}
              >
                <Send className="w-5 h-5" />
              </Button>
            </>
          )}
          
        </div>
      </div>

      {/* 已启用能力标签条 */}
      <ActiveCapabilitiesBar
        // 状态栏仅展示“附加内容”，搜索/MCP 入口在输入框按钮处
        webSearchEnabled={false}
        selectedKnowledgeBase={selectedKnowledgeBase}
        availableKnowledgeBases={knowledgeBaseOptions}
        onRemoveKnowledgeBase={() => setSelectedKnowledgeBase(null)}
        onSelectKnowledgeBase={(id) => {
          const kb = allKnowledgeBases.find(k => k.id === id);
          if (kb) setSelectedKnowledgeBase(kb);
        }}
        enabledMcpServers={[]}
        hasSessionParameters={!!currentSessionParameters}
        onClickSessionParameters={() => setSessionParametersDialogOpen(true)}
      />


      {/* 会话参数设置弹窗 */}
      {providerName && modelId && conversationId && (
        <SessionParametersDialog
          open={sessionParametersDialogOpen}
          onOpenChange={setSessionParametersDialogOpen}
          providerName={providerName}
          modelId={modelId}
          modelLabel={modelLabel}
          conversationId={conversationId}
          onParametersChange={onSessionParametersChange || (() => {})}
          currentParameters={currentSessionParameters}
        />
      )}
    </div>
  );
} 
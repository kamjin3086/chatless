export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  updated_at: number;
  status: 'pending' | 'sending' | 'sent' | 'error' | 'loading' | 'aborted';
  model?: string;
  thinking_duration?: number; // 思考总时长（秒）
  /** AI 思考开始的时间戳 (毫秒) */
  thinking_start_time?: number;
  
  // 文档引用信息 - 用于UI显示
  document_reference?: {
    fileName: string;
    fileType: string;
    fileSize: number;
    summary: string;
  };
  
  // 上下文数据 - 传递给AI但不在UI中直接显示
  context_data?: string;
  
  // 知识库引用信息 - 用于标记消息关联的知识库
  knowledge_base_reference?: {
    id: string;
    name: string;
  };

  /** 程序校验后的文档引用（Evidence RAG v2） */
  citations?: import('@/lib/rag/evidenceTypes').Citation[];

  /** 图片数组，base64 Data URLs */
  images?: string[];

  /** 版本化：同一用户消息下的多次回答进行分组显示 */
  version_group_id?: string;
  version_index?: number; // 0,1,2...

  /** 可选的结构化消息段（段驱动富文本渲染） */
  segments?: Array<
    | { kind: 'text'; text: string }
    | { kind: 'think'; text: string }
    | { kind: 'image'; mimeType: string; data: string }
    | {
        kind: 'toolCard';
        id: string;
        server: string;
        tool: string;
        args?: Record<string, unknown>;
        status: 'running' | 'success' | 'error' | 'pending_auth' | 'stopped';
        resultPreview?: string;
        errorMessage?: string;
        schemaHint?: string;
        messageId: string;
      }
  >;
  /** 只读视图模型，由状态机生成，供UI消费 */
  segments_vm?: MessageViewModel;

  // 兼容旧版字段
  createdAt?: never;
  updatedAt?: never;
  documentReference?: never;
  contextData?: never;
  knowledgeBaseReference?: never;
}

// —— 渲染只读模型 ——
export type VmToolStatus = 'running' | 'success' | 'error' | 'pending_auth' | 'stopped';

export interface VmTextSegment { kind: 'text'; text: string }
export interface VmThinkSegment { kind: 'think'; text: string }
export interface VmToolCardSegment {
  kind: 'toolCard';
  id: string;
  server: string;
  tool: string;
  status: VmToolStatus;
  args?: Record<string, unknown>;
  resultPreview?: string;
  errorMessage?: string;
  schemaHint?: string;
}

export interface MessageViewModel {
  items: Array<VmTextSegment | VmThinkSegment | VmToolCardSegment>;
  flags: {
    isThinking: boolean;
    isComplete: boolean;
    hasToolCalls: boolean;
  };
}

export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: Message[];
  model_id: string;
  /** 新增：精确保存 provider 名称 */
  model_provider?: string;
  /** 新增：如 provider/modelId 这样的全名 */
  model_full_id?: string;
  /** 收藏标记 */
  is_favorite: boolean;
  /**
   * (可选) 启用旧版字段兼容。如果仍有代码使用 is_starred，可通过类型兼容保证不报错。
   * 建议逐步迁移到 is_favorite 后删除。
   */
  is_starred?: boolean;
  /** AI 思考开始的时间戳 (毫秒) */
  thinking_start_time?: number;
  /** 会话级提示词应用 */
  system_prompt_applied?: {
    promptId: string;
    variableValues?: Record<string, string>;
    mode?: 'permanent' | 'temporary' | 'oneOff';
  } | null;
}

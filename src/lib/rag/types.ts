/**
 * RAG查询相关的类型定义
 */

export type {
  SourceBlock,
  SourceBlockType,
  SourceLocator,
  ParsedDocument,
  RetrievalChunk,
  Evidence,
  Citation,
} from './evidenceTypes';

/**
 * RAG查询参数
 */
export interface RAGQueryParams {
  /** 用户查询文本 */
  query: string;
  /** 知识库ID列表，如果为空则搜索所有知识库 */
  knowledgeBaseIds?: string[];
  /** 返回的相关片段数量 */
  topK?: number;
  /** 相似度阈值 */
  similarityThreshold?: number;
  /** 是否包含原始文档信息 */
  includeMetadata?: boolean;
  /** 是否流式返回结果 */
  stream?: boolean;
}

/**
 * 检索到的知识片段
 */
export interface RetrievedChunk {
  /** 片段ID */
  id: string;
  /** 片段内容 */
  content: string;
  /** 相似度分数 */
  score: number;
  /** 知识库ID */
  knowledgeBaseId: string;
  /** 知识库名称 */
  knowledgeBaseName: string;
  /** 文档ID */
  documentId?: string;
  /** 文档名称 */
  documentName?: string;
  /** 文档路径 */
  documentPath?: string;
  /** 片段在文档中的位置 */
  chunkIndex: number;
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * RAG查询结果
 */
export interface RAGQueryResult {
  /** 用户原始查询 */
  query: string;
  /** 生成的回答 */
  answer: string;
  /** 检索到的相关片段 */
  chunks: RetrievedChunk[];
  /** 可验证证据（v2） */
  evidence?: import('./evidenceTypes').Evidence[];
  /** 程序校验后的引用 */
  citations?: import('./evidenceTypes').Citation[];
  /** 查询元数据 */
  metadata: {
    /** 查询时间戳 */
    timestamp: number;
    /** 查询耗时(毫秒) */
    duration: number;
    /** 使用的知识库数量 */
    knowledgeBaseCount: number;
    /** 搜索的总片段数 */
    totalChunks: number;
    /** 使用的LLM提供者 */
    llmProvider?: string;
    /** 使用的嵌入模型 */
    embeddingModel: string;
  };
}

/**
 * 上下文构建配置
 */
export interface ContextConfig {
  /** 最大上下文长度 */
  maxContextLength: number;
  /** 片段分隔符 */
  chunkSeparator: string;
  /** 是否包含来源信息 */
  includeSource: boolean;
  /** 是否按相似度排序 */
  sortByRelevance: boolean;
}

/**
 * RAG服务配置
 */
export interface RAGConfig {
  /** 嵌入模型配置 */
  embedding: {
    strategy: 'local-onnx' | 'ollama';
    modelPath?: string;
    apiUrl?: string;
    modelName?: string;
    maxBatchSize?: number;
    timeout?: number;
  };
  /** 检索配置 */
  retrieval: {
    defaultTopK: number;
    defaultSimilarityThreshold: number;
    maxResultsPerKnowledgeBase: number;
  };
  /** 上下文构建配置 */
  context: ContextConfig;
  /** LLM配置 */
  llm?: {
    provider: string;
    model: string;
    maxTokens: number;
    temperature: number;
    apiKey?: string;
  };
}

/**
 * RAG错误类型
 */
export class RAGError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'RAGError';
  }
}

/**
 * RAG查询状态
 */
export type RAGQueryStatus = 
  | 'pending'     // 查询待处理
  | 'embedding'   // 正在生成查询嵌入
  | 'retrieving'  // 正在检索相关片段
  | 'generating'  // 正在生成回答
  | 'completed'   // 查询完成
  | 'failed';     // 查询失败

/**
 * RAG查询进度信息
 */
export interface RAGQueryProgress {
  status: RAGQueryStatus;
  message: string;
  progress: number; // 0-100
  currentStep: string;
  totalSteps: number;
  completedSteps: number;
}

/**
 * 流式RAG响应
 */
export interface RAGStreamResponse {
  type: 'progress' | 'chunk' | 'answer' | 'evidence' | 'complete' | 'error';
  data:
    | RAGQueryProgress
    | RetrievedChunk
    | string
    | RAGQueryResult
    | Error
    | import('./evidenceTypes').Evidence[]
    | import('./evidenceTypes').Citation[];
} 
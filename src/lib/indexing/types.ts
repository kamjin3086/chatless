// 索引处理相关类型定义

export interface IndexingTask {
  id: string;
  documentId: string;
  filePath: string;
  status: IndexingStatus;
  progress: number; // 0-100
  startTime?: Date;
  endTime?: Date;
  error?: string;
  chunks?: ChunkData[];
}

export enum IndexingStatus {
  PENDING = 'pending',
  EXTRACTING = 'extracting',
  CHUNKING = 'chunking',
  EMBEDDING = 'embedding',
  STORING = 'storing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface ChunkData {
  id: string;
  content: string;
  embedding?: number[];
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  documentId: string;
  chunkIndex: number;
  startPosition: number;
  endPosition: number;
  chunkType: string;
  parentDocument?: string;
  [key: string]: any;
}

export interface IndexingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  chunkingStrategy?: string;
  embeddingModel?: string;
  embeddingBudget?: import('./embeddingBudget').EmbeddingTextBudget;
  /** Internal guard when re-chunking is owned by a semantic task. */
  semanticParentTaskId?: string;
  batchSize?: number;
  maxConcurrency?: number;
  retryAttempts?: number;
  knowledgeBaseId?: string; // 知识库ID，用于关联向量存储
  progressCallback?: (task: IndexingTask) => void;
}

export interface IndexingResult {
  taskId: string;
  success: boolean;
  documentId: string;
  chunksProcessed: number;
  totalChunks: number;
  processingTime: number;
  error?: string;
}

export interface IndexingStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  averageProcessingTime: number;
  totalDocuments: number;
  totalChunks: number;
}

export class IndexingError extends Error {
  constructor(
    message: string,
    public taskId?: string,
    public documentId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'IndexingError';
  }
}

export interface ProgressTracker {
  updateProgress(taskId: string, progress: number, status: IndexingStatus): void;
  getProgress(taskId: string): number;
  getStatus(taskId: string): IndexingStatus;
  onProgress(callback: (taskId: string, progress: number, status: IndexingStatus) => void): void;
}

export interface IndexingPipeline {
  addTask(documentId: string, filePath: string, options?: IndexingOptions): Promise<string>;
  processTask(taskId: string): Promise<IndexingResult>;
  cancelTask(taskId: string): Promise<void>;
  getTasks(): IndexingTask[];
  getTaskById(taskId: string): IndexingTask | undefined;
  clearCompletedTasks(): void;
} 
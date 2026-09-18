// 资源组件统一类型定义

// 资源显示类型 - 兼容旧的Document接口
export interface ResourceDocument {
  id: string;
  title: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  lastReferencedAt?: string; // 最近被引用时间
  tags?: string; // JSON字符串，与DocumentService保持一致
  isIndexed: boolean;
  folderId?: string;
  /**
   * 文档分片数量，可选。仅在文档已被切分并入库时提供。
   */
  chunkCount?: number;
  lexicalStatus?: 'pending' | 'processing' | 'ready' | 'failed' | string;
  semanticStatus?: 'pending' | 'processing' | 'ready' | 'failed' | string;
  /**
   * 关联的知识库信息
   */
  knowledgeBases?: Array<{
    id: string;
    name: string;
    status: 'pending' | 'indexing' | 'indexed' | 'failed';
  }>;
  /**
   * 文件来源
   */
  source?: 'upload' | 'chat' | 'sample' | 'import';
  /**
   * 关联的对话ID（仅对聊天文件有效）
   */
  conversationId?: string;
}

// 资源管理器属性
export interface ResourceManagerProps {
  onRefresh?: () => Promise<void>;
  totalFileCount?: number;
  isLoadingStats?: boolean;
}

// 资源上传器属性
export interface ResourceUploaderProps {
  onUploadSuccess: () => void;
  displayType?: 'button' | 'dropzone';
}

export type ResourceListType = "documents" | "files" | "chat" | "knowledge";

// 资源列表属性
export interface ResourceListProps {
  resources: ResourceDocument[];
  type: ResourceListType;
  loading: boolean;
  onView?: (id: string) => void;
  onAddToKnowledgeBase?: (id: string) => void;
  onDelete?: (id: string) => void;
  onAddNote?: (id: string, note: string) => void;
  onComment?: (id: string) => void;
}

// 资源项目属性
export interface ResourceItemProps extends ResourceDocument {
  onView?: (id: string) => void;
  onAddToKnowledgeBase?: (id: string) => void;
  onDelete?: (id: string) => void;
  onAddNote?: (id: string) => void;
  onComment?: (id: string) => void;
}

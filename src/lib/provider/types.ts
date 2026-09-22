/**
 * Provider / Model 相关通用类型
 */
export enum ProviderStatus {
  UNKNOWN = 'UNKNOWN',
  // CONNECTING 不应该被持久化，它只是UI的临时状态
  CONNECTED = 'CONNECTED',
  NOT_CONNECTED = 'NOT_CONNECTED',
  NO_KEY = 'NO_KEY',
}

export interface ProviderEntity {
  /** 唯一标识 */
  name: string;
  /** 展示名称（可编辑），不作为主键使用 */
  displayName?: string;
  /** 服务 URL */
  url: string;
  /** 是否需要 API Key */
  requiresKey: boolean;
  /** 当前连接状态 */
  status: ProviderStatus;
  /** 最后一次状态检查时间戳 */
  lastChecked: number;
  /** Provider 级别 API Key，可为空 */
  apiKey?: string | null;
  /** 最近一次检查的失败/状态原因 */
  lastReason?: 'NO_KEY' | 'AUTH' | 'NETWORK' | 'TIMEOUT' | 'UNKNOWN';
  /** 最近一次检查的消息 */
  lastMessage?: string | null;
  /** 是否为用户新增的 Provider（用于 UI 标记） */
  isUserAdded?: boolean;
  /** 是否在 UI 中展示（不影响已配置项与缓存） */
  isVisible?: boolean;
  /** 运行时策略类型（用户新增时用于选择策略） */
  strategy?: string;
  /** 预留：头像/图标生成用的种子（稍后接入图案生成） */
  avatarSeed?: string;
  /** 高级偏好设置 */
  preferences?: {
    /** 是否使用浏览器请求方式（兜底模式） */
    useBrowserRequest?: boolean;
  };
}

export interface ModelEntity {
  provider: string;
  /** 实际模型 ID，用于请求 */
  name: string;
  /** 面向用户展示的名称；如果缺失则回退 name */
  label?: string;
  aliases: string[];
  /**
   * Context window reported by the provider (llama-swap meta、context_length…).
   * Absent means unknown, and an unknown window keeps max_tokens unsent.
   */
  contextWindow?: number;
  /** 可选：模型级别 API Key */
  apiKey?: string | null;
}

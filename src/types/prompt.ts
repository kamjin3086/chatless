export interface PromptVariableDefinition {
  key: string;
  label?: string;
  type?: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  defaultValue?: string;
  options?: string[];
}

export interface PromptItem {
  id: string;
  name: string;
  description?: string;
  content: string;
  tags?: string[];
  languages?: string[];
  modelHints?: string[];
  variables?: PromptVariableDefinition[];
  shortcuts?: string[];
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
  externalId?: string;
  stats?: { uses: number; lastUsedAt?: number };
}

export interface AppliedPromptState {
  promptId: string;
  /** 会话级变量值 */
  variableValues?: Record<string, string>;
  /** 应用模式 */
  mode?: 'permanent' | 'temporary' | 'oneOff';
}

/** 提示词修改历史记录 */
export interface PromptHistory {
  id: string;
  promptId: string;
  name: string;
  content: string;
  description?: string;
  tags?: string[];
  shortcuts?: string[];
  savedAt: number;
}


/**
 * Skills 模块类型定义
 * 
 * 用于管理 Anthropic Skills 功能
 * @see https://github.com/anthropics/skills
 */

/**
 * 技能状态
 */
export type SkillStatus =
  | 'installed'      // 已安装
  | 'needs_update'   // 需要更新
  | 'missing_deps'   // 缺少依赖
  | 'not_installed'  // 未安装
  | 'error';         // 错误状态

/**
 * 依赖项类型
 */
export type DependencyType = 'python' | 'node' | 'binary' | 'mcp_server';

/**
 * 技能依赖项
 */
export interface SkillDependency {
  type: DependencyType;
  name: string;
  version?: string;
  installed: boolean;
}

/**
 * SKILL.md frontmatter 解析结果
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  author?: string;
  dependencies?: Array<{
    python?: string;
    node?: string;
    binary?: string;
    mcp_server?: string;
  }>;
  tags?: string[];
  category?: string;
  /** Hooks 配置（用于 Agent Loop） */
  hooks?: {
    pre_execute?: string;
    post_execute?: string;
    on_error?: string;
    verify?: string;
  };
  /** 触发关键词 */
  triggers?: string[];
  /** 交互式参数定义 */
  parameters?: SkillParameter[];
}

/**
 * 技能数据模型
 */
export interface Skill {
  /** 唯一标识 (e.g., "computer-use") */
  id: string;
  /** 显示名称 */
  name: string;
  /** 简短描述 (从 SKILL.md frontmatter) */
  description: string;
  /** 版本号 */
  version: string;
  /** 来源 */
  source: 'local' | 'remote';
  /** 状态 */
  status: SkillStatus;
  /** 本地路径 */
  path?: string;
  /** 远程仓库 URL */
  repoUrl?: string;
  /** SKILL.md 完整内容 */
  skillMdContent?: string;
  /** 依赖项 */
  dependencies?: SkillDependency[];
  /** 是否启用 */
  enabled: boolean;
  /** 安装时间 */
  installedAt?: number;
  /** 作者 */
  author?: string;
  /** 标签 */
  tags?: string[];
  /** 分类 */
  category?: string;
  /** 错误信息 */
  errorMessage?: string;
  /** Hooks 配置（用于 Agent Loop） */
  hooks?: SkillHooks;
  /** 交互式参数定义 */
  parameters?: SkillParameter[];
  /** 触发关键词 */
  triggers?: string[];
}

/**
 * 技能过滤选项
 */
export interface SkillFilterOptions {
  /** 搜索关键词 */
  search?: string;
  /** 来源筛选 */
  source?: 'all' | 'local' | 'remote';
  /** 状态筛选 */
  status?: SkillStatus | 'all';
  /** 是否仅显示已启用 */
  enabledOnly?: boolean;
  /** 分类筛选 */
  category?: string;
}

/**
 * 技能安装选项
 */
export interface SkillInstallOptions {
  /** 是否覆盖现有技能 */
  overwrite?: boolean;
  /** 自定义安装路径 */
  targetPath?: string;
}

/**
 * GitHub 仓库技能信息
 */
export interface RemoteSkillInfo {
  /** 技能 ID (目录名) */
  id: string;
  /** 目录路径 */
  path: string;
  /** SKILL.md 的 raw URL */
  skillMdUrl: string;
  /** 仓库 URL */
  repoUrl: string;
  /** 最后更新时间 */
  updatedAt?: string;
}

/**
 * 技能加载器接口
 */
export interface ISkillLoader {
  /** 加载所有技能 */
  loadAll(): Promise<Skill[]>;
  /** 加载单个技能 */
  load(id: string): Promise<Skill | null>;
  /** 刷新技能列表 */
  refresh(): Promise<Skill[]>;
}

/**
 * 技能管理器配置
 */
export interface SkillManagerConfig {
  /** 本地技能目录 */
  localSkillsPath?: string;
  /** 远程仓库 URL */
  remoteRepoUrl?: string;
  /** 缓存目录 */
  cachePath?: string;
  /** 是否自动检查更新 */
  autoCheckUpdates?: boolean;
}

// ================================
// 渐进式披露 (Progressive Disclosure) 相关类型
// ================================

/**
 * 技能索引条目（用于 System Prompt 注入）
 * 
 * 每个技能仅保留名称和简短描述，约 100 tokens
 * 实现渐进式披露的第一层
 */
export interface SkillIndexEntry {
  /** 技能 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 简短描述（截断至 200 字符） */
  description: string;
  /** 触发关键词列表 */
  triggers: string[];
  /** 分类（可选） */
  category?: string;
}

/**
 * 技能 Hooks（用于 Agent Loop）
 */
export interface SkillHooks {
  /** 执行前运行的命令 */
  pre_execute?: string;
  /** 执行后运行的命令 */
  post_execute?: string;
  /** 错误时运行的命令 */
  on_error?: string;
  /** 验证命令（用于 Agent Loop） */
  verify?: string;
}

/**
 * 扩展的技能数据模型（包含渐进式披露字段）
 */
export interface SkillExtended extends Skill {
  /** 触发关键词列表（用于意图识别） */
  triggers?: string[];
  /** Hooks 配置（用于 Agent Loop） */
  hooks?: SkillHooks;
  /** 使用示例（用于 Few-shot） */
  examples?: SkillExample[];
  /** 使用场景描述 */
  whenToUse?: string;
  /** 注意事项 */
  gotchas?: string[];
}

/**
 * 技能使用示例
 */
export interface SkillExample {
  /** 示例名称 */
  name: string;
  /** 输入描述 */
  input: string;
  /** 输出描述 */
  output: string;
}

/**
 * 技能执行上下文
 */
export interface SkillExecutionContext {
  /** 会话 ID */
  conversationId: string;
  /** 消息 ID */
  messageId: string;
  /** 用户原始输入 */
  userContent: string;
  /** 反馈消息列表 */
  feedbacks: string[];
  /** 添加反馈 */
  addFeedback: (message: string) => void;
}

/**
 * 技能执行结果
 */
export interface SkillExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行时间 (ms) */
  duration?: number;
  /** 重试次数 */
  attempts?: number;
}

// ================================
// 交互式参数 (Interactive Parameters) 相关类型
// ================================

/**
 * 参数类型
 */
export type SkillParameterType = 
  | 'text'        // 单行文本
  | 'textarea'    // 多行文本
  | 'number'      // 数字
  | 'boolean'     // 布尔开关
  | 'select'      // 单选下拉
  | 'multiselect' // 多选
  | 'file'        // 文件选择
  | 'directory';  // 目录选择

/**
 * 参数选项（用于 select/multiselect）
 */
export interface SkillParameterOption {
  /** 选项值 */
  value: string;
  /** 显示标签 */
  label: string;
  /** 选项描述（可选） */
  description?: string;
}

/**
 * 参数验证规则
 */
export interface SkillParameterValidation {
  /** 最小值（number 类型） */
  min?: number;
  /** 最大值（number 类型） */
  max?: number;
  /** 最小长度（text 类型） */
  minLength?: number;
  /** 最大长度（text 类型） */
  maxLength?: number;
  /** 正则表达式（text 类型） */
  pattern?: string;
  /** 验证失败时的错误信息 */
  message?: string;
}

/**
 * 技能参数定义
 */
export interface SkillParameter {
  /** 参数名称（唯一标识） */
  name: string;
  /** 参数类型 */
  type: SkillParameterType;
  /** 显示标签 */
  label: string;
  /** 参数描述 */
  description?: string;
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default?: string | number | boolean | string[];
  /** 占位符文本 */
  placeholder?: string;
  /** 选项列表（用于 select/multiselect） */
  options?: SkillParameterOption[];
  /** 验证规则 */
  validation?: SkillParameterValidation;
  /** 是否在高级选项中显示 */
  advanced?: boolean;
  /** 条件显示（当其他参数满足条件时才显示） */
  showWhen?: {
    parameter: string;
    value: string | number | boolean;
  };
}

/**
 * 技能参数值（运行时）
 */
export type SkillParameterValues = Record<string, string | number | boolean | string[]>;

/**
 * 技能调用上下文（包含参数）
 */
export interface SkillInvocationContext {
  /** 技能 ID */
  skillId: string;
  /** 用户输入的参数值 */
  parameters?: SkillParameterValues;
  /** 用户原始消息内容 */
  userMessage?: string;
  /** 会话 ID */
  conversationId?: string;
}

// ================================
// Skill 动作执行系统 (Action Execution System)
// ================================

/**
 * 动作风险等级
 */
export type SkillRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Skill 动作类型
 * 
 * - shell: Shell/PowerShell 命令
 * - script: Python/Node.js 脚本
 * - file: 文件操作
 * - mcp_tool: 委托给 MCP 工具
 * - instruction: 纯指令（AI 自行执行）
 * - composite: 组合动作
 */
export type SkillActionType = 
  | 'shell'
  | 'script'
  | 'file'
  | 'mcp_tool'
  | 'instruction'
  | 'composite';

/**
 * 脚本运行时类型
 */
export type ScriptRuntime = 'python' | 'node' | 'bash' | 'powershell';

/**
 * 文件操作类型
 */
export type FileOperationType = 'read' | 'write' | 'delete' | 'copy' | 'move' | 'exists';

/**
 * 文件操作配置
 */
export interface SkillFileOperation {
  /** 操作类型 */
  type: FileOperationType;
  /** 源路径 */
  path: string;
  /** 文件内容（用于 write） */
  content?: string;
  /** 目标路径（用于 copy/move） */
  destination?: string;
  /** 编码（默认 utf-8） */
  encoding?: string;
}

/**
 * Skill 动作定义
 * 
 * 定义一个可执行的动作，支持多种执行类型
 */
export interface SkillAction {
  /** 动作唯一标识 */
  id: string;
  /** 动作类型 */
  type: SkillActionType;
  /** 动作名称（用于显示） */
  name: string;
  /** 动作描述 */
  description?: string;
  
  // ========== Shell/Script 通用字段 ==========
  /** 要执行的命令 */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  workingDir?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 执行超时（毫秒） */
  timeout?: number;
  
  // ========== Script 类型专用字段 ==========
  /** 脚本运行时 */
  runtime?: ScriptRuntime;
  /** 脚本文件路径（相对于 skill 目录） */
  scriptPath?: string;
  /** 内联脚本内容 */
  scriptContent?: string;
  
  // ========== File 类型专用字段 ==========
  /** 文件操作配置 */
  fileOperation?: SkillFileOperation;
  
  // ========== MCP 类型专用字段 ==========
  /** MCP 服务器名称 */
  mcpServer?: string;
  /** MCP 工具名称 */
  mcpTool?: string;
  /** MCP 工具参数 */
  mcpArgs?: Record<string, unknown>;
  
  // ========== Instruction 类型专用字段 ==========
  /** 纯指令内容（AI 自行执行） */
  instruction?: string;
  
  // ========== Composite 类型专用字段 ==========
  /** 子动作列表 */
  subActions?: SkillAction[];
  /** 子动作执行模式 */
  executionMode?: 'sequential' | 'parallel';
  
  // ========== 审批和安全配置 ==========
  /** 是否需要用户审批 */
  requiresApproval?: boolean;
  /** 风险等级 */
  riskLevel?: SkillRiskLevel;
  /** 是否可跳过 */
  skippable?: boolean;
  
  // ========== 参数模板 ==========
  /** 支持 {{variable}} 语法的参数模板列表 */
  parameterTemplates?: string[];
  
  // ========== 依赖关系 ==========
  /** 依赖的其他动作 ID 列表 */
  dependsOn?: string[];
}

/**
 * 动作执行状态
 */
export type SkillActionStatus = 
  | 'pending'       // 待执行
  | 'awaiting_approval' // 等待用户审批
  | 'approved'      // 已批准
  | 'rejected'      // 已拒绝
  | 'running'       // 执行中
  | 'completed'     // 已完成
  | 'failed'        // 失败
  | 'cancelled'     // 已取消
  | 'skipped';      // 已跳过

/**
 * Skill 动作执行结果
 */
export interface SkillActionResult {
  /** 动作 ID */
  actionId: string;
  /** 是否成功 */
  success: boolean;
  /** 执行状态 */
  status: SkillActionStatus;
  /** 标准输出 */
  stdout?: string;
  /** 标准错误 */
  stderr?: string;
  /** 执行结果（通用） */
  output?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration: number;
  /** 退出码（Shell/Script 类型） */
  exitCode?: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
}

/**
 * 待审批的 Skill 动作
 */
export interface PendingSkillAction {
  /** 请求唯一 ID */
  id: string;
  /** 技能 ID */
  skillId: string;
  /** 技能名称 */
  skillName: string;
  /** 动作定义 */
  action: SkillAction;
  /** 解析后的命令（模板替换后） */
  resolvedCommand?: string;
  /** 解析后的参数 */
  resolvedArgs?: string[];
  /** 执行上下文 */
  context: SkillExecutionContext;
  /** 创建时间 */
  createdAt: number;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 批准回调 */
  onApprove: () => void;
  /** 拒绝回调 */
  onReject: () => void;
  /** 修改后执行回调 */
  onModify?: (modifiedCommand: string) => void;
}

/**
 * Skill 动作执行上下文（运行时）
 */
export interface SkillActionExecutionContext {
  /** 执行 ID */
  executionId: string;
  /** 技能 ID */
  skillId: string;
  /** 技能路径 */
  skillPath?: string;
  /** 会话 ID */
  conversationId: string;
  /** 消息 ID */
  messageId: string;
  /** 用户原始输入 */
  userContent: string;
  /** 参数值（用于模板替换） */
  parameters: SkillParameterValues;
  /** 开始时间 */
  startTime: number;
  /** 父动作 ID（用于 composite 类型） */
  parentActionId?: string;
}

/**
 * Skill 执行计划
 */
export interface SkillExecutionPlan {
  /** 计划 ID */
  id: string;
  /** 技能 ID */
  skillId: string;
  /** 技能名称 */
  skillName: string;
  /** 动作列表 */
  actions: SkillAction[];
  /** 执行上下文 */
  context: SkillActionExecutionContext;
  /** 计划状态 */
  status: 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 当前执行的动作索引 */
  currentActionIndex: number;
  /** 动作结果列表 */
  results: SkillActionResult[];
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 是否需要用户审批才能开始 */
  requiresApproval: boolean;
  /** 用户是否已批准 */
  approved?: boolean;
}

/**
 * Skill 动作进度事件
 */
export interface SkillActionProgressEvent {
  /** 计划 ID */
  planId: string;
  /** 当前动作 */
  currentAction: SkillAction;
  /** 当前动作索引 */
  currentIndex: number;
  /** 总动作数 */
  totalActions: number;
  /** 已完成动作数 */
  completedActions: number;
  /** 进度百分比 (0-100) */
  progress: number;
  /** 当前动作状态 */
  actionStatus: SkillActionStatus;
  /** 实时输出（如果有） */
  liveOutput?: string;
}

/**
 * Skill 动作监听器
 */
export interface ISkillActionListener {
  /** 计划开始 */
  onPlanStart?: (plan: SkillExecutionPlan) => void;
  /** 动作开始 */
  onActionStart?: (action: SkillAction, plan: SkillExecutionPlan) => void;
  /** 动作等待审批 */
  onActionAwaitingApproval?: (pending: PendingSkillAction) => void;
  /** 动作完成 */
  onActionComplete?: (action: SkillAction, result: SkillActionResult, plan: SkillExecutionPlan) => void;
  /** 动作失败 */
  onActionFailed?: (action: SkillAction, error: Error, plan: SkillExecutionPlan) => void;
  /** 进度更新 */
  onProgress?: (event: SkillActionProgressEvent) => void;
  /** 实时输出 */
  onLiveOutput?: (actionId: string, output: string) => void;
  /** 计划完成 */
  onPlanComplete?: (plan: SkillExecutionPlan) => void;
  /** 计划失败 */
  onPlanFailed?: (plan: SkillExecutionPlan, error: Error) => void;
}


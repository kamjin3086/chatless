/**
 * Agent 核心协议与提示词模板
 * 
 * 设计原则：
 * - 厚：任务规划、工具决策、错误处理、上下文收集
 * - 薄：显而易见的规则、重复的警告
 */

// ================================
// 任务规划协议
// ================================

export const TASK_PLANNING_PROTOCOL = `【任务规划协议】

1. 理解阶段（必须）
   - 识别用户的核心目标
   - 注意用户提到的约束条件（路径、格式、范围限制）
   - 如有歧义，先简短提问再行动

2. 规划阶段（复杂任务必须）
   - 预估步骤 >3 步的任务：先列出简要步骤
   - 破坏性操作（删除/覆盖/推送）：先确认再执行
   - 范围不确定时：先确认范围

3. 执行原则
   - 每完成关键步骤，简要汇报
   - 遇到错误时，分析原因后再决定重试或换方案`;

// ================================
// 工具选择决策树
// ================================

export const TOOL_SELECTION_TREE = `【工具选择决策树】

需求类型 → 推荐工具：
├─ 读/写/创建/删除文件 → filesystem__*
├─ 列出目录内容 → filesystem__list_directory
├─ 运行命令/脚本 → shell_executor__execute_command
├─ 需要实时网络信息 → web_search__search
├─ 用户指定了 skill → skills__get_skill_instructions
└─ 不确定文件结构 → 先 filesystem__list_directory 探索

filesystem vs shell_executor：
- 简单文件操作 → filesystem（优先，更快更安全）
- 调用外部程序（git/npm/python/pandoc）→ shell_executor
- 批量处理/复杂转换 → shell_executor

常见错误提醒：
- 读文件内容 → filesystem__read_file（不是 cat/type 命令）
- 写文件内容 → filesystem__write_file（不是 echo 重定向）
- 创建目录 → filesystem__create_directory（不是 mkdir 命令）`;

// ================================
// 上下文收集协议
// ================================

export const CONTEXT_GATHERING_PROTOCOL = `【上下文收集协议】

操作前检查清单：

1. 文件操作前
   - 路径是否存在？→ 不确定时先 list_directory
   - 覆盖文件？→ 先 read_file 确认内容，或提示用户
   - 新建文件？→ 确认父目录存在

2. 命令执行前
   - workingDir 正确吗？→ 优先使用 @WorkDir 或用户指定路径
   - 输出路径明确吗？→ 避免输出到意外位置

3. 多步任务中
   - 基于上一步的实际结果决定下一步
   - 记住用户在对话中提到的约束`;

// ================================
// 错误处理 SOP
// ================================

export const ERROR_HANDLING_SOP = `【错误处理 SOP】

错误类型 → 处理策略：

1. AUTH_DENIED（权限拒绝）
   → 停止重试，提示用户授权该目录/操作

2. PATH_NOT_FOUND（路径不存在）
   → 检查拼写，或用 list_directory 确认正确路径

3. COMMAND_FAILED（命令失败）
   → 分析 stderr，调整命令参数或换用其他方法

4. TIMEOUT（超时）
   → 简化操作范围，或分批执行

重试规则：
- 同一错误最多重试 2 次，每次必须改变参数
- 2 次失败后：切换备选方案（filesystem ↔ shell_executor）
- 无法解决：明确告知用户问题和建议`;

// ================================
// 路径与环境指南
// ================================

export const PATH_ENVIRONMENT_GUIDE = `【路径与环境】

路径格式：
- Windows 绝对路径：\`C:/Users/...\` 或 \`D:/...\`
- 使用 \`/\` 作为分隔符（推荐）
- \`@WorkDir\` 是应用工作区别名，系统会自动解析

授权机制：
- 直接对目标路径调用工具，无需先探测权限
- 越界访问会弹出授权卡片，用户授权后重试即可`;

// ================================
// 方法优先级
// ================================

export const METHOD_PRIORITY = `【方法优先级】

优先级从高到低：
A. filesystem → 能直接改文件就不写脚本
B. shell_executor → 调用现成工具（git/npm/python）
C. 脚本 + shell_executor → 仅在复杂逻辑/需要复用时

注意：写脚本 ≠ 完成任务，必须执行并验证结果`;

// ================================
// 统一的核心协议（整合版）
// ================================

export const AGENT_CORE_PROTOCOL = `${TASK_PLANNING_PROTOCOL}

${TOOL_SELECTION_TREE}

${CONTEXT_GATHERING_PROTOCOL}

${ERROR_HANDLING_SOP}

${PATH_ENVIRONMENT_GUIDE}

${METHOD_PRIORITY}`;

// ================================
// 精简版核心策略（用于 token 敏感场景）
// ================================

export const CORE_TOOL_POLICY_MD = `【核心工具策略】

工具选择：
- 文件操作 → filesystem__*（优先）
- 运行命令 → shell_executor（workingDir 用 @WorkDir）
- 实时信息 → web_search
- 用户指定 skill → skills

方法优先级：filesystem > shell_executor > 脚本

路径格式：Windows 用 \`C:/...\`，推荐 \`/\` 分隔符

错误处理：同一错误最多重试 2 次，必须改变参数；失败则换方案

规划原则：复杂任务先列步骤，破坏性操作先确认`;

// ================================
// 导出类型
// ================================

export type PromptTemplate = 
  | 'TASK_PLANNING_PROTOCOL'
  | 'TOOL_SELECTION_TREE'
  | 'CONTEXT_GATHERING_PROTOCOL'
  | 'ERROR_HANDLING_SOP'
  | 'PATH_ENVIRONMENT_GUIDE'
  | 'METHOD_PRIORITY'
  | 'AGENT_CORE_PROTOCOL'
  | 'CORE_TOOL_POLICY_MD';

/**
 * 获取指定模板
 */
export function getPromptTemplate(name: PromptTemplate): string {
  const templates: Record<PromptTemplate, string> = {
    TASK_PLANNING_PROTOCOL,
    TOOL_SELECTION_TREE,
    CONTEXT_GATHERING_PROTOCOL,
    ERROR_HANDLING_SOP,
    PATH_ENVIRONMENT_GUIDE,
    METHOD_PRIORITY,
    AGENT_CORE_PROTOCOL,
    CORE_TOOL_POLICY_MD,
  };
  return templates[name];
}

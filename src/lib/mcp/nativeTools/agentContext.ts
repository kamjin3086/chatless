/**
 * Agent Context 工具
 * 
 * 封装文件导向工作流的核心操作，让 LLM 专注于任务本身。
 * 
 * 工具列表：
 * - ctx__save_research: 保存研究结果
 * - ctx__save_plan: 创建/更新任务计划
 * - ctx__log_error: 记录错误
 * - ctx__get: 检索上下文（研究/计划/错误）
 * - ctx__update_step: 更新计划步骤状态
 */

import type { McpTool } from '@/lib/mcp/McpClient';

export const AGENT_CONTEXT_SERVER_NAME = 'ctx';

export const CTX_SAVE_RESEARCH_TOOL: McpTool = {
  name: 'save_research',
  description: `保存研究结果到文件（避免上下文溢出）。

**何时使用**：
- 收集到大量信息时（>500字）
- 需要跨多轮对话保留的发现
- 多来源信息汇总

**自动处理**：
- 自动创建 @WorkDir/.agent/research/{topic}.md
- 自动添加时间戳
- 追加模式：同 topic 会追加到已有内容

**返回**：文件路径 + 关键发现摘要（用于上下文保留）`,
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '研究主题（用作文件名），如 "market-analysis"、"competitor-research"',
        },
        content: {
          type: 'string',
          description: '研究内容（markdown 格式），包含来源、发现、待确认项等',
        },
        source: {
          type: 'string',
          description: '信息来源（可选），如 URL、文件名',
        },
        keyFindings: {
          type: 'array',
          items: { type: 'string' },
          description: '关键发现列表（可选），用于生成摘要',
        },
      },
      required: ['topic', 'content'],
    },
  },
};

export const CTX_SAVE_PLAN_TOOL: McpTool = {
  name: 'save_plan',
  description: `创建或更新任务计划（防止目标漂移）。

**何时使用**：
- 复杂任务开始时（预估 >3 步）
- 需要跨多轮对话的任务
- 用户要求"记录过程"

**自动处理**：
- 创建 @WorkDir/.agent/todo.md
- 格式化为标准计划模板
- 支持断点续做

**返回**：计划摘要（当前步骤、进度）`,
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '任务标题（一句话描述）',
        },
        goal: {
          type: 'string',
          description: '用户的核心目标（原话或概述）',
        },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: '执行步骤列表',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: '约束条件（可选）',
        },
        risks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              risk: { type: 'string' },
              fallback: { type: 'string' },
            },
          },
          description: '风险与备选方案（可选）',
        },
      },
      required: ['title', 'goal', 'steps'],
    },
  },
};

export const CTX_LOG_ERROR_TOOL: McpTool = {
  name: 'log_error',
  description: `记录错误到日志（跨轮次学习）。

**何时使用**：
- 遇到非平凡错误时
- 需要记住的失败尝试
- 为后续操作提供参考

**自动处理**：
- 追加到 @WorkDir/.agent/errors.log
- 自动添加时间戳
- 保留最近 50 条

**返回**：确认信息`,
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: '尝试的操作描述',
        },
        error: {
          type: 'string',
          description: '错误信息',
        },
        analysis: {
          type: 'string',
          description: '错误原因分析',
        },
        resolution: {
          type: 'string',
          description: '解决方案（可选，若未解决则留空）',
        },
      },
      required: ['operation', 'error', 'analysis'],
    },
  },
};

export const CTX_GET_TOOL: McpTool = {
  name: 'get',
  description: `检索 Agent 上下文（按需加载）。

**检索类型**：
- \`plan\`: 当前任务计划（todo.md）
- \`research\`: 研究结果（指定 topic 或全部）
- \`errors\`: 错误日志（最近 N 条）
- \`status\`: 工作目录状态概览

**返回**：对应内容或摘要`,
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['plan', 'research', 'errors', 'status'],
          description: '检索类型',
        },
        topic: {
          type: 'string',
          description: '研究主题（type=research 时使用，不填则返回所有研究主题列表）',
        },
        limit: {
          type: 'number',
          description: '返回条数限制（type=errors 时使用，默认 10）',
        },
      },
      required: ['type'],
    },
  },
};

export const CTX_UPDATE_STEP_TOOL: McpTool = {
  name: 'update_step',
  description: `更新计划步骤状态。

**何时使用**：
- 完成一个步骤后
- 需要标记当前进度

**自动处理**：
- 更新 todo.md 中的步骤状态
- 添加完成时间戳
- 追加执行日志

**返回**：更新后的进度摘要`,
  input_schema: {
    schema: {
      type: 'object',
      properties: {
        stepIndex: {
          type: 'number',
          description: '步骤索引（从 1 开始）',
        },
        status: {
          type: 'string',
          enum: ['done', 'failed', 'skipped', 'in_progress'],
          description: '步骤状态',
        },
        note: {
          type: 'string',
          description: '执行备注（可选）',
        },
      },
      required: ['stepIndex', 'status'],
    },
  },
};

export const AGENT_CONTEXT_TOOLS: McpTool[] = [
  CTX_SAVE_RESEARCH_TOOL,
  CTX_SAVE_PLAN_TOOL,
  CTX_LOG_ERROR_TOOL,
  CTX_GET_TOOL,
  CTX_UPDATE_STEP_TOOL,
];

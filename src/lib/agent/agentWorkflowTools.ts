/**
 * Agent 工作流工具
 * 
 * 专门用于文件导向工作流的工具集：
 * - 创建/更新任务计划
 * - 保存研究结果
 * - 记录错误日志
 * - 检查未完成任务
 * 
 * 这些工具帮助 LLM 更自然地使用文件作为外部记忆
 */

import { writeFile, readTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

// 工作目录常量
const AGENT_DIR_NAME = '.agent';

/**
 * 工具定义接口
 */
export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, {
    type: 'string' | 'number' | 'boolean';
    description: string;
    required?: boolean;
  }>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * 确保 agent 工作目录存在
 */
async function ensureAgentDir(): Promise<string> {
  const dataDir = await appDataDir();
  const agentDir = await join(dataDir, AGENT_DIR_NAME);
  
  try {
    const dirExists = await exists(agentDir);
    if (!dirExists) {
      await mkdir(agentDir, { recursive: true });
    }
  } catch {
    // 目录可能已存在，忽略错误
  }
  
  return agentDir;
}

/**
 * 创建任务计划
 * 
 * 在 @WorkDir/.agent/todo.md 创建任务计划文件
 */
async function createTaskPlan(params: {
  taskTitle: string;
  goal: string;
  constraints?: string;
  steps: string[];
  risks?: string;
}): Promise<{
  success: boolean;
  path: string;
  message: string;
}> {
  const { taskTitle, goal, constraints, steps, risks } = params;
  
  if (!taskTitle || !steps || steps.length === 0) {
    return {
      success: false,
      path: '',
      message: 'Error: taskTitle and at least one step are required',
    };
  }

  try {
    const agentDir = await ensureAgentDir();
    const todoPath = await join(agentDir, 'todo.md');
    const timestamp = new Date().toISOString();
    
    // 生成 todo.md 内容
    const stepsFormatted = steps.map((step, i) => `${i + 1}. [ ] ${step}`).join('\n');
    
    const content = `# 任务：${taskTitle}
创建时间：${timestamp}
状态：进行中

## 目标
${goal}

${constraints ? `## 约束条件\n${constraints}\n` : ''}
## 执行计划
${stepsFormatted}

${risks ? `## 风险与备选\n${risks}\n` : ''}
## 执行日志
`;

    await writeFile(todoPath, new TextEncoder().encode(content));
    
    return {
      success: true,
      path: todoPath,
      message: `任务计划已创建：${todoPath}`,
    };
  } catch (error) {
    return {
      success: false,
      path: '',
      message: `Error creating task plan: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 更新任务进度
 * 
 * 更新 todo.md 中的步骤状态和执行日志
 */
async function updateTaskProgress(params: {
  stepNumber: number;
  status: 'completed' | 'failed' | 'skipped';
  result?: string;
}): Promise<{
  success: boolean;
  message: string;
}> {
  const { stepNumber, status, result } = params;
  
  if (!stepNumber || !status) {
    return {
      success: false,
      message: 'Error: stepNumber and status are required',
    };
  }

  try {
    const agentDir = await ensureAgentDir();
    const todoPath = await join(agentDir, 'todo.md');
    
    // 读取当前内容
    let content: string;
    try {
      content = await readTextFile(todoPath);
    } catch {
      return {
        success: false,
        message: 'Error: todo.md not found. Create a task plan first using create_task_plan.',
      };
    }
    
    // 更新步骤状态
    const statusMark = status === 'completed' ? 'x' : status === 'failed' ? '!' : '-';
    const pattern = new RegExp(`^(${stepNumber}\\.)\\s*\\[\\s*\\]`, 'm');
    content = content.replace(pattern, `$1 [${statusMark}]`);
    
    // 添加执行日志
    const timestamp = new Date().toISOString();
    const logEntry = `\n### ${timestamp}\n- 步骤 ${stepNumber}：${status}\n${result ? `- 结果：${result}\n` : ''}`;
    content = content + logEntry;
    
    await writeFile(todoPath, new TextEncoder().encode(content));
    
    return {
      success: true,
      message: `步骤 ${stepNumber} 已标记为 ${status}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error updating progress: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 保存研究结果
 * 
 * 将研究结果保存到 @WorkDir/.agent/research/{topic}.md
 */
async function saveResearch(params: {
  topic: string;
  content: string;
  append?: boolean;
}): Promise<{
  success: boolean;
  path: string;
  message: string;
}> {
  const { topic, content, append = false } = params;
  
  if (!topic || !content) {
    return {
      success: false,
      path: '',
      message: 'Error: topic and content are required',
    };
  }

  try {
    const agentDir = await ensureAgentDir();
    const researchDir = await join(agentDir, 'research');
    
    // 确保 research 目录存在
    try {
      const dirExists = await exists(researchDir);
      if (!dirExists) {
        await mkdir(researchDir, { recursive: true });
      }
    } catch {
      // 目录可能已存在
    }
    
    // 安全的文件名
    const safeTopic = topic.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 50);
    const filePath = await join(researchDir, `${safeTopic}.md`);
    const timestamp = new Date().toISOString();
    
    if (append) {
      // 追加模式
      let existingContent = '';
      try {
        existingContent = await readTextFile(filePath);
      } catch {
        // 文件不存在，创建新文件
        existingContent = `# 研究：${topic}\n创建时间：${timestamp}\n\n## 收集的信息\n`;
      }
      
      const newContent = existingContent + `\n### ${timestamp}\n${content}\n`;
      await writeFile(filePath, new TextEncoder().encode(newContent));
    } else {
      // 覆盖模式
      const newContent = `# 研究：${topic}
创建时间：${timestamp}
更新时间：${timestamp}

## 收集的信息
${content}
`;
      await writeFile(filePath, new TextEncoder().encode(newContent));
    }
    
    return {
      success: true,
      path: filePath,
      message: `研究结果已${append ? '追加' : '保存'}到：${filePath}`,
    };
  } catch (error) {
    return {
      success: false,
      path: '',
      message: `Error saving research: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 记录错误日志
 * 
 * 将错误追加到 @WorkDir/.agent/errors.log
 */
async function logError(params: {
  operation: string;
  error: string;
  analysis?: string;
  resolution?: string;
}): Promise<{
  success: boolean;
  message: string;
}> {
  const { operation, error, analysis, resolution } = params;
  
  if (!operation || !error) {
    return {
      success: false,
      message: 'Error: operation and error are required',
    };
  }

  try {
    const agentDir = await ensureAgentDir();
    const errorLogPath = await join(agentDir, 'errors.log');
    const timestamp = new Date().toISOString();
    
    // 读取现有内容
    let existingContent = '';
    try {
      existingContent = await readTextFile(errorLogPath);
    } catch {
      // 文件不存在
    }
    
    // 追加新错误
    const entry = `[${timestamp}]
操作：${operation}
错误：${error}
${analysis ? `原因：${analysis}\n` : ''}${resolution ? `解决：${resolution}\n` : ''}---
`;
    
    await writeFile(errorLogPath, new TextEncoder().encode(existingContent + entry));
    
    return {
      success: true,
      message: '错误已记录',
    };
  } catch (err) {
    return {
      success: false,
      message: `Error logging: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 检查未完成任务
 * 
 * 检查 @WorkDir/.agent/todo.md 是否存在未完成的任务
 */
async function checkPendingTask(): Promise<{
  hasPendingTask: boolean;
  taskTitle?: string;
  progress?: string;
  currentStep?: string;
  path?: string;
  message: string;
}> {
  try {
    const agentDir = await ensureAgentDir();
    const todoPath = await join(agentDir, 'todo.md');
    
    let content: string;
    try {
      content = await readTextFile(todoPath);
    } catch {
      return {
        hasPendingTask: false,
        message: '没有找到未完成的任务',
      };
    }
    
    // 检查状态
    const statusMatch = content.match(/状态：(.+)/);
    const status = statusMatch?.[1]?.trim() || '';
    
    if (status === '已完成' || status === '已暂停') {
      return {
        hasPendingTask: false,
        message: `任务状态：${status}`,
      };
    }
    
    // 提取任务信息
    const titleMatch = content.match(/# 任务：(.+)/);
    const taskTitle = titleMatch?.[1]?.trim() || '未命名任务';
    
    // 统计进度
    const totalSteps = (content.match(/^\d+\.\s*\[/gm) || []).length;
    const completedSteps = (content.match(/^\d+\.\s*\[x\]/gm) || []).length;
    const progress = `${completedSteps}/${totalSteps}`;
    
    // 找到当前步骤（第一个未完成的）
    const currentStepMatch = content.match(/^\d+\.\s*\[\s*\]\s*(.+)/m);
    const currentStep = currentStepMatch?.[1]?.trim() || '(无)';
    
    return {
      hasPendingTask: true,
      taskTitle,
      progress,
      currentStep,
      path: todoPath,
      message: `发现未完成任务：${taskTitle}，进度 ${progress}，当前步骤：${currentStep}`,
    };
  } catch (error) {
    return {
      hasPendingTask: false,
      message: `Error checking pending task: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Agent 工作流工具集合
 */
export const agentWorkflowTools: AgentToolDefinition[] = [
  {
    name: 'create_task_plan',
    description: '创建任务计划文件（@WorkDir/.agent/todo.md）。用于复杂任务（>5步）的规划和追踪。',
    parameters: {
      taskTitle: {
        type: 'string',
        description: '任务标题（简短描述）',
        required: true,
      },
      goal: {
        type: 'string',
        description: '用户目标（原话引用）',
        required: true,
      },
      constraints: {
        type: 'string',
        description: '约束条件（可选）',
        required: false,
      },
      steps: {
        type: 'string',
        description: '执行步骤列表（JSON 数组格式，如 ["步骤1", "步骤2"]）',
        required: true,
      },
      risks: {
        type: 'string',
        description: '风险与备选方案（可选）',
        required: false,
      },
    },
    handler: async (params) => {
      const steps = typeof params.steps === 'string' 
        ? JSON.parse(params.steps) 
        : params.steps;
      return createTaskPlan({
        taskTitle: params.taskTitle as string,
        goal: params.goal as string,
        constraints: params.constraints as string | undefined,
        steps: steps as string[],
        risks: params.risks as string | undefined,
      });
    },
  },
  {
    name: 'update_task_progress',
    description: '更新任务进度。标记步骤完成/失败/跳过，并记录执行日志。',
    parameters: {
      stepNumber: {
        type: 'number',
        description: '步骤编号（从 1 开始）',
        required: true,
      },
      status: {
        type: 'string',
        description: '状态：completed/failed/skipped',
        required: true,
      },
      result: {
        type: 'string',
        description: '执行结果说明（可选）',
        required: false,
      },
    },
    handler: async (params) => updateTaskProgress({
      stepNumber: params.stepNumber as number,
      status: params.status as 'completed' | 'failed' | 'skipped',
      result: params.result as string | undefined,
    }),
  },
  {
    name: 'save_research',
    description: '保存研究结果到文件（@WorkDir/.agent/research/{topic}.md）。避免上下文溢出，支持按需读取。',
    parameters: {
      topic: {
        type: 'string',
        description: '研究主题（用于文件名）',
        required: true,
      },
      content: {
        type: 'string',
        description: '研究内容（Markdown 格式）',
        required: true,
      },
      append: {
        type: 'boolean',
        description: '是否追加模式（默认 false，覆盖）',
        required: false,
      },
    },
    handler: async (params) => saveResearch({
      topic: params.topic as string,
      content: params.content as string,
      append: params.append as boolean | undefined,
    }),
  },
  {
    name: 'log_error',
    description: '记录错误到日志文件（@WorkDir/.agent/errors.log）。支持跨轮次学习，避免重复踩坑。',
    parameters: {
      operation: {
        type: 'string',
        description: '操作描述',
        required: true,
      },
      error: {
        type: 'string',
        description: '错误信息',
        required: true,
      },
      analysis: {
        type: 'string',
        description: '原因分析（可选）',
        required: false,
      },
      resolution: {
        type: 'string',
        description: '解决方案（可选）',
        required: false,
      },
    },
    handler: async (params) => logError({
      operation: params.operation as string,
      error: params.error as string,
      analysis: params.analysis as string | undefined,
      resolution: params.resolution as string | undefined,
    }),
  },
  {
    name: 'check_pending_task',
    description: '检查是否有未完成的任务。用于会话恢复时检测断点。',
    parameters: {},
    handler: async () => checkPendingTask(),
  },
];

/**
 * 获取 Agent 工作流工具的 JSON Schema 定义
 */
export function getAgentWorkflowToolsSchema(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}> {
  return agentWorkflowTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: `agent__${tool.name}`,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters
          ? Object.fromEntries(
              Object.entries(tool.parameters).map(([key, value]) => [
                key,
                { type: value.type, description: value.description },
              ])
            )
          : {},
        required: tool.parameters
          ? Object.entries(tool.parameters)
              .filter(([, value]) => value.required)
              .map(([key]) => key)
          : [],
      },
    },
  }));
}

/**
 * 执行 Agent 工作流工具
 */
export async function executeAgentWorkflowTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  // 移除 agent__ 前缀
  const name = toolName.replace(/^agent__/, '');
  const tool = agentWorkflowTools.find(t => t.name === name);
  
  if (!tool) {
    throw new Error(`Unknown agent workflow tool: ${toolName}`);
  }
  
  return tool.handler(params);
}

/**
 * 检查是否为 Agent 工作流工具
 */
export function isAgentWorkflowTool(toolName: string): boolean {
  const name = toolName.replace(/^agent__/, '');
  return agentWorkflowTools.some(t => t.name === name);
}

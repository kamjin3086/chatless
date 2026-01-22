/**
 * Skill 动作路由器
 * 
 * 根据动作类型分发到对应的执行器
 * 支持参数模板替换和执行上下文管理
 */

import type {
  SkillAction,
  SkillActionType,
  SkillActionResult,
  SkillActionExecutionContext,
  SkillParameterValues,
  SkillActionStatus,
} from './types';
import { getProcessSandbox } from './sandbox';

/**
 * 动作执行器接口
 */
export interface IActionExecutor {
  /** 执行器类型 */
  readonly type: SkillActionType;
  
  /** 检查是否可用 */
  isAvailable(): Promise<boolean>;
  
  /** 执行动作 */
  execute(
    action: SkillAction,
    context: SkillActionExecutionContext,
    resolvedCommand?: string,
    resolvedArgs?: string[]
  ): Promise<SkillActionResult>;
  
  /** 取消执行 */
  cancel?(executionId: string): Promise<boolean>;
}

/**
 * Shell 执行器
 * 使用 ProcessSandbox 执行 Shell 命令
 */
class ShellExecutor implements IActionExecutor {
  readonly type: SkillActionType = 'shell';

  async isAvailable(): Promise<boolean> {
    const sandbox = getProcessSandbox();
    return sandbox.isAvailable();
  }

  async execute(
    action: SkillAction,
    context: SkillActionExecutionContext,
    resolvedCommand?: string,
    resolvedArgs?: string[]
  ): Promise<SkillActionResult> {
    const startTime = Date.now();
    
    try {
      const sandbox = getProcessSandbox();
      const isAvailable = await sandbox.isAvailable();
      
      if (!isAvailable) {
        return {
          actionId: action.id,
          success: false,
          status: 'failed',
          error: 'Shell 执行器不可用',
          duration: Date.now() - startTime,
        };
      }

      const command = resolvedCommand || action.command || '';
      const args = resolvedArgs || action.args || [];
      
      const result = await sandbox.execute({
        command,
        args,
        workingDir: action.workingDir || context.skillPath,
        timeoutMs: action.timeout || 30000,
        env: action.env,
      });

      return {
        actionId: action.id,
        success: result.success,
        status: result.success ? 'completed' : 'failed',
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        error: result.error,
        duration: result.duration,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    }
  }
}

/**
 * 脚本执行器
 * 支持 Python 和 Node.js 脚本执行
 */
class ScriptExecutor implements IActionExecutor {
  readonly type: SkillActionType = 'script';

  async isAvailable(): Promise<boolean> {
    const sandbox = getProcessSandbox();
    return sandbox.isAvailable();
  }

  async execute(
    action: SkillAction,
    context: SkillActionExecutionContext,
    resolvedCommand?: string,
    resolvedArgs?: string[]
  ): Promise<SkillActionResult> {
    const startTime = Date.now();

    try {
      const sandbox = getProcessSandbox();
      const isAvailable = await sandbox.isAvailable();

      if (!isAvailable) {
        return {
          actionId: action.id,
          success: false,
          status: 'failed',
          error: '脚本执行器不可用',
          duration: Date.now() - startTime,
        };
      }

      // 构建脚本执行命令
      const runtime = action.runtime || 'python';
      let command: string;
      let args: string[];

      if (action.scriptPath) {
        // 执行脚本文件
        const scriptFullPath = action.scriptPath.startsWith('/')
          ? action.scriptPath
          : `${context.skillPath || '.'}/${action.scriptPath}`;
        
        switch (runtime) {
          case 'python':
            command = 'python';
            args = [scriptFullPath, ...(resolvedArgs || action.args || [])];
            break;
          case 'node':
            command = 'node';
            args = [scriptFullPath, ...(resolvedArgs || action.args || [])];
            break;
          case 'bash':
            command = 'bash';
            args = [scriptFullPath, ...(resolvedArgs || action.args || [])];
            break;
          case 'powershell':
            command = 'powershell';
            args = ['-File', scriptFullPath, ...(resolvedArgs || action.args || [])];
            break;
          default:
            command = runtime;
            args = [scriptFullPath, ...(resolvedArgs || action.args || [])];
        }
      } else if (action.scriptContent) {
        // 内联脚本执行
        switch (runtime) {
          case 'python':
            command = 'python';
            args = ['-c', action.scriptContent];
            break;
          case 'node':
            command = 'node';
            args = ['-e', action.scriptContent];
            break;
          case 'bash':
            command = 'bash';
            args = ['-c', action.scriptContent];
            break;
          case 'powershell':
            command = 'powershell';
            args = ['-Command', action.scriptContent];
            break;
          default:
            return {
              actionId: action.id,
              success: false,
              status: 'failed',
              error: `不支持的脚本运行时: ${runtime}`,
              duration: Date.now() - startTime,
            };
        }
      } else if (resolvedCommand || action.command) {
        // 使用 command 字段
        command = resolvedCommand || action.command || '';
        args = resolvedArgs || action.args || [];
      } else {
        return {
          actionId: action.id,
          success: false,
          status: 'failed',
          error: '脚本动作缺少 scriptPath、scriptContent 或 command',
          duration: Date.now() - startTime,
        };
      }

      const result = await sandbox.execute({
        command,
        args,
        workingDir: action.workingDir || context.skillPath,
        timeoutMs: action.timeout || 60000, // 脚本默认 60 秒超时
        env: action.env,
      });

      return {
        actionId: action.id,
        success: result.success,
        status: result.success ? 'completed' : 'failed',
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        error: result.error,
        duration: result.duration,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    }
  }
}

/**
 * 文件操作执行器
 * 使用 Tauri 文件系统 API
 */
class FileExecutor implements IActionExecutor {
  readonly type: SkillActionType = 'file';

  async isAvailable(): Promise<boolean> {
    try {
      // 检查是否在 Tauri 环境中
      await import('@tauri-apps/plugin-fs');
      return true;
    } catch {
      return false;
    }
  }

  async execute(
    action: SkillAction,
    context: SkillActionExecutionContext
  ): Promise<SkillActionResult> {
    const startTime = Date.now();

    try {
      if (!action.fileOperation) {
        return {
          actionId: action.id,
          success: false,
          status: 'failed',
          error: '文件操作动作缺少 fileOperation 配置',
          duration: Date.now() - startTime,
        };
      }

      const { readTextFile, writeTextFile, remove, copyFile, rename, exists } = 
        await import('@tauri-apps/plugin-fs');
      
      const { type, path, content, destination } = action.fileOperation;
      let output: unknown;

      switch (type) {
        case 'read':
          output = await readTextFile(path);
          break;
        case 'write':
          await writeTextFile(path, content || '');
          output = `文件已写入: ${path}`;
          break;
        case 'delete':
          await remove(path);
          output = `文件已删除: ${path}`;
          break;
        case 'copy':
          if (!destination) {
            throw new Error('复制操作需要 destination 参数');
          }
          await copyFile(path, destination);
          output = `文件已复制: ${path} -> ${destination}`;
          break;
        case 'move':
          if (!destination) {
            throw new Error('移动操作需要 destination 参数');
          }
          await rename(path, destination);
          output = `文件已移动: ${path} -> ${destination}`;
          break;
        case 'exists':
          output = await exists(path);
          break;
        default:
          throw new Error(`不支持的文件操作类型: ${type}`);
      }

      return {
        actionId: action.id,
        success: true,
        status: 'completed',
        output,
        stdout: typeof output === 'string' ? output : JSON.stringify(output),
        duration: Date.now() - startTime,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    }
  }
}

/**
 * MCP 桥接执行器
 * 委托给 MCP 工具系统执行
 */
class McpBridgeExecutor implements IActionExecutor {
  readonly type: SkillActionType = 'mcp_tool';

  async isAvailable(): Promise<boolean> {
    // MCP 桥接总是可用，实际可用性由 MCP 系统判断
    return true;
  }

  async execute(
    action: SkillAction,
    context: SkillActionExecutionContext
  ): Promise<SkillActionResult> {
    const startTime = Date.now();

    try {
      if (!action.mcpServer || !action.mcpTool) {
        return {
          actionId: action.id,
          success: false,
          status: 'failed',
          error: 'MCP 动作缺少 mcpServer 或 mcpTool 配置',
          duration: Date.now() - startTime,
        };
      }

      // 动态导入 MCP 执行器
      const { executeToolCall } = await import('@/lib/mcp/ToolCallOrchestrator');
      
      // 调用 MCP 工具
      await executeToolCall(
        action.mcpServer,
        action.mcpTool,
        action.mcpArgs || {},
        context.messageId,
        undefined, // cardId
        {
          provider: 'openai', // 默认
          model: 'gpt-4',
          conversationId: context.conversationId,
          historyForLlm: [],
          originalUserContent: context.userContent,
        }
      );

      // 注意：MCP 执行是异步的，这里只表示调用已发起
      return {
        actionId: action.id,
        success: true,
        status: 'completed',
        output: `MCP 工具已调用: ${action.mcpServer}.${action.mcpTool}`,
        duration: Date.now() - startTime,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        startedAt: startTime,
        completedAt: Date.now(),
      };
    }
  }
}

/**
 * 指令执行器
 * 纯指令类型，不执行任何操作，只返回指令内容
 */
class InstructionExecutor implements IActionExecutor {
  readonly type: SkillActionType = 'instruction';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(
    action: SkillAction,
    _context: SkillActionExecutionContext
  ): Promise<SkillActionResult> {
    const startTime = Date.now();

    return {
      actionId: action.id,
      success: true,
      status: 'completed',
      output: action.instruction || action.description,
      stdout: action.instruction || action.description,
      duration: Date.now() - startTime,
      startedAt: startTime,
      completedAt: Date.now(),
    };
  }
}

/**
 * 动作路由器
 * 
 * 负责根据动作类型分发到对应的执行器
 */
export class ActionRouter {
  private executors: Map<SkillActionType, IActionExecutor> = new Map();

  constructor() {
    // 注册内置执行器
    this.registerExecutor(new ShellExecutor());
    this.registerExecutor(new ScriptExecutor());
    this.registerExecutor(new FileExecutor());
    this.registerExecutor(new McpBridgeExecutor());
    this.registerExecutor(new InstructionExecutor());
  }

  /**
   * 注册执行器
   */
  registerExecutor(executor: IActionExecutor): void {
    this.executors.set(executor.type, executor);
  }

  /**
   * 获取执行器
   */
  getExecutor(type: SkillActionType): IActionExecutor | undefined {
    return this.executors.get(type);
  }

  /**
   * 检查执行器是否可用
   */
  async isExecutorAvailable(type: SkillActionType): Promise<boolean> {
    const executor = this.executors.get(type);
    if (!executor) {
      return false;
    }
    return executor.isAvailable();
  }

  /**
   * 执行动作
   */
  async execute(
    action: SkillAction,
    context: SkillActionExecutionContext,
    resolvedCommand?: string,
    resolvedArgs?: string[]
  ): Promise<SkillActionResult> {
    const executor = this.executors.get(action.type);
    
    if (!executor) {
      return {
        actionId: action.id,
        success: false,
        status: 'failed',
        error: `未知的动作类型: ${action.type}`,
        duration: 0,
      };
    }

    const isAvailable = await executor.isAvailable();
    if (!isAvailable) {
      return {
        actionId: action.id,
        success: false,
        status: 'failed',
        error: `执行器不可用: ${action.type}`,
        duration: 0,
      };
    }

    return executor.execute(action, context, resolvedCommand, resolvedArgs);
  }

  /**
   * 解析参数模板
   * 
   * 支持 {{variable}} 语法
   */
  resolveTemplate(
    template: string,
    parameters: SkillParameterValues,
    context: SkillActionExecutionContext
  ): string {
    let resolved = template;

    // 替换上下文变量
    const contextVars: Record<string, string> = {
      skill_path: context.skillPath || '.',
      skill_id: context.skillId,
      conversation_id: context.conversationId,
      message_id: context.messageId,
      user_content: context.userContent,
    };

    for (const [key, value] of Object.entries(contextVars)) {
      resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    // 替换用户参数
    for (const [key, value] of Object.entries(parameters)) {
      const strValue = Array.isArray(value) ? value.join(' ') : String(value);
      resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), strValue);
    }

    return resolved;
  }

  /**
   * 解析动作的命令和参数
   */
  resolveAction(
    action: SkillAction,
    parameters: SkillParameterValues,
    context: SkillActionExecutionContext
  ): { resolvedCommand?: string; resolvedArgs?: string[] } {
    let resolvedCommand: string | undefined;
    let resolvedArgs: string[] | undefined;

    if (action.command) {
      resolvedCommand = this.resolveTemplate(action.command, parameters, context);
    }

    if (action.args) {
      resolvedArgs = action.args.map(arg => 
        this.resolveTemplate(arg, parameters, context)
      );
    }

    return { resolvedCommand, resolvedArgs };
  }
}

// 单例实例
let routerInstance: ActionRouter | null = null;

/**
 * 获取 ActionRouter 单例
 */
export function getActionRouter(): ActionRouter {
  if (!routerInstance) {
    routerInstance = new ActionRouter();
  }
  return routerInstance;
}

/**
 * 重置 ActionRouter（用于测试）
 */
export function resetActionRouter(): void {
  routerInstance = null;
}


/**
 * 统一的提示词构建器
 * 
 * ## 设计目标
 * 
 * 提供统一的提示词构建接口，合并分散的提示词生成逻辑。
 * 
 * ## 核心优化
 * 
 * 1. **消息合并**: 将多条 system 消息合并为结构化的少数消息
 * 2. **分阶段策略**: 初始调用、追问阶段使用不同的提示词策略
 * 3. **避免重复**: 追问阶段不重复注入已有的工具描述
 */

import type { InjectionContext, InjectionResult, InjectionSignals, NativeToolDefinition } from './types';
import { MCPPrompts } from '@/lib/prompts/SystemPrompts';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { FILESYSTEM_SERVER_NAME, FILESYSTEM_TOOLS } from '@/lib/mcp/nativeTools/filesystem';
import { SHELL_EXECUTOR_SERVER_NAME, SHELL_EXECUTOR_TOOLS } from '@/lib/mcp/nativeTools/shellExecutor';
import { persistentCache } from '../persistentCache';
import { getConnectedServers, getGlobalEnabledServers, getAllConfiguredServers } from '../chatIntegration';
import { skillTools } from '@/lib/skills/skillTools';
import { getSkillManager } from '@/lib/skills';
import { shouldUseNativeToolCalls, getToolCallStrategy } from '@/lib/llm/types/tool-capability';

/**
 * 构建初始调用阶段的提示词
 * 
 * ## 条件降级策略
 * 
 * 1. 如果 Provider/模型支持原生工具调用 API：
 *    - 不注入详细的工具描述到 System Prompt
 *    - 工具定义通过 API 的 tools 参数传递
 *    - 返回 useNativeTools: true
 * 
 * 2. 如果不支持原生工具调用：
 *    - 注入完整的工具描述到 System Prompt
 *    - 依赖正则解析提取工具调用
 *    - 返回 useNativeTools: false
 */
export async function buildInitialPrompt(
  context: InjectionContext,
  signals: InjectionSignals
): Promise<InjectionResult> {
  const messages: Array<{ role: 'system'; content: string }> = [];
  const enabledServers: string[] = [];
  
  // 检测是否应该使用原生工具调用
  const providerName = context.providerName || '';
  const modelName = context.modelName || '';
  const useNativeTools = shouldUseNativeToolCalls(providerName, modelName);
  const toolStrategy = getToolCallStrategy(providerName, modelName);

  // Native-only：不再支持 Prompt 注入 + 文本解析工具调用
  if (!useNativeTools) {
    throw new Error(
      `Native tool calling is required but not supported by provider/model: ${providerName}/${modelName || 'unknown'}`
    );
  }
  
  // 1. 时间上下文（高优先级）
  await injectTimeContext(messages, context.userContent, signals.isTimeRelated);
  
  // 2. 获取启用的服务器
  const connected = await getConnectedServers();
  const globalEnabled = await getGlobalEnabledServers();
  let enabled = connected.filter(n => globalEnabled.includes(n));
  
  // 3. 处理 @mention 的服务器
  if (signals.hasExplicitMention && signals.mentionedServers.length > 0) {
    const all = await getAllConfiguredServers();
    const serverMap = new Map(all.map(n => [n.toLowerCase(), n] as const));
    
    const mentionedEnabled = signals.mentionedServers
      .map(n => serverMap.get(n.toLowerCase()))
      .filter((n): n is string => Boolean(n))
      .filter(n => globalEnabled.includes(n));
    
    if (mentionedEnabled.length > 0) {
      // 预连接被 @mention 的服务器
      try {
        await persistentCache.preconnectServers(mentionedEnabled);
      } catch (error) {
        console.warn('[InjectionManager] 预连接失败:', error);
      }
      
      enabled = Array.from(new Set([...mentionedEnabled, ...enabled]));
    }
  }
  
  enabledServers.push(...enabled);
  
  // 4. 构建工具信息（仅在不支持原生工具调用时注入）
  const toolInfoParts: string[] = [];
  
  // 构建原生工具定义（Native-only）
  const nativeTools: InjectionResult['nativeTools'] = await buildNativeToolDefinitions(enabled, signals.webSearchEnabled);

  // 使用原生工具调用时，只注入简化的协议说明
  messages.push({
    role: 'system',
    content: `你可以通过工具调用来获取信息或执行操作。必须使用结构化 tool calling；不要输出任何 XML/标签格式的工具指令文本。

【文件系统工具选择（重要）】
- 所有文件/目录的读取、写入与列目录：**统一使用 \`${FILESYSTEM_SERVER_NAME}__*\`（filesystem）**。
- 路径既可以使用绝对路径（如 \`D:/path/file.txt\`），也可以使用别名路径（如 \`@WorkDir/...\` 或用户配置的 \`@Alias/...\`）。
- 当访问的路径不在白名单目录内时，会要求用户确认；确认后会把目录加入白名单以便后续自动执行。
- **不要为了“探测权限/白名单范围”而先列目录或尝试查询授权列表**：直接使用目标路径作为参数调用 filesystem；若越界系统会弹出授权卡片由用户决定。

【输出目录默认规则（重要）】
- skills 目录（安装的技能包所在目录）**不是**用户文件的临时目录/输出目录。除非用户明确要求“修改/维护 skill 本身”，否则**禁止**把生成的文档/脚本/临时文件写到 skills 目录下。
- 当用户对保存位置描述含糊时，默认把脚本/临时文件/产物写到 **@WorkDir（应用 AppData 工作区）** 下（通常为 \`@WorkDir/work\` 与 \`@WorkDir/out\`）。只有用户明确要求导出到 Documents/其他目录时，才申请白名单并写入该目录。

【方法选择策略（重要，避免简单问题复杂化）】
- A（优先）filesystem：直接读写/创建/移动/删除文件与目录，适合绝大多数“简单文件操作”。能用 A 完成就不要写脚本。
- B（其次）shell_executor：当需要现成工具的一次性转换/批处理（例如 unzip/pandoc/git 等）时使用；命令应短、可复现，workingDir 默认使用 @WorkDir。
- C（最后）脚本 + shell_executor：仅在需要复杂逻辑（循环/条件/多文件批处理）、需要复用、或需要强验证/报告时使用。写脚本≠完成：必须执行并用 filesystem 验证关键产物后再交付。

【Skills 遵从策略（强制）】
- 一旦你选择/引用了某个 skill（调用了 \`skills.get_skill_instructions\` 并获得指南），该指南视为**绝对主教程**：必须优先遵循；你的常识与网络搜索只能作为**辅助**，不得与指南冲突。
- 目标是完成用户任务而不是“读完指南就结束”。你必须主动识别并完成为达成目标所需的额外步骤，例如：读取 skill 资源文件、选择/调用其他 skill、使用 filesystem 读写文件、用 shell_executor 执行脚本/命令、以及对关键产物做验证。
- 必须形成闭环：读指南/资源 → 生成/修改 → 执行（脚本/命令）→ 验证（如 filesystem.read_file/list_directory/exists 或关键输出检查）→ 再向用户交付。**禁止**仅凭“写入脚本成功/下载成功”等中间结果就宣称任务已完成。
`
  });

  // 5.1 会话附加内容：工作目录（临时授权）
  try {
    const convId = context.conversationId || '';
    if (convId) {
      const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
      const wd = useConversationAttachmentStore.getState().getWorkingDir(convId);
      if (wd) {
        messages.push({
          role: 'system',
          content: `【当前会话工作目录】\n- @WorkDir -> ${wd}\n- 需要在该目录及其子目录中读写文件时，可使用 filesystem，并使用 @WorkDir/... 的别名路径或绝对路径。`,
        });
      }
    }
  } catch {
    // ignore
  }

  // 不再自动引导/默认写入 Documents：默认更安全，输出留在 @WorkDir（AppData 工作区）。
  
  // 6. 启用服务器声明
  const allEnabled = [
    ...enabled,
    ...(signals.webSearchEnabled ? [WEB_SEARCH_SERVER_NAME] : []),
    FILESYSTEM_SERVER_NAME,
    SHELL_EXECUTOR_SERVER_NAME,
  ];
  
  if (allEnabled.length > 0) {
    const serversLine = MCPPrompts.buildEnabledServersLine(allEnabled);
    if (serversLine) {
      messages.push({ role: 'system', content: serversLine });
    }
  }
  
  // 7. 网络搜索策略（如果启用）
  if (signals.webSearchEnabled) {
    messages.push({ role: 'system', content: MCPPrompts.webSearchPolicy });
  }
  
  // 8. Skills 索引注入（渐进式披露）
  await injectSkillsIndex(messages);
  
  return {
    systemMessages: messages,
    enabledServers: allEnabled,
    hasToolInfo: toolInfoParts.length > 0 || (Array.isArray(nativeTools) && nativeTools.length > 0),
    useNativeTools,
    nativeTools,
    toolCallStrategy: toolStrategy,
  };
}

/**
 * 构建追问阶段的提示词
 */
export async function buildFollowUpPrompt(
  context: InjectionContext,
  signals: InjectionSignals
): Promise<InjectionResult> {
  const messages: Array<{ role: 'system'; content: string }> = [];
  
  // 1. 时间上下文（简洁版）
  if (signals.isTimeRelated) {
    try {
      const { buildSimpleTimeContext } = await import('@/lib/prompts/TimeContext');
      messages.push({ role: 'system', content: buildSimpleTimeContext() });
    } catch {
      // 忽略错误
    }
  }
  
  // 2. 根据深度和错误状态构建追问提示
  const depth = context.toolCallDepth ?? 1;
  const originalQuestion = context.originalQuestion || context.userContent;
  
  if (depth >= 2) {
    // 第二次追问：强制回答（到达预算/深度上限）
    messages.push({
      role: 'system',
      content: buildForcedAnswerPrompt(originalQuestion)
    });
  } else {
    // 第一次追问
    messages.push({
      role: 'system',
      content: buildFirstFollowUpPrompt(originalQuestion, context.hasToolError)
    });
  }
  
  return {
    systemMessages: messages,
    enabledServers: [],
    hasToolInfo: false
  };
}

/**
 * 注入时间上下文
 */
async function injectTimeContext(
  messages: Array<{ role: 'system'; content: string }>,
  content: string,
  isTimeRelated: boolean
): Promise<void> {
  try {
    const { buildTimeContextMessage } = await import('@/lib/prompts/TimeContext');
    const timeContextMsg = buildTimeContextMessage(isTimeRelated);
    messages.push({ role: 'system', content: timeContextMsg });
  } catch (e) {
    console.warn('[PromptBuilder] 时间上下文注入失败:', e);
  }
}

// Native-only：不再通过 System Prompt 注入“文本工具协议”，因此不再构建文本化工具说明（@mention/简洁模式）。

/**
 * 构建原生工具定义（用于传递给 LLM API 的 tools 参数）
 */
async function buildNativeToolDefinitions(
  servers: string[],
  webSearchEnabled: boolean
): Promise<NativeToolDefinition[]> {
  const tools: NativeToolDefinition[] = [];
  const TOOL_LIMIT = 20; // 原生工具调用的限制

  const normalizeParams = (p: any): { type: 'object'; properties: Record<string, unknown>; required: string[] } => {
    // 一些 OpenAI-compat 后端会严格要求 parameters.properties 存在；否则会 400
    if (!p || typeof p !== 'object') {
      return { type: 'object', properties: {}, required: [] };
    }
    const props = (p as any).properties;
    const req = (p as any).required;
    return {
      type: 'object',
      properties: (props && typeof props === 'object') ? props : {},
      required: Array.isArray(req) ? req : [],
    };
  };

  // 0. Skills（本地能力包）：永远可用，不依赖 MCP 连接状态
  for (const t of skillTools) {
    // tool.name 在 skillTools 中是裸名（如 get_skill_instructions），这里统一加 server 前缀以便解析
    tools.push({
      name: `skills__${t.name}`,
      description: t.description || `Skill tool ${t.name}`,
      parameters: normalizeParams(
        t.parameters
          ? {
              type: 'object',
              properties: Object.fromEntries(
                Object.entries(t.parameters).map(([k, v]) => [
                  k,
                  { type: v.type, description: v.description },
                ])
              ),
              required: Object.entries(t.parameters)
                .filter(([, v]) => v.required)
                .map(([k]) => k),
            }
          : { type: 'object' }
      ),
    });
  }

  // 1. 添加 MCP 服务器的工具
  for (const server of servers) {
    try {
      const serverTools = await persistentCache.getToolsWithCache(server);
      if (!Array.isArray(serverTools)) continue;

      for (const tool of serverTools.slice(0, TOOL_LIMIT)) {
        if (!tool?.name) continue;
        
        // 使用 server__toolname 格式以便解析
        tools.push({
          name: `${server}__${tool.name}`,
          description: tool.description || `Tool ${tool.name} from ${server}`,
          parameters: normalizeParams(tool.inputSchema || { type: 'object' }),
        });
      }
    } catch {
      // 忽略单个服务器的错误
    }
  }

  // 2. 添加网络搜索工具
  if (webSearchEnabled) {
    tools.push({
      name: `${WEB_SEARCH_SERVER_NAME}__search`,
      description: '在互联网上搜索实时信息',
      parameters: normalizeParams({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
        },
        required: ['query'],
      }),
    });
  }

  // 3. 添加 Filesystem 基础工具（让 LLM 能读写文件、列目录）
  for (const fsTool of FILESYSTEM_TOOLS) {
    tools.push({
      name: `${FILESYSTEM_SERVER_NAME}__${fsTool.name}`,
      description: fsTool.description || `Filesystem tool ${fsTool.name}`,
      parameters: normalizeParams((fsTool as any).input_schema?.schema || { type: 'object' }),
    });
  }

  // 4. 添加 Shell Executor 工具（让 LLM 能执行命令/脚本）
  for (const shellTool of SHELL_EXECUTOR_TOOLS) {
    tools.push({
      name: `${SHELL_EXECUTOR_SERVER_NAME}__${shellTool.name}`,
      description: shellTool.description || `Shell tool ${shellTool.name}`,
      parameters: normalizeParams((shellTool as any).input_schema?.schema || { type: 'object' }),
    });
  }

  return tools;
}

// Native-only：WebSearch 以原生 tool schema 暴露（见 buildNativeToolDefinitions），无需文本描述注入。

/**
 * 构建第一次追问提示词
 */
function buildFirstFollowUpPrompt(originalQuestion: string, hasError?: boolean): string {
  if (hasError) {
    return `工具调用遇到问题。请基于错误信息处理：

【处理策略】：
1. 参数错误：调整参数后重新调用（只输出 1 个工具调用）
2. 连接错误：直接重试（系统会自动重连）
3. 工具不可用：尝试其他工具
4. 无法解决：基于已有知识回答

【重要】如果需要重试工具调用，只进行 1 次结构化工具调用（tool_call），然后停止。

用户问题：${originalQuestion}`;
  }
  
  return `工具调用已完成。请基于返回的结果回答用户问题；如果信息不足，允许继续调用工具进行补充/纠错，但必须遵守预算与停止条件。

【核心要求】：
1. 阅读上面的工具调用结果
2. 如果已经足够回答：直接给出最终中文答案，简洁明了
3. 如果仍不足以回答：继续调用工具获取缺失信息（允许补充/重试）

【工具调用规则（通用）】：
- 只为“缺失/不确定/需要纠错”的信息调用工具，避免无意义探索
- 允许一次输出多个工具调用用于并行补齐（但总数≤3），每个调用参数必须具体且互不重复
- 如果需要重试同一工具：必须改变参数/查询以纠错（不要原样重复）
- 工具预算：最多再补充 2 轮工具调用；若仍不足，请明确说明缺口并给出你能给出的最佳答案

用户问题：${originalQuestion}`;
}

/**
 * 构建强制回答提示词（第二次追问）
 */
function buildForcedAnswerPrompt(originalQuestion: string): string {
  return `【最终回答 - 禁止工具调用】

你已经获得了所有需要的信息。现在必须给出最终答案。

强制要求：
1. 阅读上面的工具调用结果，总结关键信息
2. 直接输出中文答案
3. 绝对禁止输出 <use_mcp_tool> 或任何工具调用指令

用户问题：${originalQuestion}

现在直接回答（不要调用任何工具）：`;
}

// ================================
// Skills 渐进式披露相关函数
// ================================

/**
 * 注入 Skills 索引到系统消息
 * 
 * 实现渐进式披露策略：
 * - 仅注入技能索引（名称 + 简短描述），约 100 tokens/skill
 * - AI 需要详细说明时，通过 get_skill_instructions 工具获取
 * - 可节省约 70-75% 的 Token 消耗
 */
async function injectSkillsIndex(
  messages: Array<{ role: 'system'; content: string }>
): Promise<void> {
  try {
    const manager = getSkillManager();
    
    // 确保 manager 已初始化
    await manager.initialize();
    
    // 获取技能索引提示词
    const skillsPrompt = manager.buildSkillIndexPrompt();
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/9f8e7fe1-428e-4909-b4e4-b7238838d737',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'promptBuilder.ts:injectSkillsIndex',message:'Skills prompt generated',data:{hasPrompt:!!skillsPrompt,promptPreview:skillsPrompt?.slice(0,300)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H9'})}).catch(()=>{});
    // #endregion
    
    if (skillsPrompt) {
      messages.push({ role: 'system', content: skillsPrompt });
    }
  } catch (error) {
    console.warn('[PromptBuilder] Skills 索引注入失败:', error);
    // 不阻塞主流程
  }
}


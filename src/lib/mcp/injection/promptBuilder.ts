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
 * 4. **外部化提示词**: 追问提示词从 txt 文件加载，便于维护
 */

import type { InjectionContext, InjectionResult, InjectionSignals, NativeToolDefinition } from './types';
import { getExtensionRegistry } from '@/lib/extensions/assembly';
import { MCPPrompts } from '@/lib/prompts/SystemPrompts';
import { WEB_SEARCH_SERVER_NAME } from '@/lib/mcp/nativeTools/webSearch';
import { FILESYSTEM_SERVER_NAME } from '@/lib/mcp/nativeTools/filesystem';
import { SHELL_EXECUTOR_SERVER_NAME } from '@/lib/mcp/nativeTools/shellExecutor';
import { 
  TOOLS_DISCOVER_SERVER_NAME, 
  TOOLS_REGISTRY_TOOLS,
  getToolsForGroup,
} from '@/lib/mcp/nativeTools/toolRegistry';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';
import { persistentCache } from '../persistentCache';
import { getGlobalEnabledServers, getAllConfiguredServers, getEnabledConfiguredServers } from '../chatIntegration';
import { resolveToolTrack, shouldUseNativeToolCalls, getToolCallStrategy } from '@/lib/llm/types/tool-capability';
import { getSkillManager } from '@/lib/skills';
import { skillIndexBlocks, skillIndexUsable } from '@/lib/skills/skillIndex';
import { SKILL_SERVER_NAME, SKILL_USAGE_TOOLS } from '@/lib/mcp/nativeTools/skillUnifiedTools';
import { RESERVED_MCP_SERVER_NAMES } from '@/lib/mcp/serverNamePolicy';
import { getRuntimePlatform, getShellGuidance } from '@/lib/utils/runtimePlatform';
import { buildAgentContractBlock } from '@/lib/mcp/prompt/agentContract';
import type { PromptBlock } from '@/lib/mcp/prompt/composition';
import { getToolDoc } from './toolDocLoader';

/**
 * The textual tool protocol for runs that cannot use native tools (#163, spec #161).
 *
 * It teaches exactly the shape the stream parser reads - `<use_mcp_tool>` with its three child
 * tags - and one call per turn, which is what keeps the rewrite unambiguous. A protocol the
 * parser cannot read is worse than none: the call comes back as prose.
 */
/**
 * The textual tool protocol for runs that cannot use native tools (#163, spec #161).
 */
export function buildToolChannelBlock(servers: readonly string[]): string {
  const list = servers.filter(Boolean);
  if (list.length === 0) return '';
  return [
    '[Tool channel]',
    'This endpoint cannot use native function calling. To call a tool, reply with one block in exactly this shape and no prose around it:',
    '',
    '<use_mcp_tool>',
    '<server_name>server</server_name>',
    '<tool_name>tool</tool_name>',
    '<arguments>{"key": "value"}</arguments>',
    '</use_mcp_tool>',
    '',
    `Call one tool per turn, then wait for its result before continuing. Available servers: ${list.join(', ')}.`,
  ].join('\n');
}

/**
 * 构建初始调用阶段的提示词
 * 
 * ## 按通道组装（spec #161）
 *
 * 1. `native`：不注入工具描述，定义走 API 的 tools 参数；
 * 2. `prompt`：不传 tools，注入一份固定文本协议（`buildToolChannelBlock`）与可用服务器列表，
 *    回流文本由 ToolChannelParser 变成调用；
 * 3. `disabled`：既不传工具、也不注入协议，并且**不再**告诉模型它能检索（那正是 #160 的死路）。
 */
/**
 * Where the prompt is assembled, in the order the blocks are pushed (anchor on the comment ids or
 * the block `order`, not on line numbers):
 *
 *   time / runtime       `runtime-environment` then the per-turn time block - the only block that
 *                        changes every turn
 *   session prompt       a prompt the user applied to this conversation (`system_prompt_applied`)
 *   agent contract       `buildAgentContractBlock()` - the stable, small contract
 *   native tool defs     `buildNativeToolDefinitions` - only on the native track
 *   attachments          working directory, then the retrieval rules (only when tools are callable)
 *   capabilities         the enabled-server line
 *   tool channel         the prompt-track protocol block - only on that track, once
 *   web search           policy block
 *   plan-only            a per-turn block, added last
 */
export async function buildInitialPrompt(
  context: InjectionContext,
  signals: InjectionSignals
): Promise<InjectionResult> {
  const blocks: PromptBlock[] = [];
  const enabledServers: string[] = [];
  
  // 检测是否应该使用原生工具调用
  const providerName = context.providerName || '';
  const modelName = context.modelName || '';
  const track = resolveToolTrack(providerName, modelName);
  const useNativeTools = track === 'native';
  const toolStrategy = getToolCallStrategy(providerName, modelName);
  
  // 调试日志：追踪工具调用策略决策
  console.debug('[promptBuilder] 工具调用策略:', {
    providerName,
    modelName,
    useNativeTools,
    toolStrategy: toolStrategy.useNative ? 'native' : 'prompt',
    source: toolStrategy.source,
    note: toolStrategy.note,
  });

  // Models without native tool support remain ordinary chat models.
  
  // 1. 时间上下文：唯一允许每轮变化的块，排在最后
  await injectTimeContext(blocks, context.userContent, signals.isTimeRelated);

  // 1.1 运行平台上下文（用于生成稳定可执行的命令）
  try {
    const p = await getRuntimePlatform();
    const g = getShellGuidance(p);
    
    // 构建命令示例表
    const cmdExamples = Object.entries(g.commandExamples || {})
      .map(([op, cmd]) => `  ${op}: ${cmd}`)
      .join('\n');
    
    blocks.push({
      id: 'runtime-environment',
      layer: 'conversation',
      order: 10,
      content: `[Runtime environment - ${g.platformLabel} (binding)]

Shell: ${g.preferredShell}

Rules:
${g.rules.map((r) => `- ${r}`).join('\n')}

${cmdExamples ? `Common commands:\n${cmdExamples}` : ''}

Prefer fs__mkdir over a shell command when creating a directory.`,
    });
  } catch {
    // ignore
  }

  // 1.2 用户为该会话选择的系统提示词：属于会话层，仍然是同一个 system 消息里的块
  try {
    const convId = context.conversationId || '';
    if (convId) {
      const { useChatStore } = await import('@/store/chatStore');
      const applied = useChatStore.getState().conversations.find((c) => c.id === convId)?.system_prompt_applied;
      if (applied?.promptId) {
        const { usePromptStore } = await import('@/store/promptStore');
        const prompt = usePromptStore.getState().prompts.find((p) => p.id === applied.promptId);
        if (prompt) {
          const { renderPromptContent } = await import('@/lib/prompt/render');
          const rendered = renderPromptContent(prompt.content, applied.variableValues);
          if (rendered && rendered.trim()) {
            blocks.push({ id: 'user-system-prompt', layer: 'conversation', order: 5, content: rendered.trim() });
          }
        }
      }
    }
  } catch {
    // 提示词缺失不应阻断对话
  }

  // git / gh guidance: the tools exist on PATH, but the shell has no stdin, so
  // a command that asks for input fails.  Say that once, in the conversation
  // layer, instead of letting the agent discover it by hanging.
  try {
    const gitGuidance = [
      '[Version control and GitHub]',
      '- `git` and `gh` run through shell__run. Running a command still follows the shell trust setting,',
      '  so a first command outside the trusted scope may need the user to approve it.',
      '- Commands must be non-interactive: stdin is closed. Do not run commands that wait for input',
      '  (a bare `git commit`, interactive rebase, a push that prompts for a password).',
      '- Commit with `git commit -m "..."`. If a push needs credentials it fails immediately; report that to the user.',
      '- Use a logged-in `gh` for pull requests and issues. If `gh auth status` says you are not logged in,',
      '  ask the user to run `gh auth login` instead of retrying the same command.',
      '- Start anything long-running (dev server, watcher) with shell__start instead of blocking on it.',
    ].join('\n');
    blocks.push({
      id: 'git-guidance',
      layer: 'conversation',
      order: 90,
      content: gitGuidance,
    });
  } catch {
    // ignore
  }
  
  // 2. External MCP tools are only injected after an explicit mention or a
  //    tools__search result. The search itself covers every enabled server,
  //    without dumping that entire directory into each model request.
  let enabled: string[] = [];
  const conversationId = context.conversationId || undefined;
  const requestedServers = conversationId
    ? useToolLoadRequestStore.getState().getLoadedMcpServers(conversationId)
    : [];
  const configuredEnabled = await getEnabledConfiguredServers();
  if (signals.hasExplicitMention && signals.mentionedServers.length > 0) {
    const globalEnabled = await getGlobalEnabledServers();
    const all = await getAllConfiguredServers();
    const serverMap = new Map(all.map((n) => [n.toLowerCase(), n] as const));

    const mentionedEnabled = signals.mentionedServers
      .map((n) => serverMap.get(n.toLowerCase()))
      .filter((n): n is string => Boolean(n))
      .filter((n) => globalEnabled.includes(n))
      // 内置保留 server（filesystem/skills/web_search/shell_executor）不走外部 mcp 连接列表
      .filter((n) => !RESERVED_MCP_SERVER_NAMES.has(String(n || '').toLowerCase()));

    enabled = mentionedEnabled;
  }
  enabled = Array.from(new Set([
    ...enabled,
    ...requestedServers.filter((server) => configuredEnabled.includes(server)),
  ]));
  if (enabled.length > 0) {
    try {
      await persistentCache.preconnectServers(enabled);
    } catch (error) {
      console.warn('[InjectionManager] 预连接失败:', error);
    }
  }
  enabledServers.push(...enabled);
  
  const shouldExposeWebSearch =
    !!signals.webSearchEnabled;

  // Skills: one read per run, from one place. The tool list, the standing line and the
  // named-skill block must come from the same snapshot - two reads can describe two
  // different disks, and installing or removing one skill mid-run is enough to make that
  // happen. The track decides whether the run can act on skills at all: the standing line
  // names `skill__guide`, so on the `disabled` track it would point at nothing.
  const skillIndexView = await getSkillManager().buildSkillIndexView({
    explicitIds: (context.explicitSkillIds || []).filter(Boolean),
  });
  const skillIndexOn = skillIndexUsable(track, !!skillIndexView.availabilityLine);

  // Native tool definitions (native tool API, or the text injection fallback)
  const nativeTools: InjectionResult['nativeTools'] = await buildNativeToolDefinitions({
    servers: enabled,
    includeWebSearch: shouldExposeWebSearch,
    includeSkillUsageTools: skillIndexOn && useNativeTools,
    userContent: context.userContent || '',
    conversationId: context.conversationId,
  });

  // Keep the default contract small. Native schemas carry the detailed
  // operation surface; prompt text must not become a second tool protocol.
  blocks.push(buildAgentContractBlock());

  // Models without native tool support remain chat-only. Do not inject a
  // textual fallback protocol that can be mistaken for an executable call.

  // 5.1 会话附加内容：工作目录（临时授权）
  try {
    const convId = context.conversationId || '';
    if (convId) {
      const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
      const attachment = useConversationAttachmentStore.getState();
      const wd = attachment.getWorkingDir(convId);
      if (wd) {
        blocks.push({
          id: 'session-workspace',
          layer: 'conversation',
          order: 20,
          content:
            '[Working directory for this session]\n' +
            `- @WorkDir -> ${wd}\n` +
            (attachment.getMountedDir(convId)
              ? '- This is the selected project folder. For questions about the current project, start here, not in Chatless session artifacts. Relative file paths and command working directories start here by default.\n' +
                '- Use @WorkDir or a relative path. Selecting the project does not authorize access; file operations still follow the existing file permissions and approval rules.'
              : '- This is the session output directory: relative paths and new files land here by default.\n' +
                '- Use a relative path or @WorkDir/...; paths outside this directory are subject to file permissions and approval.'),
        });
      }
      // The current mount is the authority. Historic messages and prior
      // selections are deliberately not consulted here: unmounting a library
      // must remove both the tools and the prompt hint immediately. The
      // knowledge contribution's availability predicate is the single mount
      // authority (external review dedup) - no store/SQL re-implementation
      // at this callsite anymore.
      const knowledgeAvailable =
        (await getExtensionRegistry().availableGroup('knowledge', {
          conversationId: convId || undefined,
        })) !== undefined;
      // A run with tools switched off must not be told it can retrieve - that is what made the
      // model emit a call nobody would execute (#160).
      if (track !== 'disabled' && knowledgeAvailable) {
        blocks.push({
          id: 'knowledge-rules',
          layer: 'conversation',
          order: 30,
          content:
            '[Document retrieval rules]\n' +
            'This session has a knowledge base or attached documents. To look something up, call knowledge__list/knowledge__search first, then knowledge__read for the full text.\n' +
            'A document fact may only be cited with the evidenceId the tool returned, in the format [[E1]]. Never invent documents, pages or citations.\n' +
            'If you only read part of a long document, say what the coverage was; when the documents do not support an answer, say it cannot be confirmed. Keep general knowledge and inference separate from document facts.',
        });
      }
    }
  } catch {
    // ignore
  }

  // 6. 启用服务器声明
  const allEnabled = [
    ...enabled,
    ...(shouldExposeWebSearch ? [WEB_SEARCH_SERVER_NAME] : []),
    FILESYSTEM_SERVER_NAME,
    SHELL_EXECUTOR_SERVER_NAME,
    // On the text-tool track the index is only honest if `skill` is one of the servers the
    // protocol block advertises; naming skill__guide without it is a dead promise.
    ...(skillIndexOn && track === 'prompt' ? [SKILL_SERVER_NAME] : []),
  ];
  
  if (allEnabled.length > 0) {
    const serversLine = MCPPrompts.buildEnabledServersLine(allEnabled);
    if (serversLine) {
      blocks.push({ id: 'capabilities', layer: 'conversation', order: 60, content: serversLine });
    }
    // One protocol block, once: the prompt track's only way to call anything.
    if (track === 'prompt') {
      const channel = buildToolChannelBlock(allEnabled);
      if (channel) {
        blocks.push({ id: 'tool-channel', layer: 'conversation', order: 65, content: channel });
      }
    }
  }
  
  // 7. 网络搜索策略（如果启用）
  if (shouldExposeWebSearch) {
    blocks.push({ id: 'web-search-policy', layer: 'conversation', order: 70, content: MCPPrompts.webSearchPolicy });
  }

  // 8. The skill index: the standing line and the list are two blocks, shaped in
  // `skillIndexBlocks` where it can be tested without Tauri. Skipped when the run cannot
  // call anything - a line that says "read skill__guide first" with no tools behind it is
  // the failure mode the knowledge line guards against (#160).
  if (skillIndexOn) {
    blocks.push(...skillIndexBlocks(skillIndexView));
  }
  

  // Plan-only is a per-turn instruction: the user can toggle it between turns.
  if (context.planOnly) {
    blocks.push({
      id: 'plan-only-mode',
      layer: 'turn',
      order: 20,
      content: '[Plan-only mode] Only bounded reads, retrieval and read-only tools are allowed. Writes, shell commands and anything with unknown side effects must not run: produce a plan and wait for the user to confirm it.',
    });
  }
  
  return {
    systemMessages: blocks,
    enabledServers: allEnabled,
    hasToolInfo: Array.isArray(nativeTools) && nativeTools.length > 0,
    useNativeTools,
    nativeTools,
    toolCallStrategy: toolStrategy,
  };
}

/**
 * 注入时间上下文
 */
async function injectTimeContext(
  blocks: PromptBlock[],
  content: string,
  isTimeRelated: boolean
): Promise<void> {
  try {
    const { buildTimeContextMessage } = await import('@/lib/prompts/TimeContext');
    const timeContextMsg = buildTimeContextMessage(isTimeRelated);
    // The clock changes every minute, so it must never precede cacheable text.
    blocks.push({ id: 'current-time', layer: 'turn', order: 10, content: timeContextMsg });
  } catch (e) {
    console.warn('[PromptBuilder] 时间上下文注入失败:', e);
  }
}

// Native-only：不再通过 System Prompt 注入"文本工具协议"，因此不再构建文本化工具说明（@mention/简洁模式）。

/**
 * 构建原生工具定义（用于传递给 LLM API 的 tools 参数）
 * 
 * ## 动态加载策略
 * 
 * 1. 核心层（始终加载）：有界文件工具、Shell 与可选联网工具
 * 2. 发现层：tools__search 分页返回完整能力目录
 * 3. 会话层：搜索匹配的能力组在下一模型步生效
 */
interface NativeToolBuildOptions {
  servers: string[];
  includeWebSearch: boolean;
  /** When skills are available, the four read-only tools the index points at must really be in the request. */
  includeSkillUsageTools?: boolean;
  userContent?: string;
  conversationId?: string;
}

export async function buildNativeToolDefinitions(params: NativeToolBuildOptions): Promise<NativeToolDefinition[]> {
  const tools: NativeToolDefinition[] = [];

  const normalizeParams = (p: any): { type: 'object'; properties: Record<string, unknown>; required: string[] } => {
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

  // 记录已加载文档的服务器，避免重复注入相同文档
  const loadedDocServers = new Set<string>();
  
  type ToolEntry = { server: string; tool: { name: string; description?: string | null } };

  const addToolEntries = async (entries: ToolEntry[]) => {
    for (const { server, tool } of entries) {
      const fullName = `${server}__${tool.name}`;
      
      // 同一服务器的工具只在第一个工具中注入完整文档
      let doc = '';
      if (!loadedDocServers.has(server)) {
        doc = await getToolDoc({ toolFullName: fullName });
        if (doc) loadedDocServers.add(server);
      }
      
      tools.push({
        name: fullName,
        description: [tool.description || '', doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
        parameters: normalizeParams((tool as any).input_schema?.schema || { type: 'object' }),
      });
    }
  };

  const addToolsFromGroup = async (groupId: string) => {
    const contributed = getExtensionRegistry().group(groupId);
    if (contributed) {
      // Contribution group (knowledge pilot): same server/tool/definition as
      // the retired hand-written entry, so name, docs and parameters are identical.
      await addToolEntries(
        contributed.tools.map((t) => ({ server: contributed.server, tool: t.definition })),
      );
      return;
    }
    await addToolEntries(getToolsForGroup(groupId));
  };

  // ========== 1. 核心层：始终加载 ==========
  
  // 1.1 核心文件工具（read, write, ls）
  const coreToolStart = tools.length;
  await addToolsFromGroup('core');
  if (!params.includeWebSearch) {
    // Legacy guard: web tools used to sit inside the core group. They now
    // arrive through the web_search contribution's availability predicate
    // (same store toggle this flag was derived from in production), so this
    // splice normally matches nothing; direct callers passing the flag keep
    // their old core-slice semantics untouched.
    tools.splice(coreToolStart, tools.length - coreToolStart,
      ...tools.slice(coreToolStart).filter((tool) => !tool.name.startsWith(`${WEB_SEARCH_SERVER_NAME}__`)));
  }

  // 1.1b If the index appears, the four read-only tools it points at must really be in the
  // request: a line saying "read skill__guide first" that points at a missing tool is worse
  // than no index. Management tools still come through tools__load.
  if (params.includeSkillUsageTools) {
    await addToolEntries(SKILL_USAGE_TOOLS.map((tool) => ({ server: SKILL_SERVER_NAME, tool })));
  }
  
  // 1.2 能力搜索工具（不预加载管理类工具）
  for (const tool of TOOLS_REGISTRY_TOOLS) {
    const fullName = `${TOOLS_DISCOVER_SERVER_NAME}__${tool.name}`;
    tools.push({
      name: fullName,
      description: tool.description || '',
      parameters: normalizeParams((tool as any).input_schema?.schema || { type: 'object' }),
    });
  }

  // ========== 2. 显式会话范围：不根据关键词替模型预先选择能力 ==========
  const loadedGroups: string[] = ['core'];

  // 数据存在性能力现经扩展注册表按会话实时判定（knowledge 贡献）；
  // 原手写块里的 attachment store + 文档映射计数已迁入 assembly，行为不变。
  // 检测＝“数据存在性有信号”：只有带谓词的组算检测命中。无谓词组的可用恒真，
  // 当成检测命中会把本应“发现后才加载”的能力每轮硬塞进每次请求（提示词管理
  // 迁移的零可见变化就破在这）；它们的注入只由加载记录（sticky/pending）驱动。
  const extensionAvailable =
    await getExtensionRegistry().availableGroups({
      conversationId: params.conversationId || undefined,
    });
  const detectedGroups: string[] = extensionAvailable
    .filter((g) => !!g.availability)
    .map((g) => g.id);

  // ========== 3. AI 请求层：加载 AI 主动请求的工具组 ==========
  
  const store = useToolLoadRequestStore.getState();
  const conversationId = params.conversationId || undefined;
  const session = store.sessions[String(conversationId || '__default__')] || { loadedGroups: ['core'], requestedGroups: [] };
  // 关键：已加载的组需要在后续轮次持续注入（否则会出现“上一轮能用、下一轮工具不见了”）
  // 说明：store.loadedGroups 会随着 tools__load 或意图检测逐步累积；这里把它作为“粘性工具组”基础集合。
  // knowledge 例外：它每轮按当前挂载实时计算，粘性注入会让撤销挂载后的工具继续出现。
  const stickyLoaded = (session.loadedGroups || []).filter(
    (g) => g && g !== 'core' && getExtensionRegistry().isSticky(g),
  );
  const pendingRequests = store.getPendingRequests(conversationId);

  // History decides DISCLOSURE of still-available capabilities only (external
  // review P0-2): a group carrying an availability predicate must pass that
  // predicate THIS step - a sticky record or a pending request can never
  // revive a capability whose data is gone (revoked mount must not keep its
  // tools). Groups without predicates keep the sticky semantics that fixed
  // "工具上一轮能用下一轮不见了".
  const predicatedGroups = new Set(
    getExtensionRegistry()
      .groups()
      .filter((g) => !!g.availability)
      .map((g) => g.id),
  );
  const availableNow = new Set(detectedGroups);
  const groupsToLoad = [
    ...new Set([...stickyLoaded, ...detectedGroups, ...pendingRequests]),
  ].filter((g) => !predicatedGroups.has(g) || availableNow.has(g));
  
  // 加载各组工具
  for (const groupId of groupsToLoad) {
    // 所有组（包括 skill）现在统一使用 addToolsFromGroup
    await addToolsFromGroup(groupId);
    loadedGroups.push(groupId);
  }

  // 更新已加载状态
  store.markLoaded(
    loadedGroups.filter((g) => getExtensionRegistry().isSticky(g)),
    conversationId,
  );

  // ========== 4. MCP 服务器工具（外部服务） ==========
  
  for (const server of params.servers) {
    if (RESERVED_MCP_SERVER_NAMES.has(String(server || '').toLowerCase())) {
      continue;
    }
    try {
      const serverTools = await persistentCache.getToolsWithCache(server);
      if (!Array.isArray(serverTools)) continue;

      for (const tool of serverTools) {
        if (!tool?.name) continue;
        const fullName = `${server}__${tool.name}`;
        const doc = await getToolDoc({ toolFullName: fullName });
        tools.push({
          name: fullName,
          description: [tool.description || `Tool ${tool.name} from ${server}`, doc ? `\n\n${doc}` : ''].filter(Boolean).join(''),
          parameters: normalizeParams(tool.inputSchema || { type: 'object' }),
        });
      }
    } catch {
      // 忽略单个服务器的错误
    }
  }

  console.log(`[PromptBuilder] 工具加载: 核心(core) + ${groupsToLoad.join(', ') || '无'}, 共 ${tools.length} 个`);

  return tools;
}

// Native-only：WebSearch 以原生 tool schema 暴露（见 buildNativeToolDefinitions），无需文本描述注入。



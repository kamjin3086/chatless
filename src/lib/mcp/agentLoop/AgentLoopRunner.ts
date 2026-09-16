import type { Message as LlmMessage } from '@/lib/llm/types';
import { streamChat } from '@/lib/llm';
import { ProviderRegistry } from '@/lib/llm/ProviderRegistry';
import { StreamOrchestrator } from '@/lib/chat/stream/StreamOrchestrator';
import type { OnToolCall } from '@/lib/chat/stream/types';
import { ToolCallCoordinator } from '@/lib/mcp/ToolCallCoordinator';
import { ToolExecutionPipeline, ToolInvocation } from '@/lib/mcp/pipeline';
import { createDefaultAdapters } from '@/lib/mcp/pipeline/adapters';
import { useChatStore } from '@/store/chatStore';

import type { AgentLoopCancelParams, AgentLoopRunParams } from './types';
import { AgentRunControlPlane } from './AgentRunControlPlane';
import { AgentRunEventStore } from './AgentRunEventStore';
import { buildAgentPromptEnvelope, dedupeEnvelopeSystemPrefix } from './buildAgentPromptEnvelope';
import { resolveAgentToolCapability } from './resolveAgentToolCapability';
import { applyCitations } from '@/lib/rag/CitationService';
import { listEvidence } from '@/lib/rag/EvidenceRegistry';
import {
  buildToolRoleAppendix as buildSharedToolRoleAppendix,
  classifyToolResult,
  isPipelineSkipped,
  stableStringify,
} from '@/lib/mcp/shared/toolResultGuards';

type BufferedToolResult = {
  cardIdOrKey: string;
  callId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  result: unknown;
};

const coordinator = ToolCallCoordinator.getInstance();
const DEFAULT_PIPELINE = new ToolExecutionPipeline({ adapters: createDefaultAdapters() });

// Agent Loop 配置
// MAX_BUDGET: 加权预算上限（读取类工具消耗少，写入/执行类消耗多）
const MAX_BUDGET = 50;
const MAX_MODEL_STEPS = 50;
const MAX_SAME_ATTEMPTS = 3;      // 同一工具+参数的最大重试次数

/**
 * 获取工具的预算消耗权重
 * - 读取/查询类：0.5（允许更多的信息收集）
 * - 写入/执行类：1.5（需要更谨慎）
 * - 其他：1.0（默认）
 */
function getToolBudgetCost(server: string, tool: string): number {
  const srv = String(server || '').toLowerCase();
  const t = String(tool || '').toLowerCase();
  
  // 读取/查询类工具（低消耗）
  const isReadOnly = 
    // 文件系统读取
    (srv === 'fs' && (t === 'read' || t === 'ls' || t === 'list' || t.includes('read') || t.includes('list'))) ||
    // 网络搜索/获取
    (srv === 'web' && (t === 'search' || t === 'fetch')) ||
    // 技能查询（guide 替代了 use）
    (srv === 'skill' && (t === 'list' || t === 'guide' || t === 'use' || t === 'list_files' || t === 'read_file' || t === 'check_deps')) ||
    // 工具发现
    (srv === 'tools' && (t === 'discover' || t === 'load')) ||
    // 上下文获取
    (srv === 'ctx' && t === 'get') ||
    // 系统提示词查询
    (srv === 'system' && (t === 'list_prompts' || t === 'get_prompt'));
  
  if (isReadOnly) return 0.5;
  
  // 写入/执行类工具（高消耗）
  const isWriteOrExecute =
    // 文件系统写入/删除/移动
    (srv === 'fs' && (t === 'write' || t === 'mkdir' || t === 'rm' || t === 'mv' || t.includes('write') || t.includes('delete') || t.includes('create'))) ||
    // Shell 执行
    (srv === 'shell' || srv === 'shell_executor') ||
    // 技能安装/卸载
    (srv === 'skill' && (t === 'install' || t === 'uninstall' || t === 'write_file'));
  
  if (isWriteOrExecute) return 1.5;
  
  // 默认消耗
  return 1.0;
}

const activeLoops = new Map<string, { controller: AbortController; provider: string }>();
const steeringInputs = new Map<string, string[]>();

/** Queue a user steering message for the next safe model boundary. */
export function queueAgentSteering(assistantMessageId: string, input: string): boolean {
  const id = String(assistantMessageId || '').trim();
  const text = String(input || '').trim();
  if (!id || !text || !activeLoops.has(id)) return false;
  const pending = steeringInputs.get(id) || [];
  pending.push(text);
  steeringInputs.set(id, pending);
  return true;
}

/**
 * 从工具结果中移除内部引导字段（这些字段不应暴露给用户）
 */
function stripInternalFields(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result.map(stripInternalFields);
  
  const obj = result as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // 跳过内部引导字段
    if (
      key === '_internal' ||
      key === 'nextStep' ||
      key === 'hint' ||
      key === 'guidance' ||
      key === 'toolsReminder' ||
      key === 'suggestion' ||
      key === '_doNotOutputToUser'
    ) {
      continue;
    }
    cleaned[key] = typeof value === 'object' ? stripInternalFields(value) : value;
  }
  
  return cleaned;
}

/**
 * 根据工具调用结果生成引导 system 消息（仅供 LLM 内部决策）
 * 
 * 这些引导帮助 LLM 理解下一步该做什么，但不应该被输出给用户
 */
function buildGuidanceSystemMessage(batch: BufferedToolResult[]): LlmMessage | null {
  const hints: string[] = [];
  
  for (const r of batch) {
    const srv = String(r.server || '').toLowerCase();
    const tool = String(r.tool || '').toLowerCase();
    const res = r.result as any;
    const args = r.args as Record<string, unknown> | undefined;
    
    // ==================== Skill 相关 ====================
    
    // skill__list 后的引导 - 强调必须调用 skill__guide
    if (srv === 'skill' && tool === 'list') {
      const skills = Array.isArray(res?.skills) ? res.skills : [];
      if (skills.length > 0) {
        const skillItems = skills.slice(0, 3).map((s: any) => ({ id: s.id, name: s.name }));
        const skillDesc = skillItems.map((s: any) => `${s.name}(id:${s.id})`).join('、');
        hints.push(
          `[Skill] Found ${skills.length} skill(s): ${skillDesc}${skills.length > 3 ? '...' : ''}.\n` +
          `Next: call skill__guide({ id: "${skillItems[0]?.id || 'xxx'}" }) to get the operation guide.\n` +
          `The guide contains everything you need - no need to read README or other files after that.\n` +
          `Tell user: "我找到了相关技能，正在获取操作指南..."`
        );
      } else {
        hints.push(
          `[Skill] No skills found. Tell user and suggest:\n` +
          `1. Install a relevant skill, OR\n` +
          `2. Use basic tools (shell__run, fs__*, web__*) directly.`
        );
      }
    }
    
    // skill__guide 后的引导（也兼容旧名 use/get）
    if (srv === 'skill' && (tool === 'guide' || tool === 'use' || tool === 'get')) {
      const content = res?.content || res?.instructions || '';
      const hasScript = String(content).includes('.py') || String(content).includes('.js') || String(content).includes('.sh');
      const hasTemplate = String(content).includes('template') || String(content).includes('模板');
      
      let guideHint = `[Skill] ✅ Guide loaded. Now follow the SKILL.md instructions:\n`;
      guideHint += `1. Read the 'content' field carefully - it's the complete guide\n`;
      
      if (hasScript || hasTemplate) {
        guideHint += `2. If the guide mentions scripts/templates in the skill package, use skill__list_files and skill__read_file to access them\n`;
      }
      
      guideHint += `3. Execute tasks using shell__run, fs__*, etc. as described in the guide\n`;
      guideHint += `4. Output files to @WorkDir\n`;
      guideHint += `Tell user: "我已获取操作指南，正在按步骤执行..."`;
      
      hints.push(guideHint);
    }
    
    // skill__check_deps 后的引导
    if (srv === 'skill' && tool === 'check_deps') {
      const satisfied = res?.satisfied || res?.ok;
      const missing = res?.missing || [];
      
      if (!satisfied && Array.isArray(missing) && missing.length > 0) {
        hints.push(
          `[Skill] Missing dependencies: ${missing.join(', ')}. ` +
          `Help user install them with shell__run, or explain the requirements.`
        );
      }
    }
    
    // ==================== Shell 命令执行 ====================
    
    if ((srv === 'shell' || srv === 'shell_executor') && tool === 'run') {
      const exitCode = typeof res?.exitCode === 'number' ? res.exitCode : res?.exit_code;
      
      if (exitCode === 0) {
        // 成功执行
        hints.push(
          `[Shell] Command succeeded. Next: verify the expected output/files were created ` +
          `(use fs__ls or fs__read). Report result to user in natural language.`
        );
      } else if (exitCode !== undefined) {
        // 执行失败
        hints.push(
          `[Shell] Command failed (exit ${exitCode}). Analyze stderr, then either: ` +
          `1) fix parameters and retry, 2) try alternative approach, or ` +
          `3) explain issue to user naturally without exposing raw error output.`
        );
      }
      
      // 检测常见的"需要后续操作"的命令
      const cmdArg = args?.command;
      const cmd = (typeof cmdArg === 'string' ? cmdArg : '').toLowerCase();
      
      // 包安装
      if (cmd.includes('npm install') || cmd.includes('pip install') || cmd.includes('pnpm install') || cmd.includes('yarn add')) {
        hints.push(
          `[Shell] Package installed. Now execute the script that needs these packages.`
        );
      }
      
      // Git 操作
      if (cmd.includes('git clone')) {
        hints.push(
          `[Shell] Repository cloned. Explore with fs__ls, then proceed with the task.`
        );
      }
      if (cmd.includes('git pull') || cmd.includes('git fetch')) {
        hints.push(
          `[Shell] Repository updated. Continue with the task.`
        );
      }
      
      // 文档转换（pandoc, wkhtmltopdf 等）
      if (cmd.includes('pandoc') || cmd.includes('wkhtmltopdf') || cmd.includes('convert')) {
        hints.push(
          `[Shell] Conversion command done. Verify output file exists with fs__ls, ` +
          `then tell user the result location.`
        );
      }
      
      // Python/Node 脚本执行
      if (cmd.includes('python ') || cmd.includes('python3 ') || cmd.includes('node ')) {
        hints.push(
          `[Shell] Script executed. Check stdout for results. If script created files, verify them.`
        );
      }
      
      // 构建命令
      if (cmd.includes('npm run') || cmd.includes('npm build') || cmd.includes('make') || cmd.includes('cargo build')) {
        hints.push(
          `[Shell] Build command done. Check for build artifacts or errors in output.`
        );
      }
    }
    
    // ==================== Web 搜索/抓取 ====================
    
    if (srv === 'web' && tool === 'search') {
      const results = Array.isArray(res?.results) ? res.results : [];
      if (results.length === 0) {
        hints.push(
          `[Web] Search returned empty. Try: different keywords, remove site: filter, ` +
          `or directly fetch a known URL. Do NOT repeat the same query.`
        );
      } else {
        hints.push(
          `[Web] Found ${results.length} results. If more detail needed, fetch specific URLs. ` +
          `Summarize findings to user naturally.`
        );
      }
    }
    
    if (srv === 'web' && tool === 'fetch') {
      const content = String(res?.content || '').trim();
      const title = String(res?.title || '').toLowerCase();
      // 检测被拦截
      if (!content || title.includes('just a moment') || title.includes('cloudflare') || title.includes('access denied')) {
        hints.push(
          `[Web] Page blocked/empty. Try: different website, alternative source, or inform user. ` +
          `Do NOT retry the same URL.`
        );
      } else {
        hints.push(
          `[Web] Page fetched. Extract relevant info and present to user naturally.`
        );
      }
    }
    
    if (srv === 'web' && tool === 'download') {
      if (res?.ok || res?.success || res?.path) {
        hints.push(
          `[Web] File downloaded. Verify with fs__ls if needed, then inform user of the saved location.`
        );
      }
    }
    
    // ==================== 文件系统操作 ====================
    
    if ((srv === 'fs' || srv === 'filesystem') && tool === 'write') {
      const pathArg = args?.path;
      const filePath = typeof pathArg === 'string' ? pathArg : '';
      const isScript = /\.(js|ts|py|sh|ps1|bat|cmd)$/i.test(filePath);
      
      if (isScript) {
        hints.push(
          `[FS] Script written. MUST execute it with shell__run and verify output. ` +
          `File saved ≠ task complete.`
        );
      } else {
        hints.push(
          `[FS] File written. If this is the deliverable, inform user with the path. ` +
          `If more steps remain, continue.`
        );
      }
    }
    
    if ((srv === 'fs' || srv === 'filesystem') && tool === 'read') {
      hints.push(
        `[FS] File content loaded. Analyze and proceed with the task. ` +
        `Summarize relevant parts to user if appropriate.`
      );
    }
    
    if ((srv === 'fs' || srv === 'filesystem') && (tool === 'ls' || tool === 'list' || tool === 'dir')) {
      const entries = Array.isArray(res?.entries) ? res.entries : (Array.isArray(res) ? res : []);
      hints.push(
        `[FS] Directory listed (${entries.length} items). Use this info to proceed. ` +
        `Describe structure to user naturally if they asked.`
      );
    }
    
    if ((srv === 'fs' || srv === 'filesystem') && (tool === 'rm' || tool === 'delete')) {
      if (res?.ok !== false && !res?.error) {
        hints.push(
          `[FS] Deletion done. Inform user of what was removed.`
        );
      }
    }
    
    if ((srv === 'fs' || srv === 'filesystem') && (tool === 'mkdir' || tool === 'create_directory')) {
      hints.push(
        `[FS] Directory created. Proceed with file operations in this directory.`
      );
    }
    
    if ((srv === 'fs' || srv === 'filesystem') && (tool === 'mv' || tool === 'rename' || tool === 'move')) {
      hints.push(
        `[FS] File/directory moved. Inform user of the new location if relevant.`
      );
    }
    
    // ==================== Skill 文件操作 ====================
    
    if (srv === 'skill' && tool === 'read_file') {
      hints.push(
        `[Skill] Resource file loaded. Use this content to proceed with the task.`
      );
    }
    
    if (srv === 'skill' && tool === 'list_files') {
      hints.push(
        `[Skill] Skill resources listed. Read specific files if needed for the task.`
      );
    }
    
    // ==================== 错误和边缘情况 ====================
    
    // 检测通用错误
    if (res?.error || res?.ok === false) {
      const errorMsg = String(res?.error?.message || res?.message || '').toLowerCase();
      
      // 权限拒绝
      if (errorMsg.includes('auth_denied') || errorMsg.includes('permission') || errorMsg.includes('access denied')) {
        hints.push(
          `[Error] Authorization denied. Wait for user to grant access, or try a different approach.`
        );
      }
      
      // 路径不存在
      if (errorMsg.includes('not found') || errorMsg.includes('enoent') || errorMsg.includes('no such file')) {
        hints.push(
          `[Error] Path not found. Check spelling, verify with fs__ls, or create the path first.`
        );
      }
      
      // 超时
      if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
        hints.push(
          `[Error] Operation timed out. Try with smaller scope, or inform user of the delay.`
        );
      }
    }
    
    // ==================== Context 工具 ====================
    
    if (srv === 'ctx' && tool === 'save_plan') {
      hints.push(
        `[Ctx] Plan saved. Execute step by step, update progress after each step. ` +
        `Tell user: "我已制定计划，现在开始执行第一步..."`
      );
    }
    
    if (srv === 'ctx' && tool === 'update_step') {
      const status = (args?.status as string) || '';
      const stepIndex = (args?.stepIndex as number) || 0;
      if (status === 'done') {
        hints.push(
          `[Ctx] Step ${stepIndex} done. Check if more steps remain. ` +
          `If all done, summarize results to user. If more, continue to next step.`
        );
      } else if (status === 'failed') {
        hints.push(
          `[Ctx] Step ${stepIndex} failed. Analyze the issue, try alternative approach, ` +
          `or ask user for help if blocked.`
        );
      }
    }
    
    if (srv === 'ctx' && tool === 'save_research') {
      hints.push(
        `[Ctx] Research saved. Summarize key findings to user naturally. ` +
        `Continue with next research topic or proceed to action phase.`
      );
    }
    
    if (srv === 'ctx' && tool === 'get') {
      const type = (args?.type as string) || '';
      if (type === 'plan') {
        hints.push(
          `[Ctx] Plan retrieved. Check current progress and continue from where you left off.`
        );
      } else if (type === 'status') {
        hints.push(
          `[Ctx] Status retrieved. If there's an incomplete plan, ask user if they want to continue.`
        );
      }
    }
    
    // ==================== 常见任务流程引导 ====================
    
    // 文档生成流程
    if ((srv === 'fs' || srv === 'filesystem') && tool === 'write') {
      const pathArg = args?.path;
      const filePath = typeof pathArg === 'string' ? pathArg : '';
      const isDocument = /\.(docx|doc|pdf|md|txt|html)$/i.test(filePath);
      
      if (isDocument && !hints.some(h => h.includes('[FS]'))) {
        hints.push(
          `[Task] Document created. Tell user: "文档已生成，保存在: ${filePath}". ` +
          `Offer next steps if applicable (e.g., open, convert, send).`
        );
      }
    }
    
    // Skill 安装流程
    if (srv === 'skill' && tool === 'install') {
      if (res?.ok || res?.success) {
        hints.push(
          `[Skill] Installation successful. Now call skill__use to get the guide, ` +
          `then help user with their original task.`
        );
      }
    }
    
    // Prompt 创建流程
    if (srv === 'system' && tool === 'create_prompt') {
      if (res?.ok || res?.id) {
        hints.push(
          `[Prompt] Created successfully. Tell user the prompt name and how to use it ` +
          `(e.g., type /shortcut or select from prompt list).`
        );
      }
    }
  }
  
  // ==================== 任务收敛提示 ====================
  
  // 如果本轮完成了多个工具调用，可能是任务的最后阶段
  if (batch.length >= 2) {
    const hasWrite = batch.some(r => (r.tool || '').toLowerCase() === 'write');
    const hasVerify = batch.some(r => ['read', 'ls', 'list'].includes((r.tool || '').toLowerCase()));
    
    if (hasWrite && hasVerify) {
      hints.push(
        `[Flow] Write + Verify pattern detected. If verification passed, ` +
        `summarize results to user and ask if anything else is needed.`
      );
    }
  }
  
  if (hints.length === 0) return null;
  
  return {
    role: 'system',
    content: `[Internal Guidance - DO NOT output to user]\n\n${hints.join('\n\n')}\n\n---\nRemember: User sees natural conversation only. Never mention tool names or show technical instructions.`,
  } as LlmMessage;
}

function buildToolRoleAppendix(batch: BufferedToolResult[]): { assistantMsg: LlmMessage; toolMsgs: LlmMessage[]; guidanceMsg: LlmMessage | null } {
  const { assistantMsg, toolMsgs } = buildSharedToolRoleAppendix(batch, { stripInternal: stripInternalFields });
  const guidanceMsg = buildGuidanceSystemMessage(batch);
  return { assistantMsg, toolMsgs, guidanceMsg };
}

function makeAttemptKey(params: { conversationId: string; server: string; tool: string; args?: Record<string, unknown> }): string {
  return `${params.conversationId}:${params.server}.${params.tool}:${stableStringify(params.args || {})}`;
}

function isCancelled(assistantMessageId: string, signal: AbortSignal): boolean {
  return coordinator.isMessageCancelled(assistantMessageId) || signal.aborted;
}

async function setAgentRunState(params: { assistantMessageId: string; running: boolean; conversationId?: string }) {
  try {
    useChatStore.getState().setAgentRunState(params);
  } catch {
    // ignore
  }
}

async function ensureAssistantLoading(assistantMessageId: string) {
  try {
    await useChatStore.getState().updateMessage(assistantMessageId, { status: 'loading' } as any);
  } catch {
    // ignore (best-effort)
  }
}

export class AgentLoopRunner {
  static steer(assistantMessageId: string, input: string): boolean {
    return queueAgentSteering(assistantMessageId, input);
  }
  static cancel(params: AgentLoopCancelParams) {
    const id = String(params.assistantMessageId || '').trim();
    if (!id) return;
    const active = activeLoops.get(id);
    if (active) {
      try {
        active.controller.abort();
      } catch {
        // ignore
      }
      // Cancel only the provider selected by this run.  The old global
      // interpreter cancellation could terminate an unrelated conversation.
      try { ProviderRegistry.get(active.provider)?.cancelStream?.(); } catch { /* ignore */ }
    }
    void AgentRunEventStore.setRunStatus(id, 'cancelled').catch(() => {});
    try {
      void import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke('cancel_safe_shell', { executionId: id }).catch(() => {}),
      );
    } catch {
      // ignore
    }
  }

  static async run(params: AgentLoopRunParams): Promise<void> {
    const assistantMessageId = String(params.assistantMessageId || '').trim();
    const conversationId = String(params.conversationId || '').trim();
    const provider = String(params.provider || '').trim();
    const model = String(params.model || '').trim();
    const originalUserContent = String(params.originalUserContent || '');
    const baseHistory: LlmMessage[] = [...(params.historyForLlm || [])] as LlmMessage[];
    const baseOptions: Record<string, any> = { ...(params.options || {}), conversationId, messageId: assistantMessageId };
    const hooks = params.runtimeHooks;
    const planOnly = Boolean(params.planOnly || (params.options as any)?.planOnly);

    if (!assistantMessageId || !conversationId || !provider || !model) return;

    // 单实例：同一 assistantMessageId 只允许一个 loop
    if (activeLoops.has(assistantMessageId)) return;
    const ctrl = new AbortController();
    activeLoops.set(assistantMessageId, { controller: ctrl, provider });
    steeringInputs.set(assistantMessageId, []);

    const attemptByKey = new Map<string, number>();
    const controlPlane = new AgentRunControlPlane(assistantMessageId, conversationId, assistantMessageId);
    let streamFailed = false;
    let terminalStatus: 'waiting_input' | 'waiting_approval' | 'paused' | undefined;

    await setAgentRunState({ assistantMessageId, conversationId, running: true });

    try {
      await controlPlane.start();
      // The history builder normally already contains the current user turn.
      // Record it only when a caller starts from an older checkpoint; otherwise
      // the first model request would contain the same input twice.
      const currentUserAlreadyInHistory = baseHistory.some((message) =>
        message.role === 'user' && message.content === originalUserContent
      );
      if (originalUserContent.trim() && !currentUserAlreadyInHistory) {
        await controlPlane.record({ type: 'user_message', content: originalUserContent });
      }
      await controlPlane.record({ type: 'context_change', kind: 'environment', content: 'agent_run_started' });
      if (planOnly) {
        await controlPlane.record({
          type: 'context_change',
          kind: 'permissions',
          content: 'plan_only_mode: only bounded reads/searches and interaction tools may execute; writes, shell, and unknown side effects are blocked',
        });
      }
      try {
        await hooks?.onAgentStart?.({ assistantMessageId, conversationId });
      } catch {
        // ignore
      }
      // 强制注入工具定义（agent 模式）
      try {
        const { useToolLoadRequestStore } = await import('@/store/toolLoadRequestStore');
        const loadState = useToolLoadRequestStore.getState();
        if (loadState.conversationId !== conversationId) loadState.reset(conversationId);
      } catch { /* keep the catalog best-effort */ }
      const { buildMcpSystemInjections } = await import('@/lib/mcp/promptInjector');
      const injection = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, { forceInject: true });
      const envelope = buildAgentPromptEnvelope(injection);
      const capability = resolveAgentToolCapability(provider, model);
      const conversationHistory = dedupeEnvelopeSystemPrefix(baseHistory, envelope.prefixMessages);

      // 复用工具清单（避免每轮都计算）
      const toolOptions: Record<string, any> = { ...baseOptions };
      if (capability.useNativeTools && injection.useNativeTools && envelope.tools.length > 0) {
        toolOptions.tools = envelope.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        toolOptions.toolChoice = 'auto';
        toolOptions.__useNativeTools = true;
      } else {
        delete toolOptions.tools;
        toolOptions.toolChoice = 'none';
        toolOptions.__useNativeTools = false;
      }
      const renderMode = capability.renderMode;
      const refreshNativeToolOptions = async () => {
        if (!capability.useNativeTools) return;
        const refreshed = await buildMcpSystemInjections(originalUserContent || '', conversationId, provider, model, { forceInject: true });
        if (!refreshed.useNativeTools || !Array.isArray(refreshed.nativeTools)) return;
        toolOptions.tools = refreshed.nativeTools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));
        toolOptions.toolChoice = 'auto';
        toolOptions.__useNativeTools = true;
      };

      let round = 0;
      let budgetUsed = 0;  // 加权预算消耗
      let forceNoTools = false;
      let knowledgeToolCalls = 0;

      const markStreamFailed = async (reason: string) => {
        streamFailed = true;
        const short = String(reason || 'unknown').slice(0, 200);
        await controlPlane.record({
          type: 'context_change',
          kind: 'other',
          content: `agent_stream_failed: ${short}`,
        }).catch(() => {});
      };

      // while(true) agent loop
      while (true) {
        if (isCancelled(assistantMessageId, ctrl.signal)) {
          controlPlane.markCancelled();
          break;
        }
        const queuedSteering = steeringInputs.get(assistantMessageId)?.splice(0) || [];
        for (const steering of queuedSteering) {
          await controlPlane.record({ type: 'user_message', content: steering });
        }
        if (round >= MAX_MODEL_STEPS) {
          terminalStatus = 'paused';
          break;
        }
        round += 1;

        // 进入每一轮 stream 前，确保 message.status=loading（避免 Stop 闪烁）
        await ensureAssistantLoading(assistantMessageId);

        const results = new Map<string, BufferedToolResult>();
        const pending: Promise<void>[] = [];

        const onToolCall: OnToolCall = (req) => {
          const key = String(req.cardId || req.lockKey || req.callId || '').trim() || `${req.server}.${req.tool}:${stableStringify(req.args || {})}`;
          const callId = (req.callId && String(req.callId).trim()) ? String(req.callId).trim() : `call_${key}`.slice(0, 64);

          const p = (async () => {
            if (isCancelled(assistantMessageId, ctrl.signal)) return;
            try {
              if (req.preResult !== undefined) {
                results.set(key, { cardIdOrKey: key, callId, server: req.server, tool: req.tool, args: req.args, result: req.preResult });
                return;
              }

              if (String(req.server).toLowerCase() === 'knowledge' && knowledgeToolCalls >= 12) {
                const limitedResult = {
                  ok: false,
                  error: { code: 'KNOWLEDGE_TOOL_BUDGET', message: '本次运行的文档工具调用已达到 12 次上限，请继续运行以读取剩余内容。' },
                };
                results.set(key, {
                  cardIdOrKey: key,
                  callId,
                  server: req.server,
                  tool: req.tool,
                  args: req.args,
                  result: limitedResult,
                });
                try {
                  useChatStore.getState().dispatchMessageAction(assistantMessageId, {
                    type: 'TOOL_RESULT', server: req.server, tool: req.tool, ok: false,
                    errorMessage: limitedResult.error.message, cardId: req.cardId,
                  } as any);
                  if (req.lockKey) coordinator.markToolCallComplete(req.lockKey, 'failed');
                } catch { /* ignore */ }
                return;
              }
              if (String(req.server).toLowerCase() === 'knowledge') knowledgeToolCalls += 1;

              // 执行工具（不触发旧的 continueWithToolResult 递归续写）
              const inv = new ToolInvocation({
                assistantMessageId,
                conversationId,
                server: req.server,
                tool: req.tool,
                args: req.args || {},
                provider,
                model,
                historyForLlm: controlPlane.buildLlmMessages(conversationHistory, renderMode),
                originalUserContent,
                callId: req.callId,
                cardId: req.cardId,
                lockKey: req.lockKey,
                providerData: (req as any).providerData,
                planOnly: params.planOnly,
              });
              await controlPlane.record({
                type: 'tool_call_requested',
                callId,
                cardId: req.cardId,
                server: req.server,
                tool: req.tool,
                args: req.args,
                providerData: (req as any).providerData,
              });
              const out = await DEFAULT_PIPELINE.run(inv);
              if (isCancelled(assistantMessageId, ctrl.signal) || isPipelineSkipped(out)) {
                return;
              }
              results.set(key, { cardIdOrKey: key, callId, server: req.server, tool: req.tool, args: req.args, result: out });
              await controlPlane.record({
                type: 'tool_call_output',
                callId,
                cardId: req.cardId,
                server: req.server,
                tool: req.tool,
                args: req.args,
                output: out,
                isError: !!(out as any)?.error,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              results.set(key, {
                cardIdOrKey: key,
                callId,
                server: req.server,
                tool: req.tool,
                args: req.args,
                result: { error: 'PIPELINE_FAILED', message: msg },
              });
            } finally {
              try {
                coordinator.markToolCallComplete(req.lockKey, 'completed');
              } catch {
                // ignore
              }
            }
          })();

          pending.push(p);
        };

        const orchestrator = new StreamOrchestrator({
          messageId: assistantMessageId,
          conversationId,
          provider,
          model,
          originalUserContent,
          historyForLlm: controlPlane.buildLlmMessages(conversationHistory, renderMode),
          onUIUpdate: () => {},
          onError: (error) => {
            void markStreamFailed(error?.message || 'stream_error');
          },
          onToolCall,
          skipTitleGeneration: true,
          skipEmptyBubbleRollback: true,
        });

        const callbacks = orchestrator.createCallbacks();
        // 复用 useChatActions 的监控/计数/超时逻辑：把每一轮 stream 生命周期暴露出去
        const originalOnStart = callbacks.onStart;
        callbacks.onStart = async () => {
          try {
            await hooks?.onStreamStart?.({ assistantMessageId, conversationId, round });
          } catch {
            // ignore
          }
          try {
            await (originalOnStart?.() as any);
          } catch {
            // ignore
          }
        };
        const originalOnEvent = callbacks.onEvent;
        callbacks.onEvent = async (event: any) => {
          try {
            hooks?.onStreamEvent?.(event, { assistantMessageId, conversationId, round });
          } catch {
            // ignore
          }
          return await (originalOnEvent?.(event) as any);
        };
        const originalOnComplete = callbacks.onComplete;
        callbacks.onComplete = async () => {
          try {
            await (originalOnComplete?.() as any);
          } finally {
            try {
              await hooks?.onStreamComplete?.({ assistantMessageId, conversationId, round });
            } catch {
              // ignore
            }
          }
        };
        const originalOnError = callbacks.onError;
        callbacks.onError = (error: Error) => {
          try {
            hooks?.onStreamError?.(error, { assistantMessageId, conversationId, round });
          } catch {
            // ignore
          }
          try {
            originalOnError?.(error);
          } catch {
            // ignore
          }
          streamFailed = true;
        };

        // Loop guard：超过预算上限时强制本轮不再允许工具
        const budgetExceeded = budgetUsed >= MAX_BUDGET;
        const options = forceNoTools || budgetExceeded ? { ...toolOptions, toolChoice: 'none' } : { ...toolOptions };
        let messages: LlmMessage[] = await controlPlane.assembleRoundMessages({
          prefixMessages: envelope.prefixMessages,
          baseHistory: conversationHistory,
          renderMode,
          provider,
          model,
        });
        if (forceNoTools || budgetExceeded) {
          messages = [
            ...messages,
            {
              role: 'system',
              content:
                `你已经尝试了多次但没有成功。请直接用文字回复用户：\n` +
                `- 简单说明你尝试了什么\n` +
                `- 遇到了什么问题\n` +
                `- 建议用户可以怎么做\n\n` +
                `现在请直接回复，不要再调用工具。`,
            } as any,
          ];
        }

        try {
          await streamChat(provider, model, messages, callbacks, options);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const err = e instanceof Error ? e : new Error(msg);
          await markStreamFailed(msg);
          try {
            await useChatStore.getState().updateMessage(assistantMessageId, {
              status: 'error',
              content: msg,
            });
          } catch {
            // ignore
          }
          try {
            const { showSendErrorToast } = await import('@/lib/chat/showSendErrorToast');
            showSendErrorToast(err, { providerName: provider });
          } catch {
            // ignore
          }
          try {
            hooks?.onStreamError?.(err, { assistantMessageId, conversationId, round });
          } catch {
            // ignore
          }
          break;
        }

        if (streamFailed) {
          break;
        }

        if (isCancelled(assistantMessageId, ctrl.signal)) {
          controlPlane.markCancelled();
          break;
        }

        // 等待本轮工具（若有）
        if (pending.length === 0) {
          const finalContent = orchestrator.getContext().content;
          if (finalContent?.trim()) {
            await controlPlane.record({ type: 'assistant_message', content: finalContent });
          }
          break;
        }
        await Promise.allSettled(pending);

        if (isCancelled(assistantMessageId, ctrl.signal)) {
          controlPlane.markCancelled();
          break;
        }

        const waiting = Array.from(results.values()).find((entry) => {
          const status = (entry.result as any)?.status;
          return status === 'waiting_input' || status === 'waiting_approval';
        });
        if (waiting) {
          terminalStatus = (waiting.result as any).status;
          break;
        }

        // 计算本轮预算消耗 + 熔断（空结果/重复失败）
        let roundCost = 0;
        let toolLoopTripped = false;
        for (const r of results.values()) {
          // 累加预算消耗
          roundCost += getToolBudgetCost(r.server, r.tool);
          
          const kind = classifyToolResult(r.result);
          const attemptKey = makeAttemptKey({ conversationId, server: r.server, tool: r.tool, args: r.args });
          if (kind === 'empty' || kind === 'tool_error') {
            const next = (attemptByKey.get(attemptKey) || 0) + 1;
            attemptByKey.set(attemptKey, next);
            if (next >= MAX_SAME_ATTEMPTS) toolLoopTripped = true;

            // Empty output is a valid result. Only the exact same call/result
            // repeated three times is treated as a loop; the model may change
            // its query or use another tool after one empty response.
          } else {
            attemptByKey.delete(attemptKey);
          }
        }
        
        // 更新总预算消耗
        budgetUsed += roundCost;

        // tools__load changes the session catalog. Apply it before the next
        // model step instead of waiting for another user message.
        if (Array.from(results.values()).some((r) => r.server === 'tools' && r.tool === 'load')) {
          try { await refreshNativeToolOptions(); } catch { /* keep the prior catalog */ }
        }

        if (toolLoopTripped) {
          const batch = Array.from(results.values());
          const guidanceMsg = buildGuidanceSystemMessage(batch);
          if (guidanceMsg && (guidanceMsg as any).content) {
            await controlPlane.record({
              type: 'context_change',
              kind: 'other',
              content: String((guidanceMsg as any).content),
            });
          }
          forceNoTools = true;
        }

        // 工具结果已写入 EventLog；下一轮从事件投影构建历史
        if (forceNoTools) {
          // 下一轮会 toolChoice=none，stream 完成后 pending 为空，会 break
        }
      }
    } finally {
      activeLoops.delete(assistantMessageId);
      steeringInputs.delete(assistantMessageId);
      const finalStatus = controlPlane.isCancelled() || isCancelled(assistantMessageId, ctrl.signal)
        ? 'cancelled'
        : terminalStatus
          ? terminalStatus
        : streamFailed
          ? 'failed'
          : 'completed';
      if (finalStatus === 'cancelled') {
        await controlPlane.recordCancelled().catch(() => {});
      }
      await controlPlane.finish(finalStatus).catch(() => {});
      // Agent answers use the same deterministic citation path as the legacy
      // RAG flow. Resolve markers while the run-scoped evidence registry is
      // still alive, then persist the citation snapshot with the message.
      try {
        const evidence = listEvidence(assistantMessageId);
        if (evidence.length) {
          const st = useChatStore.getState();
          const conv = st.conversations.find((c) => c.id === conversationId);
          const message = conv?.messages?.find((m: any) => m.id === assistantMessageId) as any;
          if (message?.content) {
            const { displayAnswer, citations } = applyCitations(String(message.content), evidence);
            if (displayAnswer !== message.content || citations.length) {
              st.updateMessageContentInMemory(assistantMessageId, displayAnswer);
              await st.updateMessage(assistantMessageId, { content: displayAnswer, citations } as any);
            }
          }
        }
      } catch (error) {
        console.warn('[AgentLoopRunner] citation finalization failed:', error);
      }
      try {
        await hooks?.onAgentEnd?.({ assistantMessageId, conversationId });
      } catch {
        // ignore
      }
      try {
        const { clearEvidenceRegistry } = await import('@/lib/rag/EvidenceRegistry');
        clearEvidenceRegistry(assistantMessageId);
      } catch {
        /* noop */
      }
      await setAgentRunState({ assistantMessageId, conversationId, running: false });

      // AgentLoop 结束后统一生成标题
      // 这样可以避免在每轮流完成时都触发标题生成，防止与主模型并发抢占资源
      try {
        const st = useChatStore.getState();
        const conv = st.conversations.find(c => c.id === conversationId);
        if (conv) {
          const {
            shouldGenerateTitleAfterAssistantComplete,
            extractFirstUserMessageSeed,
            isDefaultTitle,
          } = await import('@/lib/chat/TitleGenerator');
          const { generateTitle } = await import('@/lib/chat/TitleService');
          if (shouldGenerateTitleAfterAssistantComplete(conv)) {
            const seed = extractFirstUserMessageSeed(conv);
            if (seed && seed.trim()) {
              console.debug('[AgentLoopRunner] AgentLoop 结束，开始生成标题, seed:', seed.slice(0, 50));
              const gen = await generateTitle(provider, model, seed, { maxLength: 24, language: 'zh' });
              console.debug('[AgentLoopRunner] 标题生成结果:', gen);
              const st2 = useChatStore.getState();
              const conv2 = st2.conversations.find(c => c.id === conversationId);
              if (conv2 && isDefaultTitle(conv2.title) && gen && gen.trim()) {
                console.debug('[AgentLoopRunner] 更新对话标题:', gen.trim());
                void st2.renameConversation(String(conversationId), gen.trim());
              }
            }
          }
        }
      } catch (e) {
        console.error('[AgentLoopRunner] 标题生成失败:', e);
      }
    }
  }
}

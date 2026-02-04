/**
 * Agent Context Adapter
 * 
 * 封装文件导向工作流的核心操作：
 * - save_research: 保存研究结果
 * - save_plan: 创建/更新任务计划
 * - log_error: 记录错误
 * - get: 检索上下文
 * - update_step: 更新计划步骤状态
 */

import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { AGENT_CONTEXT_SERVER_NAME } from '@/lib/mcp/nativeTools/agentContext';
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  listDirectory as fsListDirectory,
  createDirectory as fsCreateDirectory,
  type ReadFileResult,
  type ListDirectoryResult,
} from '@/lib/tauri/filesystemCommands';

const AGENT_DIR = '.agent';
const RESEARCH_DIR = 'research';
const TODO_FILE = 'todo.md';
const ERRORS_FILE = 'errors.log';
const MAX_ERRORS = 50;

function normalizePath(p: string): string {
  return String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

function joinPath(base: string, rest: string): string {
  const b = normalizePath(base);
  const r = String(rest || '').trim().replace(/\\/g, '/');
  if (!r) return b;
  return `${b}/${r.replace(/^\/+/, '')}`;
}

function getTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function sanitizeFilename(name: string): string {
  return String(name || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

export class AgentContextAdapter implements ToolAdapter {
  readonly server = AGENT_CONTEXT_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === AGENT_CONTEXT_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').toLowerCase();
    const args = invocation.args || {};

    // 获取工作目录
    let workDir: string;
    try {
      workDir = await this.getWorkDir(invocation.conversationId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: 'WorkDir 不可用',
        details: msg,
        hint: '请确保在界面中已设置/附加工作目录，或等待会话工作区自动初始化。',
      };
    }

    // 确保 .agent 目录存在
    const agentDir = joinPath(workDir, AGENT_DIR);
    try {
      await this.ensureDir(agentDir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: '无法创建 .agent 目录',
        details: msg,
        path: agentDir,
        hint: '请检查目录是否在文件系统允许列表中，以及是否有写入权限。',
      };
    }

    try {
      switch (tool) {
        case 'save_research':
          return await this.saveResearch(agentDir, args);
        case 'save_plan':
          return await this.savePlan(agentDir, args);
        case 'log_error':
          return await this.logError(agentDir, args);
        case 'get':
          return await this.getContext(agentDir, args);
        case 'update_step':
          return await this.updateStep(agentDir, args);
        default:
          return { ok: false, error: `Unknown ctx tool: ${tool}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg, tool, agentDir };
    }
  }

  private async getWorkDir(conversationId?: string): Promise<string> {
    // 辅助函数：确保目录在 allowlist 中并同步到后端
    const authorizeDir = async (p: string): Promise<void> => {
      const { ensureAllowlistedDirectory } = await import('@/lib/filesystemAllowlist/autoAuthorize');
      await ensureAllowlistedDirectory({
        path: p,
        source: 'workdir',
        permissions: { read: true, write: true, create: true, delete: false },
        reconnect: true,
      });
    };

    // 1. 首选：指定的会话 @WorkDir
    if (conversationId) {
      try {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        const wd = useConversationAttachmentStore.getState().getWorkingDir(conversationId);
        if (wd) {
          const p = normalizePath(String(wd));
          await authorizeDir(p);
          return p;
        }
      } catch (e) {
        console.warn('[AgentContext] getWorkDir from conversation failed:', e);
      }
    }

    // 2. 兜底：当前活动会话
    try {
      const { useChatStore } = await import('@/store/chatStore');
      const cid = useChatStore.getState().currentConversationId || '';
      if (cid && cid !== conversationId) {
        const { useConversationAttachmentStore } = await import('@/store/conversationAttachmentStore');
        const wd = useConversationAttachmentStore.getState().getWorkingDir(cid);
        if (wd) {
          const p = normalizePath(String(wd));
          await authorizeDir(p);
          return p;
        }
      }
    } catch (e) {
      console.warn('[AgentContext] getWorkDir from current session failed:', e);
    }

    // 3. 最后兜底：应用数据目录
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const base = await appDataDir();
      const full = await join(base, 'chatless-workdir');
      const p = normalizePath(String(full));
      await authorizeDir(p);
      return p;
    } catch (e) {
      console.warn('[AgentContext] getWorkDir from appDataDir failed:', e);
    }

    throw new Error('WorkDir 不可用：请在界面中附加工作目录后重试，或检查文件系统权限设置。');
  }

  private async ensureDir(path: string): Promise<void> {
    try {
      const result = await fsCreateDirectory({ path, recursive: true });
      if (!(result as any)?.ok) {
        throw new Error((result as any)?.message || 'mkdir failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('forbidden')) {
        throw new Error(`创建目录被拒绝: ${path}\n原因: ${msg}\n解决方案: 请在设置中将目录添加到文件系统允许列表，并确保有 create 权限。`);
      }
      throw new Error(`创建目录失败: ${path}\n${msg}`);
    }
  }

  private async readFile(path: string): Promise<string> {
    try {
      const result: ReadFileResult = await fsReadFile({ path });
      return result.ok && result.content ? result.content : '';
    } catch {
      return '';
    }
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    
    if (parent) {
      try {
        await this.ensureDir(parent);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`创建父目录失败: ${parent}\n${msg}`);
      }
    }

    try {
      const result = await fsWriteFile({ path: p, content });
      if (!(result as any)?.ok) {
        throw new Error((result as any)?.message || 'write failed');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('forbidden')) {
        throw new Error(`写入被拒绝: ${p}\n原因: ${msg}\n解决方案: 请在设置中将工作目录添加到文件系统允许列表。`);
      }
      throw new Error(`写入文件失败: ${p}\n${msg}`);
    }
  }

  private async listDir(path: string): Promise<string[]> {
    try {
      const result: ListDirectoryResult = await fsListDirectory({ path, limit: 200 });
      if (result.ok && result.entries) {
        return result.entries.map((e) => e.name);
      }
      return [];
    } catch {
      return [];
    }
  }

  // ============ save_research ============
  private async saveResearch(agentDir: string, args: Record<string, unknown>): Promise<unknown> {
    const topic = sanitizeFilename(String(args.topic || 'research'));
    const content = String(args.content || '');
    const source = args.source ? String(args.source) : undefined;
    const keyFindings = Array.isArray(args.keyFindings) ? args.keyFindings.map(String) : [];

    if (!content.trim()) {
      return { ok: false, error: 'content is required' };
    }

    const researchDir = joinPath(agentDir, RESEARCH_DIR);
    await this.ensureDir(researchDir);

    const filePath = joinPath(researchDir, `${topic}.md`);
    const timestamp = getTimestamp();
    const existing = await this.readFile(filePath);

    let newContent: string;
    if (existing) {
      const appendSection = `
---

## 更新 (${timestamp})
${source ? `来源: ${source}\n` : ''}
${content}
${keyFindings.length > 0 ? `\n### 关键发现\n${keyFindings.map(f => `- ${f}`).join('\n')}` : ''}
`;
      newContent = existing + appendSection;
    } else {
      newContent = `# 研究：${topic}
创建时间：${timestamp}

## 背景
${source ? `来源: ${source}\n` : ''}
${content}
${keyFindings.length > 0 ? `\n## 关键发现\n${keyFindings.map(f => `- ${f}`).join('\n')}` : ''}
`;
    }

    try {
      await this.writeFile(filePath, newContent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: 'Failed to write research file',
        details: msg,
        path: filePath,
        researchDir,
        agentDir,
        hint: '请确保工作目录在文件系统允许列表中（设置 → 安全 → 允许的目录）。',
      };
    }

    const summary = keyFindings.length > 0
      ? `已保存到 ${filePath}。关键发现: ${keyFindings.slice(0, 3).join('; ')}${keyFindings.length > 3 ? '...' : ''}`
      : `已保存到 ${filePath}`;

    return { ok: true, path: filePath, summary };
  }

  // ============ save_plan ============
  private async savePlan(agentDir: string, args: Record<string, unknown>): Promise<unknown> {
    const title = String(args.title || '未命名任务');
    const goal = String(args.goal || '');
    const steps = Array.isArray(args.steps) ? args.steps.map(String) : [];
    const constraints = Array.isArray(args.constraints) ? args.constraints.map(String) : [];
    const risks = Array.isArray(args.risks) ? args.risks : [];

    if (steps.length === 0) {
      return { ok: false, error: 'steps is required' };
    }

    const filePath = joinPath(agentDir, TODO_FILE);
    const timestamp = getTimestamp();

    const stepsSection = steps.map((s, i) => `${i + 1}. [ ] ${s}`).join('\n');
    const constraintsSection = constraints.length > 0
      ? `\n## 约束条件\n${constraints.map(c => `- ${c}`).join('\n')}\n`
      : '';
    const risksSection = risks.length > 0
      ? `\n## 风险与备选\n${risks.map((r: any) => `- 风险: ${r.risk || ''} → 备选: ${r.fallback || ''}`).join('\n')}\n`
      : '';

    const content = `# 任务：${title}
创建时间：${timestamp}
状态：进行中

## 目标
${goal}
${constraintsSection}
## 执行计划
${stepsSection}
${risksSection}
## 执行日志
### ${timestamp}
- 任务创建
`;

    try {
      await this.writeFile(filePath, content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: 'Failed to write plan file', details: msg, path: filePath };
    }

    return {
      ok: true,
      path: filePath,
      summary: `任务计划已创建: "${title}"，共 ${steps.length} 步。当前: 第 1 步`,
      currentStep: 1,
      totalSteps: steps.length,
    };
  }

  // ============ log_error ============
  private async logError(agentDir: string, args: Record<string, unknown>): Promise<unknown> {
    const operation = String(args.operation || '');
    const error = String(args.error || '');
    const analysis = String(args.analysis || '');
    const resolution = args.resolution ? String(args.resolution) : '待解决';

    if (!operation || !error) {
      return { ok: false, error: 'operation and error are required' };
    }

    const filePath = joinPath(agentDir, ERRORS_FILE);
    const timestamp = getTimestamp();

    const entry = `[${timestamp}] ERROR
操作：${operation}
错误：${error}
原因：${analysis}
解决：${resolution}
---
`;

    const existing = await this.readFile(filePath);
    const newContent = existing + entry;
    const entries = newContent.split('---\n').filter(e => e.trim());
    const limitedEntries = entries.slice(-MAX_ERRORS);
    const finalContent = limitedEntries.join('---\n') + (limitedEntries.length > 0 ? '---\n' : '');

    try {
      await this.writeFile(filePath, finalContent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: 'Failed to write error log', details: msg, path: filePath };
    }

    return { ok: true, message: '错误已记录' };
  }

  // ============ get ============
  private async getContext(agentDir: string, args: Record<string, unknown>): Promise<unknown> {
    const type = String(args.type || 'status');
    const topic = args.topic ? sanitizeFilename(String(args.topic)) : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 10;

    switch (type) {
      case 'plan': {
        const filePath = `${agentDir}/${TODO_FILE}`;
        const content = await this.readFile(filePath);
        if (!content) {
          return { ok: true, exists: false, message: '没有活动的任务计划' };
        }
        const progress = this.parsePlanProgress(content);
        return { ok: true, exists: true, content, ...progress };
      }

      case 'research': {
        const researchDir = `${agentDir}/${RESEARCH_DIR}`;
        if (topic) {
          const filePath = `${researchDir}/${topic}.md`;
          const content = await this.readFile(filePath);
          if (!content) {
            return { ok: true, exists: false, message: `没有找到研究: ${topic}` };
          }
          return { ok: true, exists: true, topic, content };
        } else {
          const files = await this.listDir(researchDir);
          const topics = files.filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
          return { ok: true, topics, message: topics.length > 0 ? `找到 ${topics.length} 个研究主题` : '没有研究记录' };
        }
      }

      case 'errors': {
        const filePath = `${agentDir}/${ERRORS_FILE}`;
        const content = await this.readFile(filePath);
        if (!content) {
          return { ok: true, exists: false, message: '没有错误记录' };
        }
        const entries = content.split('---\n').filter(e => e.trim());
        const recent = entries.slice(-limit);
        return { ok: true, exists: true, count: entries.length, recent: recent.join('---\n') };
      }

      case 'status':
      default: {
        const todoExists = !!(await this.readFile(`${agentDir}/${TODO_FILE}`));
        const errorExists = !!(await this.readFile(`${agentDir}/${ERRORS_FILE}`));
        const researchFiles = await this.listDir(`${agentDir}/${RESEARCH_DIR}`);
        const researchCount = researchFiles.filter(f => f.endsWith('.md')).length;

        let planSummary = '无活动计划';
        if (todoExists) {
          const todoContent = await this.readFile(`${agentDir}/${TODO_FILE}`);
          const progress = this.parsePlanProgress(todoContent);
          planSummary = `${progress.title} (${progress.completed}/${progress.total})`;
        }

        return {
          ok: true,
          hasPlan: todoExists,
          planSummary,
          hasErrors: errorExists,
          researchCount,
          researchTopics: researchFiles.filter(f => f.endsWith('.md')).map(f => f.replace('.md', '')),
        };
      }
    }
  }

  // ============ update_step ============
  private async updateStep(agentDir: string, args: Record<string, unknown>): Promise<unknown> {
    const stepIndex = typeof args.stepIndex === 'number' ? args.stepIndex : 0;
    const status = String(args.status || 'done');
    const note = args.note ? String(args.note) : '';

    if (stepIndex < 1) {
      return { ok: false, error: 'stepIndex must be >= 1' };
    }

    const filePath = joinPath(agentDir, TODO_FILE);
    let content = await this.readFile(filePath);
    if (!content) {
      return { ok: false, error: '没有活动的任务计划' };
    }

    const timestamp = getTimestamp();
    const statusMark = status === 'done' ? 'x' : status === 'failed' ? '!' : status === 'skipped' ? '-' : '>';
    const statusText = status === 'done' ? '✓ ' + timestamp : status === 'failed' ? '✗ ' + timestamp : status === 'skipped' ? '⊘ ' + timestamp : '← 当前';

    const stepPattern = new RegExp(`^(${stepIndex}\\. )\\[.\\](.*)$`, 'm');
    if (stepPattern.test(content)) {
      content = content.replace(stepPattern, `$1[${statusMark}]$2 ${statusText}`);
    }

    const logEntry = `\n### ${timestamp}
- 步骤 ${stepIndex}: ${status}${note ? ` - ${note}` : ''}
`;

    if (content.includes('## 执行日志')) {
      content = content + logEntry;
    } else {
      content = content + '\n## 执行日志' + logEntry;
    }

    try {
      await this.writeFile(filePath, content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: 'Failed to update plan', details: msg, path: filePath };
    }

    const progress = this.parsePlanProgress(content);
    return {
      ok: true,
      message: `步骤 ${stepIndex} 已更新为 ${status}`,
      ...progress,
    };
  }

  // ============ helpers ============
  private parsePlanProgress(content: string): { title: string; completed: number; total: number; currentStep: number } {
    const titleMatch = content.match(/^# 任务：(.+)$/m);
    const title = titleMatch ? titleMatch[1] : '未命名';

    const stepMatches = content.match(/^\d+\. \[.\]/gm) || [];
    const total = stepMatches.length;
    const completed = (content.match(/^\d+\. \[x\]/gm) || []).length;
    const failed = (content.match(/^\d+\. \[!\]/gm) || []).length;
    const skipped = (content.match(/^\d+\. \[-\]/gm) || []).length;
    const currentStep = completed + failed + skipped + 1;

    return { title, completed, total, currentStep: Math.min(currentStep, total) };
  }
}

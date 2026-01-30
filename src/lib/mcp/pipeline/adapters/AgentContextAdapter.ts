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

const AGENT_DIR = '.agent';
const RESEARCH_DIR = 'research';
const TODO_FILE = 'todo.md';
const ERRORS_FILE = 'errors.log';
const MAX_ERRORS = 50;

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

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // 确保 .agent 目录存在
      const workDir = await this.getWorkDir(invoke);
      const agentDir = `${workDir}/${AGENT_DIR}`;
      await this.ensureDir(invoke, agentDir);

      switch (tool) {
        case 'save_research':
          return await this.saveResearch(invoke, agentDir, args);
        case 'save_plan':
          return await this.savePlan(invoke, agentDir, args);
        case 'log_error':
          return await this.logError(invoke, agentDir, args);
        case 'get':
          return await this.getContext(invoke, agentDir, args);
        case 'update_step':
          return await this.updateStep(invoke, agentDir, args);
        default:
          return { ok: false, error: `Unknown ctx tool: ${tool}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  private async getWorkDir(invoke: typeof import('@tauri-apps/api/core').invoke): Promise<string> {
    try {
      const result = await invoke<{ workDir: string }>('get_work_dir');
      return result.workDir || '.';
    } catch {
      return '.';
    }
  }

  private async ensureDir(invoke: typeof import('@tauri-apps/api/core').invoke, path: string): Promise<void> {
    try {
      await invoke('filesystem_create_directory', { path, recursive: true });
    } catch {
      // 目录可能已存在，忽略错误
    }
  }

  private async readFile(invoke: typeof import('@tauri-apps/api/core').invoke, path: string): Promise<string> {
    try {
      const result = await invoke<{ ok: boolean; content?: string }>('filesystem_read_file', { path });
      return result.ok && result.content ? result.content : '';
    } catch {
      return '';
    }
  }

  private async writeFile(invoke: typeof import('@tauri-apps/api/core').invoke, path: string, content: string): Promise<boolean> {
    try {
      const result = await invoke<{ ok: boolean }>('filesystem_write_file', { path, content });
      return result.ok;
    } catch {
      return false;
    }
  }

  private async listDir(invoke: typeof import('@tauri-apps/api/core').invoke, path: string): Promise<string[]> {
    try {
      const result = await invoke<{ ok: boolean; entries?: Array<{ name: string }> }>('filesystem_list_directory', { path });
      if (result.ok && result.entries) {
        return result.entries.map(e => e.name);
      }
      return [];
    } catch {
      return [];
    }
  }

  // ============ save_research ============
  private async saveResearch(
    invoke: typeof import('@tauri-apps/api/core').invoke,
    agentDir: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const topic = sanitizeFilename(String(args.topic || 'research'));
    const content = String(args.content || '');
    const source = args.source ? String(args.source) : undefined;
    const keyFindings = Array.isArray(args.keyFindings) ? args.keyFindings.map(String) : [];

    if (!content.trim()) {
      return { ok: false, error: 'content is required' };
    }

    const researchDir = `${agentDir}/${RESEARCH_DIR}`;
    await this.ensureDir(invoke, researchDir);

    const filePath = `${researchDir}/${topic}.md`;
    const timestamp = getTimestamp();

    // 检查是否已存在
    const existing = await this.readFile(invoke, filePath);

    let newContent: string;
    if (existing) {
      // 追加模式
      const appendSection = `
---

## 更新 (${timestamp})
${source ? `来源: ${source}\n` : ''}
${content}
${keyFindings.length > 0 ? `\n### 关键发现\n${keyFindings.map(f => `- ${f}`).join('\n')}` : ''}
`;
      newContent = existing + appendSection;
    } else {
      // 新建
      newContent = `# 研究：${topic}
创建时间：${timestamp}

## 背景
${source ? `来源: ${source}\n` : ''}
${content}
${keyFindings.length > 0 ? `\n## 关键发现\n${keyFindings.map(f => `- ${f}`).join('\n')}` : ''}
`;
    }

    const ok = await this.writeFile(invoke, filePath, newContent);
    if (!ok) {
      return { ok: false, error: 'Failed to write research file' };
    }

    // 返回摘要
    const summary = keyFindings.length > 0
      ? `已保存到 ${filePath}。关键发现: ${keyFindings.slice(0, 3).join('; ')}${keyFindings.length > 3 ? '...' : ''}`
      : `已保存到 ${filePath}`;

    return { ok: true, path: filePath, summary };
  }

  // ============ save_plan ============
  private async savePlan(
    invoke: typeof import('@tauri-apps/api/core').invoke,
    agentDir: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const title = String(args.title || '未命名任务');
    const goal = String(args.goal || '');
    const steps = Array.isArray(args.steps) ? args.steps.map(String) : [];
    const constraints = Array.isArray(args.constraints) ? args.constraints.map(String) : [];
    const risks = Array.isArray(args.risks) ? args.risks : [];

    if (steps.length === 0) {
      return { ok: false, error: 'steps is required' };
    }

    const filePath = `${agentDir}/${TODO_FILE}`;
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

    const ok = await this.writeFile(invoke, filePath, content);
    if (!ok) {
      return { ok: false, error: 'Failed to write plan file' };
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
  private async logError(
    invoke: typeof import('@tauri-apps/api/core').invoke,
    agentDir: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const operation = String(args.operation || '');
    const error = String(args.error || '');
    const analysis = String(args.analysis || '');
    const resolution = args.resolution ? String(args.resolution) : '待解决';

    if (!operation || !error) {
      return { ok: false, error: 'operation and error are required' };
    }

    const filePath = `${agentDir}/${ERRORS_FILE}`;
    const timestamp = getTimestamp();

    const entry = `[${timestamp}] ERROR
操作：${operation}
错误：${error}
原因：${analysis}
解决：${resolution}
---
`;

    // 读取现有内容
    let existing = await this.readFile(invoke, filePath);

    // 追加新条目
    const newContent = existing + entry;

    // 限制条目数量（简单按 '---' 分割）
    const entries = newContent.split('---\n').filter(e => e.trim());
    const limitedEntries = entries.slice(-MAX_ERRORS);
    const finalContent = limitedEntries.join('---\n') + (limitedEntries.length > 0 ? '---\n' : '');

    const ok = await this.writeFile(invoke, filePath, finalContent);
    if (!ok) {
      return { ok: false, error: 'Failed to write error log' };
    }

    return { ok: true, message: '错误已记录' };
  }

  // ============ get ============
  private async getContext(
    invoke: typeof import('@tauri-apps/api/core').invoke,
    agentDir: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const type = String(args.type || 'status');
    const topic = args.topic ? sanitizeFilename(String(args.topic)) : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 10;

    switch (type) {
      case 'plan': {
        const filePath = `${agentDir}/${TODO_FILE}`;
        const content = await this.readFile(invoke, filePath);
        if (!content) {
          return { ok: true, exists: false, message: '没有活动的任务计划' };
        }
        // 解析进度
        const progress = this.parsePlanProgress(content);
        return { ok: true, exists: true, content, ...progress };
      }

      case 'research': {
        const researchDir = `${agentDir}/${RESEARCH_DIR}`;
        if (topic) {
          const filePath = `${researchDir}/${topic}.md`;
          const content = await this.readFile(invoke, filePath);
          if (!content) {
            return { ok: true, exists: false, message: `没有找到研究: ${topic}` };
          }
          return { ok: true, exists: true, topic, content };
        } else {
          // 列出所有研究主题
          const files = await this.listDir(invoke, researchDir);
          const topics = files
            .filter(f => f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
          return { ok: true, topics, message: topics.length > 0 ? `找到 ${topics.length} 个研究主题` : '没有研究记录' };
        }
      }

      case 'errors': {
        const filePath = `${agentDir}/${ERRORS_FILE}`;
        const content = await this.readFile(invoke, filePath);
        if (!content) {
          return { ok: true, exists: false, message: '没有错误记录' };
        }
        // 取最近 N 条
        const entries = content.split('---\n').filter(e => e.trim());
        const recent = entries.slice(-limit);
        return { ok: true, exists: true, count: entries.length, recent: recent.join('---\n') };
      }

      case 'status':
      default: {
        // 概览
        const todoExists = !!(await this.readFile(invoke, `${agentDir}/${TODO_FILE}`));
        const errorExists = !!(await this.readFile(invoke, `${agentDir}/${ERRORS_FILE}`));
        const researchFiles = await this.listDir(invoke, `${agentDir}/${RESEARCH_DIR}`);
        const researchCount = researchFiles.filter(f => f.endsWith('.md')).length;

        let planSummary = '无活动计划';
        if (todoExists) {
          const todoContent = await this.readFile(invoke, `${agentDir}/${TODO_FILE}`);
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
  private async updateStep(
    invoke: typeof import('@tauri-apps/api/core').invoke,
    agentDir: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const stepIndex = typeof args.stepIndex === 'number' ? args.stepIndex : 0;
    const status = String(args.status || 'done');
    const note = args.note ? String(args.note) : '';

    if (stepIndex < 1) {
      return { ok: false, error: 'stepIndex must be >= 1' };
    }

    const filePath = `${agentDir}/${TODO_FILE}`;
    let content = await this.readFile(invoke, filePath);
    if (!content) {
      return { ok: false, error: '没有活动的任务计划' };
    }

    const timestamp = getTimestamp();
    const statusMark = status === 'done' ? 'x' : status === 'failed' ? '!' : status === 'skipped' ? '-' : '>';
    const statusText = status === 'done' ? '✓ ' + timestamp : status === 'failed' ? '✗ ' + timestamp : status === 'skipped' ? '⊘ ' + timestamp : '← 当前';

    // 更新步骤状态（简单正则替换）
    const stepPattern = new RegExp(`^(${stepIndex}\\. )\\[.\\](.*)$`, 'm');
    if (stepPattern.test(content)) {
      content = content.replace(stepPattern, `$1[${statusMark}]$2 ${statusText}`);
    }

    // 追加执行日志
    const logEntry = `\n### ${timestamp}
- 步骤 ${stepIndex}: ${status}${note ? ` - ${note}` : ''}
`;

    // 在执行日志章节追加
    if (content.includes('## 执行日志')) {
      content = content + logEntry;
    } else {
      content = content + '\n## 执行日志' + logEntry;
    }

    const ok = await this.writeFile(invoke, filePath, content);
    if (!ok) {
      return { ok: false, error: 'Failed to update plan' };
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

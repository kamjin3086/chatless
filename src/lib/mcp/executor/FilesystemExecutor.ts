/**
 * Filesystem 执行器
 * 
 * 执行文件系统操作（基于 Tauri fs API）
 */

import { useChatStore } from '@/store/chatStore';
import { resolveSkillPath, type SkillContextMetadata } from '@/lib/skills/types/SkillContext';

export interface FilesystemExecuteParams {
  assistantMessageId: string;
  conversationId: string;
  tool: string;
  args: Record<string, unknown>;
  cardId?: string;
  skillContext?: SkillContextMetadata;
}

export class FilesystemExecutor {
  constructor(private params: FilesystemExecuteParams) {}

  async execute(): Promise<void> {
    const { assistantMessageId, tool, args, cardId } = this.params;
    const effectiveCardId = cardId || crypto.randomUUID();

    try {
      let result: unknown;

      switch (tool) {
        case 'read_file':
          result = await this.readFile(String(args.path || ''));
          break;
        case 'write_file':
          result = await this.writeFile(String(args.path || ''), String(args.content || ''));
          break;
        case 'list_directory':
          result = await this.listDirectory(String(args.path || ''));
          break;
        default:
          throw new Error(`Unknown filesystem tool: ${tool}`);
      }

      // 更新工具卡片
      const st = useChatStore.getState();
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server: 'filesystem',
        tool,
        ok: true,
        data: result,
        cardId: effectiveCardId,
      });

      // 继续对话
      const { continueWithToolResult } = await import('../ToolCallOrchestrator');
      await continueWithToolResult({
        assistantMessageId,
        provider: 'openai',
        model: 'gpt-4',
        conversationId: this.params.conversationId,
        historyForLlm: [],
        originalUserContent: '',
        server: 'filesystem',
        tool,
        args,
        result,
      });
    } catch (error) {
      const st = useChatStore.getState();
      st.dispatchMessageAction(assistantMessageId, {
        type: 'TOOL_RESULT',
        server: 'filesystem',
        tool,
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        cardId: effectiveCardId,
      });
    }
  }

  private async readFile(path: string): Promise<string> {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const resolved = resolveSkillPath(path, this.params.skillContext);
    const normalized = this.normalizePath(resolved);
    
    const content = await readTextFile(normalized);
    
    // 支持 maxLines 参数
    const maxLines = typeof this.params.args.maxLines === 'number' ? this.params.args.maxLines : undefined;
    if (maxLines && maxLines > 0) {
      const lines = content.split('\n');
      return lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? `\n... (${lines.length - maxLines} more lines)` : '');
    }
    
    return content;
  }

  private async writeFile(path: string, content: string): Promise<string> {
    const { writeTextFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');
    const resolved = resolveSkillPath(path, this.params.skillContext);
    const normalized = this.normalizePath(resolved);
    
    // 确保目录存在
    const dirPath = normalized.substring(0, normalized.lastIndexOf('/'));
    if (dirPath && !(await exists(dirPath))) {
      await mkdir(dirPath, { recursive: true });
    }

    await writeTextFile(normalized, content);
    return `File written successfully: ${normalized}`;
  }

  private async listDirectory(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const resolved = resolveSkillPath(path, this.params.skillContext);
    const normalized = this.normalizePath(resolved);
    const entries = await readDir(normalized);
    return entries.map((e: any) => ({ name: e.name, isDirectory: Boolean(e.isDirectory) }));
  }

  private normalizePath(path: string): string {
    // 统一路径分隔符
    return path.replace(/\\/g, '/');
  }
}

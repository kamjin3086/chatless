/**
 * 工具注册表 Adapter
 * 
 * 处理 tools__discover 和 tools__load 调用
 */

import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';
import { 
  TOOLS_DISCOVER_SERVER_NAME, 
  getGroupsSummary,
  type ToolGroupId,
} from '@/lib/mcp/nativeTools/toolRegistry';
import { useToolLoadRequestStore } from '@/store/toolLoadRequestStore';

export class ToolsRegistryAdapter implements ToolAdapter {
  readonly server = TOOLS_DISCOVER_SERVER_NAME;

  canHandle(invocation: ToolInvocation): boolean {
    return String(invocation.server || '').toLowerCase() === TOOLS_DISCOVER_SERVER_NAME;
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const tool = String(invocation.tool || '').toLowerCase();
    const args = invocation.args || {};

    switch (tool) {
      case 'discover':
        return this.handleDiscover();
      case 'load':
        return this.handleLoad(args);
      default:
        return { ok: false, error: `Unknown tools command: ${tool}` };
    }
  }

  private handleDiscover(): unknown {
    // 获取当前已加载的组
    const loadedGroups = useToolLoadRequestStore.getState().loadedGroups;
    
    // 获取所有可用组
    const allGroups = getGroupsSummary();
    
    const loaded = allGroups.filter(g => loadedGroups.includes(g.id));
    const available = allGroups.filter(g => !loadedGroups.includes(g.id));
    
    return {
      ok: true,
      loadedGroups: loaded.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
      })),
      availableGroups: available.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        howToLoad: `调用 tools__load({ group: "${g.id}" }) 可在下一轮加载此组工具`,
      })),
      hint: available.length > 0 
        ? `有 ${available.length} 个工具组未加载。如需使用，调用 tools__load 加载。`
        : '所有工具组已加载。',
    };
  }

  private handleLoad(args: Record<string, unknown>): unknown {
    const rawGroup = args.group;
    const groupId = typeof rawGroup === 'string' ? rawGroup : '';
    
    const validGroups: ToolGroupId[] = ['fs_extra', 'shell', 'web', 'ctx', 'skills'];
    if (!validGroups.includes(groupId as ToolGroupId)) {
      return {
        ok: false,
        error: `无效的工具组: ${groupId}`,
        validGroups,
      };
    }

    // 检查是否已加载
    const loadedGroups = useToolLoadRequestStore.getState().loadedGroups;
    if (loadedGroups.includes(groupId as ToolGroupId)) {
      return {
        ok: true,
        alreadyLoaded: true,
        message: `工具组 "${groupId}" 已经加载，无需重复加载。直接使用即可。`,
      };
    }

    // 记录加载请求，下一轮对话时会注入
    useToolLoadRequestStore.getState().requestLoad(groupId as ToolGroupId);

    const groupNames: Record<string, string> = {
      fs_extra: '文件管理（mkdir, rm, mv）',
      shell: '命令执行（run）',
      web: '网络工具（search, fetch, download）',
      ctx: '上下文管理（save_research, save_plan 等）',
      skills: '技能系统',
    };

    return {
      ok: true,
      message: `已请求加载工具组: ${groupNames[groupId] || groupId}`,
      note: '工具将在下一轮对话中可用。请继续你的任务。',
    };
  }
}

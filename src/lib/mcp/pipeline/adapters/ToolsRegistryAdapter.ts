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
  TOOL_GROUPS,
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
      case 'search':
        return this.handleSearch(args);
      default:
        return { ok: false, error: `Unknown tools command: ${tool}` };
    }
  }

  private handleSearch(args: Record<string, unknown>): unknown {
    const query = String(args.query || '').trim().toLowerCase();
    const offset = Math.max(0, Number(args.cursor || 0));
    const limit = Math.max(1, Math.min(50, Number(args.limit || 20)));
    if (!query) return { ok: false, error: 'query is required' };
    const matches = TOOL_GROUPS.flatMap((group) => group.tools.map(({ server, tool }) => ({
      group: group.id,
      server,
      name: tool.name,
      description: tool.description || '',
    }))).filter((item) => `${item.server} ${item.name} ${item.description}`.toLowerCase().includes(query));
    const page = matches.slice(offset, offset + limit);
    return {
      ok: true,
      query,
      results: page,
      nextCursor: offset + page.length < matches.length ? offset + page.length : null,
      total: matches.length,
      hint: '调用 tools__load({group}) 后，工具会在下一模型步生效。',
    };
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
    
    const validGroups: ToolGroupId[] = ['ctx', 'skill', 'prompt', 'coding', 'knowledge'];
    if (!validGroups.includes(groupId as ToolGroupId)) {
      // 对已废弃的组给出友好提示
      if (groupId === 'fs_extra' || groupId === 'shell' || groupId === 'web') {
        return {
          ok: true,
          alreadyLoaded: true,
          message: `工具组 "${groupId}" 已包含在核心工具中，无需加载。直接使用即可。`,
        };
      }
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
      ctx: '上下文管理（save_research, save_plan 等）',
      skill: '技能系统（查询、管理技能）',
      prompt: '提示词管理（列出、创建、编辑、删除）',
      coding: '代码工具（搜索、诊断、git 只读）',
      knowledge: '知识库工具（list/search/read）',
    };

    return {
      ok: true,
      message: `已请求加载工具组: ${groupNames[groupId] || groupId}`,
      note: '工具将在下一轮对话中可用。请继续你的任务。',
    };
  }
}

export type ToolCardKind = 'shell' | 'path' | 'url' | 'query' | 'generic';

export type ToolCardPresentation = {
  titleLine: string;
  detailLineLabel?: string;
  detailLineFull?: string;
  kind: ToolCardKind;
};

function s(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

function pickArg(args: Record<string, unknown> | undefined, key: string): string {
  if (!args) return '';
  return s((args as any)[key]);
}

export function presentToolCard(params: {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}): ToolCardPresentation {
  const server = String(params.server || '');
  const tool = String(params.tool || '');
  const srv = server.toLowerCase();
  const tl = tool.toLowerCase();
  const args = params.args || {};


  // ---------- skills ----------
  if (srv === 'skills') {
    if (tl === 'list_available_skills') return { titleLine: '列出可用技能', kind: 'generic' };
    if (tl === 'get_skill_instructions') return { titleLine: '查看技能说明', kind: 'generic' };
    if (tl === 'list_skill_actions') return { titleLine: '列出技能动作', kind: 'generic' };
    return { titleLine: '调用技能工具', detailLineLabel: '工具', detailLineFull: tool, kind: 'generic' };
  }

  // （兼容遗留）user_fs / skills_fs 不再对外暴露；这里保留通用兜底即可。

  // ---------- shell_executor ----------
  if (srv === 'shell_executor' || srv === 'shell-executor') {
    const cmd = pickArg(args, 'command');
    return { titleLine: '运行命令', detailLineLabel: '命令', detailLineFull: cmd, kind: 'shell' };
  }

  // ---------- web_search ----------
  if (srv === 'web_search') {
    const query = pickArg(args, 'query') || pickArg(args, 'search_term');
    return { titleLine: '网络搜索', detailLineLabel: '查询', detailLineFull: query, kind: 'query' };
  }

  // ---------- filesystem ----------
  if (srv === 'filesystem' || srv === 'file-system' || srv === 'fs') {
    const path = pickArg(args, 'path');
    const op =
      tl.includes('create_directory') || tl.includes('mkdir') || tl.includes('create-dir') ? '创建目录' :
      tl.includes('write') ? '写入文件' :
      tl.includes('delete') ? '删除文件' :
      tl.includes('read') ? '读取文件' :
      tl.includes('list') || tl.includes('dir') ? '列目录' :
      '文件系统操作';
    return { titleLine: op, detailLineLabel: '路径', detailLineFull: path, kind: 'path' };
  }

  // ---------- generic fallback ----------
  const maybeUrl = pickArg(args, 'url');
  if (maybeUrl) return { titleLine: '访问链接', detailLineLabel: 'URL', detailLineFull: maybeUrl, kind: 'url' };
  const maybePath = pickArg(args, 'path');
  if (maybePath) return { titleLine: `${server} 操作`, detailLineLabel: '路径', detailLineFull: maybePath, kind: 'path' };

  return { titleLine: `${server} · ${tool}`, kind: 'generic' };
}


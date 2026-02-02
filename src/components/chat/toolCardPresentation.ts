export type ToolCardKind = 'shell' | 'path' | 'url' | 'query' | 'generic';

export type ToolCardPresentation = {
  titleLine: string;
  detailLineLabel?: string;
  detailLineFull?: string;
  /** 截断后的预览（用于单行紧凑显示） */
  detailLineShort?: string;
  kind: ToolCardKind;
};

/** 截断字符串，保留首尾 */
function truncate(str: string, maxLen: number = 40): string {
  if (!str || str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + '...' + str.slice(-half);
}

/** 提取文件名（路径最后一部分） */
function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

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
    return { titleLine: '调用技能工具', detailLineLabel: '工具', detailLineFull: tool, detailLineShort: truncate(tool, 30), kind: 'generic' };
  }

  // ---------- ctx (Agent Context) ----------
  if (srv === 'ctx') {
    const topic = pickArg(args, 'topic');
    const title = pickArg(args, 'title');
    const type = pickArg(args, 'type');
    
    if (tl === 'save_research') {
      return { titleLine: '保存研究', detailLineLabel: '主题', detailLineFull: topic, detailLineShort: topic || '研究结果', kind: 'generic' };
    }
    if (tl === 'save_plan') {
      return { titleLine: '创建计划', detailLineLabel: '任务', detailLineFull: title, detailLineShort: truncate(title, 25) || '任务计划', kind: 'generic' };
    }
    if (tl === 'log_error') {
      const operation = pickArg(args, 'operation');
      return { titleLine: '记录错误', detailLineLabel: '操作', detailLineFull: operation, detailLineShort: truncate(operation, 25), kind: 'generic' };
    }
    if (tl === 'get') {
      const typeLabel = type === 'plan' ? '计划' : type === 'research' ? '研究' : type === 'errors' ? '错误' : '状态';
      return { titleLine: `检索${typeLabel}`, detailLineLabel: '类型', detailLineFull: type, detailLineShort: typeLabel, kind: 'generic' };
    }
    if (tl === 'update_step') {
      const stepIndex = pickArg(args, 'stepIndex');
      const status = pickArg(args, 'status');
      return { titleLine: '更新进度', detailLineLabel: '步骤', detailLineFull: `第${stepIndex}步: ${status}`, detailLineShort: `第${stepIndex}步`, kind: 'generic' };
    }
    return { titleLine: '上下文管理', detailLineLabel: '工具', detailLineFull: tool, detailLineShort: tool, kind: 'generic' };
  }

  // ---------- tools (工具发现) ----------
  if (srv === 'tools') {
    if (tl === 'discover') {
      return { titleLine: '发现工具', kind: 'generic' };
    }
    if (tl === 'load') {
      const group = pickArg(args, 'group');
      const groupNames: Record<string, string> = {
        fs_extra: '文件管理',
        shell: '命令执行',
        web: '网络工具',
        ctx: '上下文管理',
        skills: '技能系统',
      };
      return { titleLine: '加载工具组', detailLineLabel: '组', detailLineFull: group, detailLineShort: groupNames[group] || group, kind: 'generic' };
    }
    return { titleLine: '工具管理', kind: 'generic' };
  }

  // （兼容遗留）user_fs / skills_fs 不再对外暴露；这里保留通用兜底即可。

  // ---------- shell ----------
  if (srv === 'shell_executor' || srv === 'shell-executor' || srv === 'shell') {
    const cmd = pickArg(args, 'command');
    return { titleLine: '运行命令', detailLineLabel: '命令', detailLineFull: cmd, detailLineShort: truncate(cmd, 35), kind: 'shell' };
  }

  // ---------- web ----------
  if (srv === 'web_search' || srv === 'web') {
    const query = pickArg(args, 'query') || pickArg(args, 'search_term');
    const url = pickArg(args, 'url');
    const savePath = pickArg(args, 'savePath');
    
    if (tl === 'download') {
      const filename = savePath ? basename(savePath) : '';
      return { 
        titleLine: '下载文件', 
        detailLineLabel: '保存为', 
        detailLineFull: savePath, 
        detailLineShort: filename || truncate(url, 30),
        kind: 'path' 
      };
    }
    if (tl === 'fetch') {
      return { 
        titleLine: '抓取网页', 
        detailLineLabel: 'URL', 
        detailLineFull: url, 
        detailLineShort: truncate(url, 40),
        kind: 'url' 
      };
    }
    return { titleLine: '网络搜索', detailLineLabel: '查询', detailLineFull: query, detailLineShort: truncate(query, 25), kind: 'query' };
  }

  // ---------- filesystem / fs ----------
  if (srv === 'filesystem' || srv === 'file-system' || srv === 'fs') {
    const path = pickArg(args, 'path') || pickArg(args, 'oldPath');
    const dir = pickArg(args, 'dir');
    const pattern = pickArg(args, 'pattern');
    const hasDirPattern = !!dir && !!pattern;
    const displayPath = path || (hasDirPattern ? `${dir.replace(/\\/g, '/')}/${pattern}` : '');
    const filename = basename(displayPath);
    const op =
      tl === 'mkdir' || tl.includes('create_directory') || tl.includes('create-dir') ? '创建目录' :
      tl === 'write' || tl.includes('write') ? '写入文件' :
      tl === 'rm' || tl.includes('delete') ? '删除文件' :
      tl === 'read' || tl.includes('read') ? '读取文件' :
      tl === 'ls' || tl.includes('list') || tl.includes('dir') ? '列目录' :
      tl === 'mv' || tl.includes('rename') ? '移动文件' :
      '文件操作';
    if (tl === 'rm' || tl.includes('delete')) {
      const label = hasDirPattern ? '范围' : '路径';
      const full = displayPath;
      const short = hasDirPattern ? truncate(displayPath, 40) : (filename || truncate(displayPath, 30));
      return { titleLine: op, detailLineLabel: label, detailLineFull: full, detailLineShort: short, kind: 'path' };
    }
    return { titleLine: op, detailLineLabel: '路径', detailLineFull: displayPath, detailLineShort: filename || truncate(displayPath, 30), kind: 'path' };
  }

  // ---------- generic fallback ----------
  const maybeUrl = pickArg(args, 'url');
  if (maybeUrl) return { titleLine: '访问链接', detailLineLabel: 'URL', detailLineFull: maybeUrl, detailLineShort: truncate(maybeUrl, 40), kind: 'url' };
  const maybePath = pickArg(args, 'path');
  if (maybePath) return { titleLine: `${server} 操作`, detailLineLabel: '路径', detailLineFull: maybePath, detailLineShort: basename(maybePath) || truncate(maybePath, 30), kind: 'path' };

  return { titleLine: `${server} · ${tool}`, kind: 'generic' };
}


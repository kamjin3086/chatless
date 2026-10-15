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

/**
 * The front of a long value, on one line.
 *
 * Head-and-tail truncation was the old habit, and for a command it printed the program and
 * the closing punctuation of the script - `$exts=@(jpg,j... "$(__.Count)" }` - while for a
 * URL it printed `https://example.co...path/he`. Both cut away the part a reader scans for.
 * The front is what identifies a value, so the tail goes, and the cut lands on a word
 * boundary rather than inside a flag.
 */
export function previewLine(value: string, maxLen = 70): string {
  const oneLine = String(value || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  const head = oneLine.slice(0, maxLen);
  return `${head.replace(/\s+\S*$/, '')}…`;
}

/** A shell preview: one line, and a continued line counts as one command. */
export function previewCommand(command: string, maxLen = 70): string {
  return previewLine(String(command || '').replace(/\\\s*\n/g, ' '), maxLen);
}

/**
 * What an external tool returned, in the few characters a person can read.
 *
 * A weather query came back looking like `{"content":[{"type":"text","text":"上海：晴…"}]}`
 * because the card printed the envelope: MCP results are a wrapper around text, and the
 * wrapper says nothing the user asked for. Anything this cannot understand is still printed
 * in full, because a preview that hides the result is worse than an ugly one.
 */
export function previewResult(value: unknown): string {
  const parsed = coerceResult(value);
  if (parsed === null || parsed === undefined) return '';
  // The result box scrolls, so prose is shown whole: the complaint was that it was
  // unreadable, not that it was long, and cutting here would eat the "truncated" marker
  // the store already added.
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) {
    const scalars = parsed.filter(
      (x) => typeof x === 'string' || typeof x === 'number',
    );
    if (scalars.length === parsed.length && scalars.length > 0)
      return previewLine(scalars.slice(0, 6).map((x) => String(x)).join(' · '), 600);
    return `${parsed.length} 项`;
  }
  if (typeof parsed === 'object') {
    const pairs = pairValues(parsed as Record<string, unknown>, Object.keys(parsed));
    if (pairs) return previewLine(pairs, 600);
    try {
      return previewLine(JSON.stringify(parsed), 600);
    } catch {
      return '';
    }
  }
  return String(parsed);
}

/** A result that arrived already stringified is still a result, not prose to print raw. */
function coerceResult(value: unknown): unknown {
  let current = value;
  if (typeof current === 'string') {
    const text = current.trim();
    if (!/^[{[]/.test(text)) return text;
    try {
      current = JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    const record = current as Record<string, unknown>;
    const content = record.content;
    if (Array.isArray(content)) {
      const texts = content
        .filter((part) => part && typeof part === 'object')
        .map((part) => (part as Record<string, unknown>).text)
        .filter((text) => typeof text === 'string' && text.trim() !== '')
        .map((text) => String(text).trim());
      if (texts.length > 0) return texts.join('\n');
    }
    // A store-side truncation says `Object(9000 chars)` plus a raw preview; that shape is
    // the store's own honesty, so keep both lines rather than squeezing it into a pair.
    if (
      typeof record.summary === 'string' &&
      typeof record.preview === 'string' &&
      Object.keys(record).length === 2
    )
      return `${record.summary}\n${record.preview}`;
    for (const key of ['result', 'data', 'output']) {
      if (key in record && Object.keys(record).length === 1)
        return coerceResult(record[key]);
    }
  }
  return current;
}

/** Keys whose value says what the call is about, most informative first. */
const ABOUT_KEYS = [
  'query', 'search_query', 'q', 'question', 'search', 'keyword', 'term', 'text',
  'prompt', 'message', 'input', 'city', 'location', 'address', 'place', 'country',
  'region', 'date', 'time', 'name', 'title', 'subject', 'path', 'file_path', 'file',
  'directory', 'dir', 'url', 'id', 'sql', 'pattern', 'command',
];

/** Knobs that tune a call. They are never what a reader is scanning for. */
const NOISE_KEY = /^(units?|unit|lang|language|locale|format|pretty(?:_print)?|verbose|debug|trace|page|limit|offset|count|max_?results?(?:_count)?|top_?k|timeout(?:_ms)?|mode|version|recursive|depth|include.*|exclude.*)$/i;

/** Values that must never be printed into a transcript surface. */
const SECRET_KEY = /(api[_-]?key|token|secret|passwor(?:d|d)|credential|authorization|cookie)/i;

function shortValue(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const scalars = v.filter(
      (x) => typeof x === 'string' || typeof x === 'number',
    );
    if (scalars.length === 0) return '';
    const shown = scalars.slice(0, 3).map((x) => String(x)).join('、');
    return scalars.length > 3 ? `${shown}…` : shown;
  }
  if (typeof v !== 'string') return '';
  return v.length > 40 ? `${v.slice(0, 39)}…` : v;
}

/**
 * The few arguments worth showing for a tool this app knows nothing about. An external
 * (MCP) tool otherwise arrives as a name - `weather · get_forecast` tells the user that
 * something happened, not whether it asked about Shanghai or Berlin.
 */
function pairValues(
  values: Record<string, unknown>,
  orderedKeys: string[],
  limit = 3,
): string {
  const parts: string[] = [];
  for (const key of orderedKeys) {
    if (parts.length >= limit) break;
    if (SECRET_KEY.test(key) || NOISE_KEY.test(key)) continue;
    const value = shortValue(values[key]);
    if (!value) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join(' · ');
}

function describeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args || {});
  return pairValues(args, [
    ...ABOUT_KEYS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !ABOUT_KEYS.includes(k)),
  ]);
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


  // ---------- skills (旧) / skill (新) ----------
  if (srv === 'skills' || srv === 'skill') {
    const id = pickArg(args, 'id');
    const name = pickArg(args, 'name');
    const skillLabel = id || name || '';
    
    // 使用类（只读）
    if (tl === 'list_available_skills' || tl === 'list') {
      return { titleLine: '列出技能', kind: 'generic' };
    }
    if (tl === 'get_skill_instructions' || tl === 'guide' || tl === 'use' || tl === 'get') {
      return { titleLine: '获取技能指南', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'list_resources' || tl === 'list_files') {
      return { titleLine: '列出技能资源', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'get_template' || tl === 'read_file') {
      const resourceName = pickArg(args, 'name') || pickArg(args, 'path');
      return { titleLine: '获取模板', detailLineLabel: '文件', detailLineFull: resourceName, detailLineShort: truncate(resourceName, 25), kind: 'generic' };
    }
    if (tl === 'list_skill_actions') {
      return { titleLine: '列出技能动作', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    
    // 管理类
    if (tl === 'install') {
      const repoUrl = pickArg(args, 'repoUrl');
      return { titleLine: '安装技能', detailLineLabel: '来源', detailLineFull: repoUrl, detailLineShort: truncate(repoUrl, 30), kind: 'generic' };
    }
    if (tl === 'uninstall') {
      return { titleLine: '卸载技能', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'update') {
      return { titleLine: '更新技能', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'enable') {
      return { titleLine: '启用技能', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'disable') {
      return { titleLine: '禁用技能', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'check_deps') {
      return { titleLine: '检查依赖', detailLineLabel: '技能', detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    
    // 编辑类
    if (tl === 'edit_resource' || tl === 'write_file') {
      const resourceName = pickArg(args, 'name') || pickArg(args, 'path');
      return { titleLine: '编辑技能资源', detailLineLabel: '文件', detailLineFull: resourceName, detailLineShort: truncate(resourceName, 25), kind: 'generic' };
    }
    
    return { titleLine: 'skill 操作', detailLineLabel: '工具', detailLineFull: tool, detailLineShort: truncate(tool, 30), kind: 'generic' };
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
    return { titleLine: '运行命令', detailLineLabel: '命令', detailLineFull: cmd, detailLineShort: previewCommand(cmd), kind: 'shell' };
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

  // ---------- system (提示词管理) ----------
  if (srv === 'system') {
    const id = pickArg(args, 'id');
    const name = pickArg(args, 'name');
    const promptLabel = name || id || '';
    
    if (tl === 'list_prompts') {
      return { titleLine: '列出提示词', kind: 'generic' };
    }
    if (tl === 'get_prompt') {
      return { titleLine: '获取提示词', detailLineLabel: '名称', detailLineFull: promptLabel, detailLineShort: truncate(promptLabel, 20), kind: 'generic' };
    }
    if (tl === 'create_prompt') {
      return { titleLine: '创建提示词', detailLineLabel: '名称', detailLineFull: name, detailLineShort: truncate(name, 20), kind: 'generic' };
    }
    if (tl === 'update_prompt') {
      return { titleLine: '更新提示词', detailLineLabel: '名称', detailLineFull: promptLabel, detailLineShort: truncate(promptLabel, 20), kind: 'generic' };
    }
    if (tl === 'delete_prompt') {
      return { titleLine: '删除提示词', detailLineLabel: 'ID', detailLineFull: id, detailLineShort: truncate(id, 20), kind: 'generic' };
    }
    if (tl === 'optimize_prompt') {
      return { titleLine: '优化提示词', detailLineLabel: 'ID', detailLineFull: id, detailLineShort: truncate(id, 20), kind: 'generic' };
    }
    return { titleLine: '系统操作', detailLineLabel: '工具', detailLineFull: tool, detailLineShort: truncate(tool, 25), kind: 'generic' };
  }

  // ---------- generic fallback ----------
  const maybeUrl = pickArg(args, 'url');
  if (maybeUrl)
    return {
      titleLine: '访问链接',
      detailLineLabel: 'URL',
      detailLineFull: maybeUrl,
      detailLineShort: previewLine(maybeUrl, 55),
      kind: 'url',
    };
  const maybePath = pickArg(args, 'path');
  if (maybePath) return { titleLine: `${server} 操作`, detailLineLabel: '路径', detailLineFull: maybePath, detailLineShort: basename(maybePath) || truncate(maybePath, 30), kind: 'path' };

  // 尝试生成友好的回退名称
  const friendlyServerNames: Record<string, string> = {
    'fs': '文件',
    'filesystem': '文件',
    'shell': '命令',
    'web': '网络',
    'skill': '技能',
    'skills': '技能',
    'ctx': '上下文',
    'system': '系统',
    'tools': '工具',
  };
  const friendlyServer = friendlyServerNames[srv] || server;
  const about = describeArgs(args);

  return {
    titleLine: `${friendlyServer} · ${tool}`,
    detailLineLabel: about ? '参数' : undefined,
    detailLineFull: about || undefined,
    detailLineShort: about || undefined,
    kind: 'generic',
  };
}


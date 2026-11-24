import { translate } from '@/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';

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
 * One line, no hard length limit.
 *
 * Two habits were wrong here. Head-and-tail truncation printed a command's program and its
 * closing punctuation - `$exts=@(jpg,j... "$(__.Count)" }` - and a URL came out as
 * `https://example.co...path/he`: both cut away the part a reader scans for. And the length
 * limit did not belong in the data at all, because the row knows how much room it has and
 * ellipsizes it. So this collapses to one line and stops; the row does the cutting and a
 * wide window shows more than a narrow one.
 */
export function previewLine(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** A shell preview: one line, and a continued line counts as one command. */
export function previewCommand(command: string): string {
  return previewLine(String(command || '').replace(/\\\s*\n/g, ' '));
}

/**
 * What an external tool returned, in the few characters a person can read.
 *
 * A weather query came back looking like `{"content":[{"type":"text","text":"上海：晴…"}]}`
 * because the card printed the envelope: MCP results are a wrapper around text, and the
 * wrapper says nothing the user asked for. Anything this cannot understand is still printed
 * in full, because a preview that hides the result is worse than an ugly one.
 */
export function previewResult(locale: Locale, value: unknown): string {
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
      return previewLine(scalars.slice(0, 6).map((x) => String(x)).join(' · '));
    return translate(locale, parsed.length === 1 ? 'toolCall.resultCount.one' : 'toolCall.resultCount.other')
      .replace('{count}', String(parsed.length));
  }
  if (typeof parsed === 'object') {
    const pairs = pairValues(
      locale,
      parsed as Record<string, unknown>,
      Object.keys(parsed),
      true,
    );
    if (pairs) return previewLine(pairs);
    try {
      return previewLine(JSON.stringify(parsed));
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

function shortValue(locale: Locale, v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const scalars = v.filter(
      (x) => typeof x === 'string' || typeof x === 'number',
    );
    if (scalars.length === 0) return '';
    const shown = scalars.slice(0, 3).map((x) => String(x)).join(translate(locale, 'toolCall.listSeparator'));
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
/**
 * `key=value` pairs, or bare values when the row already says what the call is.
 *
 * The asymmetry is deliberate: `天气查询 上海` reads, and so does `temp_c=28 · city=上海`,
 * while `天气查询 city=上海` says the same thing twice and `28 · 上海` is a riddle.
 */
function pairValues(
  locale: Locale,
  values: Record<string, unknown>,
  orderedKeys: string[],
  withKeys: boolean,
  limit = 3,
): string {
  const parts: string[] = [];
  for (const key of orderedKeys) {
    if (parts.length >= limit) break;
    if (SECRET_KEY.test(key) || NOISE_KEY.test(key)) continue;
    const value = shortValue(locale, values[key]);
    if (!value) continue;
    parts.push(withKeys ? `${key}=${value}` : value);
  }
  return parts.join(' · ');
}

function describeArgs(locale: Locale, args: Record<string, unknown>): string {
  const keys = Object.keys(args || {});
  return pairValues(
    locale,
    args,
    [
      ...ABOUT_KEYS.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !ABOUT_KEYS.includes(k)),
    ],
    false,
  );
}

/**
 * A verb for an external tool, when one can be guessed safely. A confident wrong verb reads
 * worse than the raw `server · tool`, so this list is short and every entry is pinned by a
 * test - anything not on it keeps the names the user can grep for.
 */
const TOOL_VERBS: Array<[RegExp, TranslationKey]> = [
  [/forecast|weather/i, 'toolCall.weather'],
  [/translate/i, 'toolCall.translate'],
  [/search|query|lookup/i, 'toolCall.search'],
  [/fetch|browse|scrape|webpage/i, 'toolCall.fetchPage'],
  [/^(send|notify|post_message)/i, 'toolCall.send'],
  [/^list[_-]/i, 'toolCall.list'],
  [/download/i, 'toolCall.download'],
];

function describeToolName(locale: Locale, server: string, tool: string): string {
  const verb = TOOL_VERBS.find(([pattern]) => pattern.test(tool))?.[1];
  return verb ? translate(locale, verb) : `${server} · ${tool}`;
}

export function presentToolCard(locale: Locale, params: {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}): ToolCardPresentation {
  const t = (key: TranslationKey) => translate(locale, key);
  const server = String(params.server || '');
  const tool = String(params.tool || '');
  const srv = server.toLowerCase();
  const tl = tool.toLowerCase();
  const args = params.args || {};

  // ---------- tool_result：大结果的后续分页 ----------
  // 卡片如果写成 `tool_result · read`，用户看到的是一句内部术语：它读的不是文件，
  // 是之前某条过长而被截断的工具结果。
  if (srv === 'tool_result' && tl === 'read') {
    return { titleLine: t('toolCall.readSavedResult'), kind: 'generic' };
  }


  // ---------- skills (旧) / skill (新) ----------
  if (srv === 'skills' || srv === 'skill') {
    const id = pickArg(args, 'id');
    const name = pickArg(args, 'name');
    const skillLabel = id || name || '';
    
    // 使用类（只读）
    if (tl === 'list_available_skills' || tl === 'list') {
      return { titleLine: t('toolCall.listSkills'), kind: 'generic' };
    }
    if (tl === 'get_skill_instructions' || tl === 'guide' || tl === 'use' || tl === 'get') {
      return { titleLine: t('toolCall.getSkillGuide'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'list_resources' || tl === 'list_files') {
      return { titleLine: t('toolCall.listSkillResources'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'get_template' || tl === 'read_file') {
      const resourceName = pickArg(args, 'name') || pickArg(args, 'path');
      return { titleLine: t('toolCall.getTemplate'), detailLineLabel: t('toolCall.detail.file'), detailLineFull: resourceName, detailLineShort: truncate(resourceName, 25), kind: 'generic' };
    }
    if (tl === 'list_skill_actions') {
      return { titleLine: t('toolCall.listSkillActions'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    
    // 管理类
    if (tl === 'install') {
      const repoUrl = pickArg(args, 'repoUrl');
      return { titleLine: t('toolCall.installSkill'), detailLineLabel: t('toolCall.detail.source'), detailLineFull: repoUrl, detailLineShort: truncate(repoUrl, 30), kind: 'generic' };
    }
    if (tl === 'uninstall') {
      return { titleLine: t('toolCall.uninstallSkill'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'update') {
      return { titleLine: t('toolCall.updateSkill'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'enable') {
      return { titleLine: t('toolCall.enableSkill'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'disable') {
      return { titleLine: t('toolCall.disableSkill'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    if (tl === 'check_deps') {
      return { titleLine: t('toolCall.checkDependencies'), detailLineLabel: t('toolCall.detail.skill'), detailLineFull: skillLabel, detailLineShort: truncate(skillLabel, 20), kind: 'generic' };
    }
    
    // 编辑类
    if (tl === 'edit_resource' || tl === 'write_file') {
      const resourceName = pickArg(args, 'name') || pickArg(args, 'path');
      return { titleLine: t('toolCall.editSkillResource'), detailLineLabel: t('toolCall.detail.file'), detailLineFull: resourceName, detailLineShort: truncate(resourceName, 25), kind: 'generic' };
    }
    
    return { titleLine: t('toolCall.skillOperation'), detailLineLabel: t('toolCall.detail.tool'), detailLineFull: tool, detailLineShort: truncate(tool, 30), kind: 'generic' };
  }

  // ---------- ctx (Agent Context) ----------
  if (srv === 'ctx') {
    const topic = pickArg(args, 'topic');
    const title = pickArg(args, 'title');
    const type = pickArg(args, 'type');
    
    if (tl === 'save_research') {
      return { titleLine: t('toolCall.saveResearch'), detailLineLabel: t('toolCall.detail.topic'), detailLineFull: topic, detailLineShort: topic || t('toolCall.researchResults'), kind: 'generic' };
    }
    if (tl === 'save_plan') {
      return { titleLine: t('toolCall.createPlan'), detailLineLabel: t('toolCall.detail.task'), detailLineFull: title, detailLineShort: truncate(title, 25) || t('toolCall.taskPlan'), kind: 'generic' };
    }
    if (tl === 'log_error') {
      const operation = pickArg(args, 'operation');
      return { titleLine: t('toolCall.logError'), detailLineLabel: t('toolCall.detail.operation'), detailLineFull: operation, detailLineShort: truncate(operation, 25), kind: 'generic' };
    }
    if (tl === 'get') {
      const [title, typeLabel]: [TranslationKey, TranslationKey] = type === 'plan'
        ? ['toolCall.getPlan', 'toolCall.detail.plan']
        : type === 'research'
          ? ['toolCall.getResearch', 'toolCall.detail.research']
          : type === 'errors'
            ? ['toolCall.getErrors', 'toolCall.detail.errors']
            : ['toolCall.getState', 'toolCall.detail.state'];
      return { titleLine: t(title), detailLineLabel: t('toolCall.detail.type'), detailLineFull: type, detailLineShort: t(typeLabel), kind: 'generic' };
    }
    if (tl === 'update_step') {
      const stepIndex = pickArg(args, 'stepIndex');
      const status = pickArg(args, 'status');
      return {
        titleLine: t('toolCall.updateProgress'),
        detailLineLabel: t('toolCall.detail.step'),
        detailLineFull: t('toolCall.stepStatus').replace(/\{(index|status)\}/g, (_, key) => key === 'index' ? stepIndex : status),
        detailLineShort: t('toolCall.stepNumber').replace('{index}', () => stepIndex),
        kind: 'generic',
      };
    }
    return { titleLine: t('toolCall.manageContext'), detailLineLabel: t('toolCall.detail.tool'), detailLineFull: tool, detailLineShort: tool, kind: 'generic' };
  }

  // ---------- tools (工具发现) ----------
  if (srv === 'tools') {
    if (tl === 'discover') {
      return { titleLine: t('toolCall.discoverTools'), kind: 'generic' };
    }
    if (tl === 'load') {
      const group = pickArg(args, 'group');
      const groupNames: Record<string, string> = {
        fs_extra: t('toolCall.group.files'),
        shell: t('toolCall.group.shell'),
        web: t('toolCall.group.web'),
        ctx: t('toolCall.manageContext'),
        skills: t('toolCall.group.skills'),
      };
      const groupLabel = Object.hasOwn(groupNames, group) ? groupNames[group] : group;
      return { titleLine: t('toolCall.loadToolGroup'), detailLineLabel: t('toolCall.detail.group'), detailLineFull: group, detailLineShort: groupLabel, kind: 'generic' };
    }
    return { titleLine: t('toolCall.manageTools'), kind: 'generic' };
  }

  // （兼容遗留）user_fs / skills_fs 不再对外暴露；这里保留通用兜底即可。

  // ---------- shell ----------
  if (srv === 'shell_executor' || srv === 'shell-executor' || srv === 'shell') {
    const cmd = pickArg(args, 'command');
    return { titleLine: t('toolCall.run'), detailLineLabel: t('toolCall.detail.command'), detailLineFull: cmd, detailLineShort: previewCommand(cmd), kind: 'shell' };
  }

  // ---------- web ----------
  if (srv === 'web_search' || srv === 'web') {
    const query = pickArg(args, 'query') || pickArg(args, 'search_term');
    const url = pickArg(args, 'url');
    const savePath = pickArg(args, 'savePath');
    
    if (tl === 'download') {
      const filename = savePath ? basename(savePath) : '';
      return {
        titleLine: t('toolCall.downloadFile'),
        detailLineLabel: t('toolCall.detail.saveAs'),
        detailLineFull: savePath,
        detailLineShort: filename || truncate(url, 30),
        kind: 'path',
      };
    }
    if (tl === 'fetch') {
      return {
        titleLine: t('toolCall.fetchPage'),
        detailLineLabel: 'URL',
        detailLineFull: url,
        detailLineShort: truncate(url, 40),
        kind: 'url',
      };
    }
    return { titleLine: t('toolCall.webSearch'), detailLineLabel: t('toolCall.detail.query'), detailLineFull: query, detailLineShort: truncate(query, 25), kind: 'query' };
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
      tl === 'mkdir' || tl.includes('create_directory') || tl.includes('create-dir') ? t('toolCall.createDirectory') :
      tl === 'write' || tl.includes('write') ? t('toolCall.writeFile') :
      tl === 'rm' || tl.includes('delete') ? t('toolCall.deleteFile') :
      tl === 'read' || tl.includes('read') ? t('toolCall.readFile') :
      tl === 'ls' || tl.includes('list') || tl.includes('dir') ? t('toolCall.listDirectory') :
      tl === 'mv' || tl.includes('rename') ? t('toolCall.moveFile') :
      t('toolCall.fileOperation');
    if (tl === 'rm' || tl.includes('delete')) {
      const label = t(hasDirPattern ? 'toolCall.detail.scope' : 'toolCall.detail.path');
      const full = displayPath;
      const short = hasDirPattern ? truncate(displayPath, 40) : (filename || truncate(displayPath, 30));
      return { titleLine: op, detailLineLabel: label, detailLineFull: full, detailLineShort: short, kind: 'path' };
    }
    return { titleLine: op, detailLineLabel: t('toolCall.detail.path'), detailLineFull: displayPath, detailLineShort: filename || truncate(displayPath, 30), kind: 'path' };
  }

  // ---------- system (提示词管理) ----------
  if (srv === 'system') {
    const id = pickArg(args, 'id');
    const name = pickArg(args, 'name');
    const promptLabel = name || id || '';
    
    if (tl === 'list_prompts') {
      return { titleLine: t('toolCall.listPrompts'), kind: 'generic' };
    }
    if (tl === 'get_prompt') {
      return { titleLine: t('toolCall.getPrompt'), detailLineLabel: t('toolCall.detail.name'), detailLineFull: promptLabel, detailLineShort: truncate(promptLabel, 20), kind: 'generic' };
    }
    if (tl === 'create_prompt') {
      return { titleLine: t('toolCall.createPrompt'), detailLineLabel: t('toolCall.detail.name'), detailLineFull: name, detailLineShort: truncate(name, 20), kind: 'generic' };
    }
    if (tl === 'update_prompt') {
      return { titleLine: t('toolCall.updatePrompt'), detailLineLabel: t('toolCall.detail.name'), detailLineFull: promptLabel, detailLineShort: truncate(promptLabel, 20), kind: 'generic' };
    }
    if (tl === 'delete_prompt') {
      return { titleLine: t('toolCall.deletePrompt'), detailLineLabel: 'ID', detailLineFull: id, detailLineShort: truncate(id, 20), kind: 'generic' };
    }
    if (tl === 'optimize_prompt') {
      return { titleLine: t('toolCall.optimizePrompt'), detailLineLabel: 'ID', detailLineFull: id, detailLineShort: truncate(id, 20), kind: 'generic' };
    }
    return { titleLine: t('toolCall.systemOperation'), detailLineLabel: t('toolCall.detail.tool'), detailLineFull: tool, detailLineShort: truncate(tool, 25), kind: 'generic' };
  }

  // ---------- Android 手机能力 ----------
  // 这些工具没有桌面同名物，不映射就会落到 `android_directory · inventory` 这种
  // 内部名字上，手机上阅读卡片的人看不懂。
  if (srv === 'android_directory') {
    if (tl === 'summarize') {
      return { titleLine: t('toolCall.androidFolderSummarize'), kind: 'path' };
    }
    if (tl === 'export') {
      return { titleLine: t('toolCall.androidFolderExport'), kind: 'path' };
    }
    if (tl === 'read_file') {
      const path = pickArg(args, 'under');
      return {
        titleLine: t('toolCall.androidFileRead'),
        detailLineLabel: path ? t('toolCall.detail.path') : undefined,
        detailLineFull: path || undefined,
        detailLineShort: path ? truncate(path, 28) : undefined,
        kind: 'path',
      };
    }
    if (tl === 'write_file') {
      const path = pickArg(args, 'under');
      const mode = pickArg(args, 'mode');
      return {
        titleLine:
          mode === 'append'
            ? t('toolCall.androidFileAppend')
            : mode === 'overwrite'
              ? t('toolCall.androidFileOverwrite')
              : t('toolCall.androidFileWrite'),
        detailLineLabel: path ? t('toolCall.detail.path') : undefined,
        detailLineFull: path || undefined,
        detailLineShort: path ? truncate(path, 28) : undefined,
        kind: 'path',
      };
    }
    const mime = pickArg(args, 'mimeType');
    return {
      titleLine: t('toolCall.androidFolderInventory'),
      detailLineLabel: mime ? t('toolCall.detail.mime') : undefined,
      detailLineFull: mime || undefined,
      detailLineShort: mime || undefined,
      kind: 'path',
    };
  }
  if (srv === 'android_photos') {
    return { titleLine: t('toolCall.androidPhotoGroups'), kind: 'path' };
  }
  if (srv === 'android_document') {
    if (tl === 'excerpt') {
      return {
        titleLine: t('toolCall.androidDocumentExcerpt'),
        kind: 'path',
      };
    }
    const query = pickArg(args, 'query');
    return {
      titleLine: t('toolCall.androidDocumentSearch'),
      detailLineLabel: t('toolCall.detail.query'),
      detailLineFull: query,
      detailLineShort: truncate(query, 25),
      kind: 'query',
    };
  }
  if (srv === 'android_countdown') {
    const seconds = typeof args?.durationSeconds === 'number' && args.durationSeconds > 0
      ? Math.round(args.durationSeconds)
      : 0;
    return {
      titleLine: t('toolCall.androidTimer'),
      detailLineLabel: seconds ? t('toolCall.detail.duration') : undefined,
      detailLineFull: seconds ? t('toolCall.duration').replace('{seconds}', String(seconds)) : undefined,
      detailLineShort: seconds ? t('toolCall.duration').replace('{seconds}', String(seconds)) : undefined,
      kind: 'generic',
    };
  }

  // ---------- generic fallback ----------
  const maybeUrl = pickArg(args, 'url');
  if (maybeUrl)
    return {
      titleLine: t('toolCall.openLink'),
      detailLineLabel: 'URL',
      detailLineFull: maybeUrl,
      detailLineShort: previewLine(maybeUrl),
      kind: 'url',
    };
  const maybePath = pickArg(args, 'path');
  if (maybePath) return { titleLine: t('toolCall.serverOperation').replace('{server}', () => server), detailLineLabel: t('toolCall.detail.path'), detailLineFull: maybePath, detailLineShort: basename(maybePath) || truncate(maybePath, 30), kind: 'path' };

  const about = describeArgs(locale, args);

  return {
    titleLine: describeToolName(locale, server, tool),
    detailLineLabel: about ? t('toolCall.arguments') : undefined,
    detailLineFull: about || undefined,
    detailLineShort: about || undefined,
    kind: 'generic',
  };
}


/**
 * The localized duration for a tool row, such as `1.2s`.
 *
 * One decimal below ten seconds, because the point of the column is spotting the call that took
 * 40 seconds and 0.4 s is materially different from 0. Above ten seconds the tenth does not
 * inform anything, so it rounds. A missing, zero or negative value renders nothing - an old row
 * must look exactly as it did before the field existed.
 */
export function formatToolDuration(locale: Locale, seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = seconds < 10
    ? Math.max(0.1, Math.round(seconds * 10) / 10).toFixed(1)
    : String(Math.round(seconds));
  return translate(locale, 'toolCall.duration').replace('{seconds}', rounded);
}

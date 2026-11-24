/**
 * SKILL.md 解析器
 * 
 * 解析 Anthropic Skills 的 SKILL.md 文件
 * 提取 YAML frontmatter 和 Markdown 内容
 * 支持解析 actions 定义
 */

import type { 
  SkillFrontmatter, 
  SkillDependency, 
  DependencyType,
  SkillAction,
  SkillActionType,
  SkillRiskLevel,
  ScriptRuntime,
  SkillFileOperation,
} from './types';

/**
 * SKILL.md 解析结果
 */
export interface SkillMdParseResult {
  /** 解析成功 */
  success: boolean;
  /** frontmatter 数据 */
  frontmatter: SkillFrontmatter | null;
  /** Markdown 内容（不含 frontmatter） */
  content: string;
  /** 原始内容 */
  rawContent: string;
  /** 解析出的动作列表 */
  actions: SkillAction[];
  /** 错误信息 */
  error?: string;
  /**
   * 解析活了、但某个键没被读成写的人以为的那个意思。不是检验：拼错的
   * `disable-model-invocatoin` 与「没写这个键」在解析结果里长得一模一样，不提醒
   * 就只能到行为不对时才发现。
   */
  warnings?: string[];
}

/**
 * YAML frontmatter 正则
 * 匹配 --- 开头和结尾的 YAML 块
 */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

/**
 * 解析 SKILL.md 内容
 * 
 * @param rawContent SKILL.md 的原始文本内容
 * @returns 解析结果
 */
export function parseSkillMd(rawContent: string): SkillMdParseResult {
  if (!rawContent || typeof rawContent !== 'string') {
    return {
      success: false,
      frontmatter: null,
      content: '',
      rawContent: rawContent || '',
      actions: [],
      error: 'Invalid input: content is empty or not a string',
    };
  }

  const trimmed = rawContent.trim();
  const match = trimmed.match(FRONTMATTER_REGEX);

  if (!match) {
    // 没有 frontmatter，整个内容就是 Markdown
    return {
      success: true,
      frontmatter: null,
      content: trimmed,
      rawContent,
      actions: [],
    };
  }

  const yamlContent = match[1];
  const markdownContent = trimmed.slice(match[0].length).trim();

  try {
    const { frontmatter, actions, warnings } = parseYamlFrontmatter(yamlContent);
    return {
      success: true,
      frontmatter,
      content: markdownContent,
      rawContent,
      actions,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      frontmatter: null,
      content: markdownContent,
      rawContent,
      actions: [],
      error: `Failed to parse frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 解析结果（包含 frontmatter 和 actions）
 */
interface ParsedFrontmatterResult {
  frontmatter: SkillFrontmatter;
  actions: SkillAction[];
  warnings: string[];
}

/**
 * 简易 YAML 解析器
 * 只支持 SKILL.md 中使用的简单 YAML 结构
 * 支持解析 actions 定义
 * 
 * @param yaml YAML 字符串
 * @returns 解析后的 frontmatter 对象和 actions 列表
 */
function parseYamlFrontmatter(yaml: string): ParsedFrontmatterResult {
  const lines = yaml.split('\n');
  const result: Record<string, any> = {};
  
  let currentKey: string | null = null;
  let currentArray: any[] | null = null;
  let currentObject: Record<string, any> | null = null;
  let inDependencies = false;
  let inActions = false;
  let currentAction: Record<string, any> | null = null;
  let indentLevel = 0;
  // 正在收集 YAML 块标量（`description: >` 这种写法在已有的 SKILL.md 里很常见）
  let pendingBlock: { key: string; fold: boolean } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // 计算缩进级别
    const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
    
    // 检查是否是顶级键值对
    // 键名可以带连字符：事实标准的键就是 `disable-model-invocation`、`allowed-tools`，
    // 只认 `\w` 会把它们整行静丢掉。
    const topLevelKvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (topLevelKvMatch && leadingSpaces === 0) {
      const [, key, value] = topLevelKvMatch;
      const trimmedValue = value.trim();
      currentKey = key;
      pendingBlock = null;
      
      if (trimmedValue === '' || trimmedValue === '|' || trimmedValue === '>' || /^[|>][-+]?\d*$/.test(trimmedValue)) {
        // YAML 块标量（`|` 保留换行、`>` 折叠成行）或下面要接数组/对象
        if (trimmedValue === '|' || trimmedValue === '>' || /^[|>][-+]?\d*$/.test(trimmedValue)) {
          pendingBlock = { key, fold: trimmedValue.startsWith('>') };
          result[key] = '';
          currentArray = null;
          currentObject = null;
          inDependencies = false;
          inActions = false;
          currentAction = null;
          continue;
        }
        // 空值：数组/对象开始
        currentArray = [];
        result[key] = currentArray;
        inDependencies = key === 'dependencies';
        inActions = key === 'actions';
        currentAction = null;
      } else {
        // 单行值（可能后面还接缩进续行：YAML 的 plain 多行标量就是这么写的）
        currentArray = null;
        currentObject = null;
        inDependencies = false;
        inActions = false;
        currentAction = null;
        pendingBlock = { key, fold: true };
        // 移除引号
        result[key] = trimmedValue.replace(/^["']|["']$/g, '');
      }
      continue;
    }

    // YAML 块标量的正文：比键缩进、且不是 `key: value` 的行
    if (pendingBlock && leadingSpaces > 0) {
      const blockText = line.trim();
      if (!/^>?\s*[A-Za-z0-9_.-]+:/.test(blockText)) {
        const existing = String(result[pendingBlock.key] ?? '');
        result[pendingBlock.key] = existing
          ? (pendingBlock.fold ? `${existing} ${blockText}` : `${existing}\n${blockText}`)
          : blockText;
        continue;
      }
    }

    // 检查是否是数组项 (以 - 开头)
    const arrayMatch = line.match(/^(\s*)-\s*(.*)$/);
    if (arrayMatch && currentArray !== null) {
      pendingBlock = null;
      const [, indent, value] = arrayMatch;
      const trimmedValue = value.trim();
      indentLevel = indent.length;
      
      if (inActions) {
        // 开始新的 action 对象
        if (trimmedValue.includes(':')) {
          // 格式: "- id: xxx"
          const actionKvMatch = trimmedValue.match(/^(\w+):\s*["']?(.+?)["']?$/);
          if (actionKvMatch) {
            currentAction = { [actionKvMatch[1]]: actionKvMatch[2] };
            currentArray.push(currentAction);
          }
        } else {
          // 格式: "- " 后面跟着新对象
          currentAction = {};
          currentArray.push(currentAction);
        }
      } else if (inDependencies) {
        // 依赖项是对象格式，如 "- python: >=3.10"
        const depMatch = trimmedValue.match(/^(\w+):\s*["']?(.+?)["']?$/);
        if (depMatch) {
          currentArray.push({ [depMatch[1]]: depMatch[2] });
        } else if (trimmedValue) {
          currentArray.push(trimmedValue);
        }
      } else {
        // 普通数组项
        currentArray.push(trimmedValue.replace(/^["']|["']$/g, ''));
      }
      continue;
    }

    // 处理 action 对象的属性（缩进的键值对）
    if (inActions && currentAction !== null && leadingSpaces > 0) {
      const nestedKvMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
      if (nestedKvMatch) {
        const [, key, value] = nestedKvMatch;
        let parsedValue: any = value.trim().replace(/^["']|["']$/g, '');
        
        // 处理布尔值
        if (parsedValue === 'true') parsedValue = true;
        else if (parsedValue === 'false') parsedValue = false;
        // 处理数字
        else if (/^\d+$/.test(parsedValue)) parsedValue = parseInt(parsedValue, 10);
        
        currentAction[key] = parsedValue;
      }
      continue;
    }

    // 处理普通缩进的键值对
    const nestedKvMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nestedKvMatch && currentKey && !inActions && !inDependencies) {
      pendingBlock = null;
      const [, key, value] = nestedKvMatch;
      const trimmedValue = value.trim().replace(/^["']|["']$/g, '');
      
      if (!currentObject) {
        currentObject = {};
        result[currentKey] = currentObject;
      }
      currentObject[key] = trimmedValue;
    }
  }

  // 解析 actions 为 SkillAction 类型
  const actions: SkillAction[] = [];
  if (Array.isArray(result.actions)) {
    for (const rawAction of result.actions) {
      const action = parseRawAction(rawAction);
      if (action) {
        actions.push(action);
      }
    }
  }

  // 构建 SkillFrontmatter
  const frontmatter: SkillFrontmatter = {
    name: result.name || 'Unknown Skill',
    description: result.description || '',
    version: result.version,
    author: result.author,
    dependencies: result.dependencies,
    tags: Array.isArray(result.tags) ? result.tags : undefined,
    category: result.category,
    // Hooks 配置
    hooks: result.hooks ? {
      pre_execute: result.hooks.pre_execute,
      post_execute: result.hooks.post_execute,
      on_error: result.hooks.on_error,
      verify: result.hooks.verify,
    } : undefined,
    // 触发关键词
    triggers: Array.isArray(result.triggers) ? result.triggers : undefined,
    // 触发方式的两个开关（键名与 SKILL.md 一致）。只认字面 true/false，
    // 其它写法等于没写：猜一个布尔比丢掉它更容易让人信错东西。
    'disable-model-invocation': parseFlag(result['disable-model-invocation']),
    'user-invocable': parseFlag(result['user-invocable']),
    // 作者建议的工具范围。Chatless 不从中授予权限，仅作为信息保留。
    'allowed-tools': parseToolList(result['allowed-tools']),
  };

  return { frontmatter, actions, warnings: collectInvocationWarnings(result) };
}

/**
 * 这三个键决定谁能启动一个 skill，所以下面两条静默失效贵到要喊一声：
 * 键名写错一个字母，与根本没写，在解析结果里一模一样。
 */
const INVOCATION_KEYS = ['disable-model-invocation', 'user-invocable', 'allowed-tools'];

/** 解析器真正读过的键（写错大小写也算没读，所以这里比对的是原样）。 */
const READ_KEYS = new Set([
  'name', 'description', 'version', 'author', 'dependencies', 'tags', 'category',
  'hooks', 'triggers', 'actions', ...INVOCATION_KEYS,
]);

function collectInvocationWarnings(result: Record<string, any>): string[] {
  const warnings: string[] = [];

  for (const key of Object.keys(result)) {
    if (READ_KEYS.has(key)) continue;
    const near = INVOCATION_KEYS
      .map((known) => ({ known, distance: editDistance(key.toLowerCase(), known) }))
      .sort((a, b) => a.distance - b.distance)[0];
    // 只对这一族报：别人的 frontmatter 里多几个键是常态，这不是 lint。
    if (near.distance > 2 && !/invoc|allowed[-_]?tool/i.test(key)) continue;
    warnings.push(
      `frontmatter key "${key}" is not read by Chatless; did you mean "${near.known}"? A key that is not read behaves as if it were absent.`,
    );
  }

  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (!(key in result)) continue;
    const value = result[key];
    if (value !== true && value !== false && value !== 'true' && value !== 'false') {
      warnings.push(
        `frontmatter key "${key}" must be true or false; ${JSON.stringify(value)} is read as absent, so the default applies.`,
      );
    }
  }

  if ('allowed-tools' in result && parseToolList(result['allowed-tools']) === undefined) {
    warnings.push(
      'frontmatter key "allowed-tools" is empty or unreadable; no tool scope was recorded.',
    );
  }

  return warnings;
}

/** 两字以内算“写错了”，再远就是另一个键了。 */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 只认字面量；未识别的写法返回 undefined，等于该键没写。 */
function parseFlag(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/** `allowed-tools` 在规范里是空格分隔的字符串；也接受 YAML 列表写法。 */
function parseToolList(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value.map((v) => String(v ?? '').trim())
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : [];
  const cleaned = items.filter((s) => s.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * 解析原始 action 对象为 SkillAction 类型
 */
function parseRawAction(raw: Record<string, any>): SkillAction | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const id = raw.id || `action-${Date.now()}`;
  const type = inferActionType(raw);
  
  if (!type) {
    return null;
  }

  // --------- 安全校验：禁止路径遍历/绝对路径（第三方 skills 需最小权限） ---------
  const isUnsafePath = (p: unknown): boolean => {
    if (typeof p !== 'string') return false;
    const s = p.trim();
    if (!s) return false;
    // 绝对路径（POSIX /..., Windows C:\..., UNC \\server\share）
    if (s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\')) return true;
    // 路径遍历
    if (/\.\.[\\/]/.test(s)) return true;
    return false;
  };

  if (isUnsafePath(raw.scriptPath || raw.script_path)) {
    return null;
  }
  const fo0 = raw.fileOperation || raw.file_operation;
  if (fo0 && typeof fo0 === 'object') {
    if (isUnsafePath((fo0 as any).path) || isUnsafePath((fo0 as any).destination)) {
      return null;
    }
  }

  const action: SkillAction = {
    id,
    type,
    name: raw.name || id,
    description: raw.description,
    
    // Shell/Script 通用字段
    command: raw.command,
    args: parseStringArray(raw.args),
    workingDir: raw.workingDir || raw.working_dir,
    env: raw.env,
    timeout: typeof raw.timeout === 'number' ? raw.timeout : undefined,
    
    // Script 类型专用字段
    runtime: parseRuntime(raw.runtime),
    scriptPath: raw.scriptPath || raw.script_path,
    scriptContent: raw.scriptContent || raw.script_content,
    
    // File 类型专用字段
    fileOperation: parseFileOperation(raw.fileOperation || raw.file_operation),
    
    // MCP 类型专用字段
    mcpServer: raw.mcpServer || raw.mcp_server,
    mcpTool: raw.mcpTool || raw.mcp_tool,
    mcpArgs: raw.mcpArgs || raw.mcp_args,
    
    // Instruction 类型专用字段
    instruction: raw.instruction,
    
    // 审批和安全配置
    requiresApproval: raw.requiresApproval ?? raw.requires_approval ?? true,
    riskLevel: parseRiskLevel(raw.riskLevel || raw.risk_level),
    skippable: raw.skippable ?? false,
    
    // 参数模板
    parameterTemplates: parseStringArray(raw.parameterTemplates || raw.parameter_templates),
    
    // 依赖关系
    dependsOn: parseStringArray(raw.dependsOn || raw.depends_on),
  };

  return action;
}

/**
 * 推断动作类型（优先尊重 raw.type；否则按字段推断）
 */
function inferActionType(raw: Record<string, any>): SkillActionType | null {
  const validTypes: SkillActionType[] = ['shell', 'script', 'file', 'mcp_tool', 'instruction', 'composite'];
  const explicit = raw.type ? String(raw.type).trim() : '';
  if (explicit) {
    if (validTypes.includes(explicit as SkillActionType)) {
      return explicit as SkillActionType;
    }
    // 明确指定但不合法，直接拒绝
    return null;
  }

  // 根据字段推断（缺省时避免误判为 shell）
  if (raw.mcpServer || raw.mcp_server || raw.mcpTool || raw.mcp_tool) return 'mcp_tool';
  if (raw.fileOperation || raw.file_operation) return 'file';
  if (raw.scriptPath || raw.script_path || raw.scriptContent || raw.script_content || raw.runtime) return 'script';
  if (raw.instruction) return 'instruction';
  if (raw.subActions || raw.sub_actions) return 'composite';
  if (raw.command || raw.args) return 'shell';
  return null;
}

/**
 * 解析运行时类型
 */
function parseRuntime(runtime: string | undefined): ScriptRuntime | undefined {
  const validRuntimes: ScriptRuntime[] = ['python', 'node', 'bash', 'powershell'];
  if (runtime && validRuntimes.includes(runtime as ScriptRuntime)) {
    return runtime as ScriptRuntime;
  }
  return undefined;
}

/**
 * 解析风险等级
 */
function parseRiskLevel(level: string | undefined): SkillRiskLevel {
  const validLevels: SkillRiskLevel[] = ['safe', 'low', 'medium', 'high', 'critical'];
  if (level && validLevels.includes(level as SkillRiskLevel)) {
    return level as SkillRiskLevel;
  }
  return 'medium'; // 默认中等风险
}

/**
 * 解析文件操作配置
 */
function parseFileOperation(raw: any): SkillFileOperation | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  
  return {
    type: raw.type || 'read',
    path: raw.path || '',
    content: raw.content,
    destination: raw.destination,
    encoding: raw.encoding,
  };
}

/**
 * 解析字符串数组
 */
function parseStringArray(value: any): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter(v => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  return undefined;
}

/**
 * 将 frontmatter 中的依赖项转换为标准格式
 * 
 * @param frontmatter 解析后的 frontmatter
 * @returns 标准化的依赖项列表
 */
export function extractDependencies(frontmatter: SkillFrontmatter | null): SkillDependency[] {
  if (!frontmatter?.dependencies) {
    return [];
  }

  const deps: SkillDependency[] = [];

  for (const dep of frontmatter.dependencies) {
    if (typeof dep === 'object') {
      for (const [type, version] of Object.entries(dep)) {
        if (isValidDependencyType(type)) {
          deps.push({
            type: type as DependencyType,
            name: type,
            version: typeof version === 'string' ? version : undefined,
            installed: false, // 需要后续检测
          });
        }
      }
    }
  }

  return deps;
}

/**
 * 检查是否是有效的依赖类型
 */
function isValidDependencyType(type: string): type is DependencyType {
  return ['python', 'node', 'binary', 'mcp_server'].includes(type);
}

/**
 * 从 SKILL.md 内容中提取第一个标题作为显示名称
 * 
 * @param content Markdown 内容
 * @returns 标题或 null
 */
export function extractTitleFromContent(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * 从 SKILL.md 内容中提取简短描述
 * 取第一个段落（非标题、非代码块的第一段文字）
 * 
 * @param content Markdown 内容
 * @param maxLength 最大长度
 * @returns 简短描述
 */
export function extractDescriptionFromContent(content: string, maxLength = 150): string {
  // 移除标题
  const withoutHeaders = content.replace(/^#+\s+.+$/gm, '');
  // 移除代码块
  const withoutCode = withoutHeaders.replace(/```[\s\S]*?```/g, '');
  // 获取第一个非空段落
  const paragraphs = withoutCode.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  
  if (paragraphs.length === 0) {
    return '';
  }

  const firstParagraph = paragraphs[0];
  if (firstParagraph.length <= maxLength) {
    return firstParagraph;
  }

  // 截断并添加省略号
  return firstParagraph.slice(0, maxLength - 3).trim() + '...';
}


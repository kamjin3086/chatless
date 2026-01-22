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
    const { frontmatter, actions } = parseYamlFrontmatter(yamlContent);
    return {
      success: true,
      frontmatter,
      content: markdownContent,
      rawContent,
      actions,
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    // 计算缩进级别
    const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
    
    // 检查是否是顶级键值对
    const topLevelKvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (topLevelKvMatch && leadingSpaces === 0) {
      const [, key, value] = topLevelKvMatch;
      const trimmedValue = value.trim();
      currentKey = key;
      
      if (trimmedValue === '' || trimmedValue === '|' || trimmedValue === '>') {
        // 多行值或数组/对象开始
        currentArray = [];
        result[key] = currentArray;
        inDependencies = key === 'dependencies';
        inActions = key === 'actions';
        currentAction = null;
      } else {
        // 单行值
        currentArray = null;
        currentObject = null;
        inDependencies = false;
        inActions = false;
        currentAction = null;
        // 移除引号
        result[key] = trimmedValue.replace(/^["']|["']$/g, '');
      }
      continue;
    }

    // 检查是否是数组项 (以 - 开头)
    const arrayMatch = line.match(/^(\s*)-\s*(.*)$/);
    if (arrayMatch && currentArray !== null) {
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
      const nestedKvMatch = line.match(/^\s+(\w+):\s*(.*)$/);
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
    const nestedKvMatch = line.match(/^\s+(\w+):\s*(.*)$/);
    if (nestedKvMatch && currentKey && !inActions && !inDependencies) {
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
  };

  return { frontmatter, actions };
}

/**
 * 解析原始 action 对象为 SkillAction 类型
 */
function parseRawAction(raw: Record<string, any>): SkillAction | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const id = raw.id || `action-${Date.now()}`;
  const type = parseActionType(raw.type);
  
  if (!type) {
    return null;
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
 * 解析动作类型
 */
function parseActionType(type: string | undefined): SkillActionType | null {
  const validTypes: SkillActionType[] = ['shell', 'script', 'file', 'mcp_tool', 'instruction', 'composite'];
  if (type && validTypes.includes(type as SkillActionType)) {
    return type as SkillActionType;
  }
  // 默认类型根据其他字段推断
  return 'shell';
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


import { getToolsCached } from './toolsCache';

// 生成更完整的提示：方法说明 + 全量参数清单 + 示例JSON + 必填项
export async function buildSchemaHint(server: string, tool: string): Promise<string> {
  try {
    const tools = await getToolsCached(server);
    const meta = Array.isArray(tools)
      ? tools.find((t: any) => String(t?.name || '').toLowerCase() === String(tool).toLowerCase())
      : null;

    const description = meta?.description ? String(meta.description) : '';
    const rawSchema = (meta?.inputSchema || meta?.input_schema) as any;
    const schema: any = rawSchema?.schema ? rawSchema.schema : rawSchema; // 兼容嵌套 .schema

    // 无 schema 的情况，尽量返回描述信息
    if (!schema || typeof schema !== 'object') {
      const descPart = description ? `Description: ${description}\n` : '';
      return `Arguments for "${server}.${tool}":\n${descPart}This tool does not publish a parameter schema. Pass arguments as a JSON object and pick the fields from the description.`;
    }

    const props: Record<string, any> = schema.properties || {};
    const requiredList: string[] = Array.isArray(schema.required) ? schema.required : [];

    // 构建参数明细文本
    const paramLines: string[] = [];
    const exampleObject: Record<string, any> = {};
    const propNames = Object.keys(props);
    for (const name of propNames) {
      const p = props[name] || {};
      const types = Array.isArray(p.type) ? p.type : (p.type ? [p.type] : []);
      const typeStr = types.length ? types.join('|') : (p.anyOf || p.oneOf ? 'anyOf/oneOf' : 'unknown');
      const isReq = requiredList.includes(name);
      const enumStr = Array.isArray(p.enum) ? ` enum: ${p.enum.slice(0, 20).join(', ')}` : '';
      const defStr = typeof p.default !== 'undefined' ? ` default: ${JSON.stringify(p.default)}` : '';
      const descStr = p.description ? ` - ${String(p.description)}` : '';
      paramLines.push(`- ${name} (${typeStr})${isReq ? ' [required]' : ''}${enumStr}${defStr}${descStr}`);

      // 生成示例值（尽量可被直接复制使用）
      const primaryType = types[0] || (p.anyOf?.[0]?.type) || (p.oneOf?.[0]?.type) || 'string';
      exampleObject[name] = buildExampleForType(primaryType, p);
    }

    const exampleJson = JSON.stringify(exampleObject, null, 2);
    const requiredStr = requiredList.length ? `Required parameters: ${requiredList.join(', ')}` : 'No explicitly required parameters';
    const header = `Arguments for "${server}.${tool}":`;
    const descPart = description ? `What it does: ${description}` : '';
    const paramsHeader = `Parameters (${propNames.length} in total):`;

    return [
      header,
      descPart,
      paramsHeader,
      paramLines.join('\n'),
      requiredStr,
      'Example arguments:',
      exampleJson,
      'Follow the parameter definitions and required fields exactly, and pass them as a JSON arguments field.'
    ].filter(Boolean).join('\n');
  } catch {
    // 忽略细节错误，返回简要提示
  }
  return '';
}

function buildExampleForType(primaryType: string, p: any): any {
  switch (primaryType) {
    case 'number':
    case 'integer':
      return typeof p.default !== 'undefined' ? p.default : 0;
    case 'boolean':
      return typeof p.default !== 'undefined' ? p.default : false;
    case 'array': {
      const itemType = p.items?.type || 'string';
      const sampleItem = buildExampleForType(itemType, p.items || {});
      return Array.isArray(p.default) ? p.default : [sampleItem];
    }
    case 'object':
      return typeof p.default === 'object' && p.default !== null ? p.default : {};
    case 'string':
    default:
      if (Array.isArray(p.enum) && p.enum.length > 0) return p.enum[0];
      return typeof p.default !== 'undefined' ? p.default : '';
  }
}

// 构建“详细工具引导与纠错建议”
// 返回文本与结构化spec，便于上层按需选择
export async function buildDetailedToolGuide(
  server: string,
  tool: string,
  providedArgs?: Record<string, any>
): Promise<{ text: string; spec: any }> {
  try {
    const tools = await getToolsCached(server);
    const meta = Array.isArray(tools)
      ? tools.find((t: any) => String(t?.name || '').toLowerCase() === String(tool).toLowerCase())
      : null;

    const description = meta?.description ? String(meta.description) : '';
    const rawSchema = (meta?.inputSchema || meta?.input_schema) as any;
    const schema: any = rawSchema?.schema ? rawSchema.schema : rawSchema;

    const spec: any = {
      server,
      tool,
      description,
      parameters: schema || null,
      issues: {
        missingRequired: [] as string[],
        unknownKeys: [] as string[],
        typeMismatches: [] as Array<{ key: string; expected: string; actual: string }>,
        enumViolations: [] as Array<{ key: string; expected: string[]; actual: any }>,
      },
      suggestedArguments: {} as Record<string, any>
    };

    // 无 schema 的场景：仅给出描述与提示
    if (!schema || typeof schema !== 'object') {
      const header = `Details for "${server}.${tool}":`;
      const descPart = description ? `What it does: ${description}` : '';
      const tips = 'This tool does not publish a parameter schema. Pass arguments as a JSON object and pick the fields from its description and the error message.';
      const text = [header, descPart, tips].filter(Boolean).join('\n');
      return { text, spec };
    }

    const props: Record<string, any> = schema.properties || {};
    const requiredList: string[] = Array.isArray(schema.required) ? schema.required : [];
    const keysProvided = providedArgs && typeof providedArgs === 'object' ? Object.keys(providedArgs) : [];

    // 缺失必填项
    const missingRequired = requiredList.filter((k) => !keysProvided.includes(k));
    spec.issues.missingRequired = missingRequired;

    // 未知参数
    const unknownKeys = keysProvided.filter((k) => !(k in props));
    spec.issues.unknownKeys = unknownKeys;

    // 类型与枚举检查
    const typeMismatches: Array<{ key: string; expected: string; actual: string }> = [];
    const enumViolations: Array<{ key: string; expected: string[]; actual: any }> = [];
    for (const k of keysProvided) {
      const p = props[k];
      if (!p) continue;
      const expectedTypes = Array.isArray(p.type) ? p.type : (p.type ? [p.type] : []);
      const val = (providedArgs as any)[k];
      const actualType = detectType(val);

      if (expectedTypes.length) {
        const ok = expectedTypes.some((t: string) => isTypeMatch(t, val));
        if (!ok) {
          typeMismatches.push({ key: k, expected: expectedTypes.join('|'), actual: actualType });
        }
      }

      if (Array.isArray(p.enum) && p.enum.length > 0) {
        if (!p.enum.includes(val)) {
          enumViolations.push({ key: k, expected: p.enum.slice(0, 50), actual: val });
        }
      }
    }
    spec.issues.typeMismatches = typeMismatches;
    spec.issues.enumViolations = enumViolations;

    // 生成建议参数模板：所有必填项 + 少量可选项的示例
    const example: Record<string, any> = {};
    for (const name of Object.keys(props)) {
      const p = props[name] || {};
      const types = Array.isArray(p.type) ? p.type : (p.type ? [p.type] : []);
      const primaryType = types[0] || (p.anyOf?.[0]?.type) || (p.oneOf?.[0]?.type) || 'string';
      if (requiredList.includes(name)) {
        example[name] = buildExampleForType(primaryType, p);
      }
    }
    // 额外添加最多3个可选项示例
    const optionalCandidates = Object.keys(props).filter((n) => !requiredList.includes(n)).slice(0, 3);
    for (const name of optionalCandidates) {
      const p = props[name] || {};
      const types = Array.isArray(p.type) ? p.type : (p.type ? [p.type] : []);
      const primaryType = types[0] || (p.anyOf?.[0]?.type) || (p.oneOf?.[0]?.type) || 'string';
      example[name] = buildExampleForType(primaryType, p);
    }
    spec.suggestedArguments = example;

    // 文本化输出（分页/截断基础处理）
    const header = `Details for "${server}.${tool}":`;
    const descPart = description ? `What it does: ${description}` : '';
    const requiredStr = requiredList.length ? `Required parameters: ${requiredList.join(', ')}` : 'No explicitly required parameters';

    const allParamLines: string[] = [];
    const propNames = Object.keys(props);
    for (const name of propNames) {
      const p = props[name] || {};
      const types = Array.isArray(p.type) ? p.type : (p.type ? [p.type] : []);
      const typeStr = types.length ? types.join('|') : (p.anyOf || p.oneOf ? 'anyOf/oneOf' : 'unknown');
      const isReq = requiredList.includes(name);
      const enumStr = Array.isArray(p.enum) ? ` enum: ${p.enum.slice(0, 20).join(', ')}` : '';
      const defStr = typeof p.default !== 'undefined' ? ` default: ${JSON.stringify(p.default)}` : '';
      const descStr = p.description ? ` - ${String(p.description)}` : '';
      allParamLines.push(`- ${name} (${typeStr})${isReq ? ' [required]' : ''}${enumStr}${defStr}${descStr}`);
    }
    // 最多展示前 80 行参数，避免过长
    const MAX_PARAM_LINES = 80;
    const shownParamLines = allParamLines.slice(0, MAX_PARAM_LINES);
    if (allParamLines.length > MAX_PARAM_LINES) {
      shownParamLines.push(`... ${allParamLines.length - MAX_PARAM_LINES} more parameters omitted`);
    }

    const issuesLines: string[] = [];
    if (missingRequired.length) issuesLines.push(`Missing required: ${missingRequired.join(', ')}`);
    if (unknownKeys.length) issuesLines.push(`Unknown parameters: ${unknownKeys.join(', ')}`);
    if (typeMismatches.length) issuesLines.push(`Type mismatches: ${typeMismatches.map(i=>`${i.key}(expected:${i.expected}, actual:${i.actual})`).join('; ')}`);
    if (enumViolations.length) issuesLines.push(`Enum mismatches: ${enumViolations.map(i=>`${i.key}(allowed:${i.expected.join('|')}, actual:${JSON.stringify(i.actual)})`).join('; ')}`);
    const issuesBlock = issuesLines.length ? issuesLines.join('\n') : 'No significant argument problems detected, or no arguments were provided.';

    const exampleJson = JSON.stringify(example, null, 2);
    const text = [
      header,
      descPart,
      'Parameter definitions:',
      shownParamLines.join('\n'),
      requiredStr,
      'Argument diagnostics:',
      issuesBlock,
      'Suggested minimal arguments:',
      exampleJson,
    ].filter(Boolean).join('\n');

    return { text, spec };
  } catch {
    // 忽略细节错误
  }
  return { text: '', spec: null };
}

function detectType(val: any): string {
  if (Array.isArray(val)) return 'array';
  if (val === null) return 'null';
  const t = typeof val;
  if (t === 'number') return Number.isInteger(val) ? 'integer' : 'number';
  if (t === 'object') return 'object';
  return t;
}

function isTypeMatch(expected: string, val: any): boolean {
  switch (expected) {
    case 'integer':
      return typeof val === 'number' && Number.isInteger(val);
    case 'number':
      return typeof val === 'number';
    case 'boolean':
      return typeof val === 'boolean';
    case 'string':
      return typeof val === 'string';
    case 'array':
      return Array.isArray(val);
    case 'object':
      return val !== null && !Array.isArray(val) && typeof val === 'object';
    default:
      return true; // 放宽匹配
  }
}

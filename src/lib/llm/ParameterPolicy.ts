/**
 * 参数策略引擎
 * - 通过 Provider 名称与模型 ID 的正则匹配，为请求选项注入/覆盖特定参数
 * - 便于预置厂商/模型的必要参数（如 Gemini 思考预算），并为后续用户自定义留出入口
 */

import {
  readWireField,
  thinkingWireFor,
  withWireField,
  type ThinkingLevel,
} from './thinkingLevels';

export type ParameterPatch = Record<string, any>;

/** What a rule is being applied to, so a rule can stay a table lookup instead of a guess. */
export interface ParameterRuleContext {
  providerName: string;
  modelId: string;
}

export interface ParameterRule {
  id: string;
  description?: string;
  priority?: number; // 数值越大优先级越高
  provider?: RegExp; // 可选：按 Provider 名称匹配（不区分大小写时请在外部构造带 i 标志的正则）
  /**
   * Provider 匹配模式：
   * - relaxed（默认）：忽略 provider 不匹配的情况，只要 model 匹配即应用规则
   * - strict：只有当 provider 正则匹配时才应用规则
   */
  providerMode?: 'strict' | 'relaxed';
  model?: RegExp; // 可选：按模型 ID 匹配
  apply: (
    base: ParameterPatch,
    context?: ParameterRuleContext,
  ) => ParameterPatch; // 返回新对象或在拷贝上修改
}

function mergeDeep<T extends object, U extends object>(
  target: T,
  source: U,
): T & U {
  const output: any = Array.isArray(target)
    ? [...(target as any)]
    : { ...(target as any) };
  if (typeof source !== 'object' || source === null) return output as T & U;
  for (const [key, value] of Object.entries(source as any)) {
    if (Array.isArray(value)) {
      output[key] = value.slice();
    } else if (value && typeof value === 'object') {
      output[key] = mergeDeep(output[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  }
  return output as T & U;
}

/** 预置规则集合（可按需扩展） */
const builtinRules: ParameterRule[] = [
  {
    id: 'thinking-level',
    priority: 40,
    description:
      '把通用的思考等级翻译成该 provider 的字段；auto 或未收录的模型一律不下发',
    apply: (base, context) => {
      const next: ParameterPatch = { ...base };
      const level = next.thinkingLevel as ThinkingLevel | undefined;
      // The generic names are never wire fields: leaving them behind would send
      // `thinkingLevel` to a server that has never heard of it.
      delete next.thinkingLevel;
      delete next.thinkingModelSuffixes;
      if (!level || level === 'auto' || !context) return next;
      const wire = thinkingWireFor(
        context.providerName,
        context.modelId,
        level,
      );
      // Unverified model, or a level that model does not advertise: send nothing
      // rather than reinterpret the choice as a nearby tier.
      if (!wire) return next;
      // An explicit provider-native value in the request (advanced JSON, a session
      // override) outranks a level, matching how the pre-existing rules behave - except
      // where the carrier writes the same option as the older boolean, where the level
      // is the more specific statement.
      if (readWireField(next, wire.field) !== undefined && !wire.overrides) {
        return next;
      }
      return withWireField(next, wire.field, wire.value);
    },
  },
  {
    id: 'google-gemini-thinking-required',
    priority: 100,
    description:
      '统一 Gemini 的 generationConfig 字段命名；思考预算不再由这里兜底，交给思考等级',
    provider: /^(google\s*ai)$/i,
    providerMode: 'relaxed',
    // 兼容常见形态：gemini-2.5-pro、gemini-2.5-pro-latest、gemini-2.5-flash-thinking、gemini-1.5-pro-thinking 等
    model:
      /^(gemini-2\.5-(pro|flash-thinking)(?:-[a-z]+)?|gemini-1\.5-.*-thinking|gemini-2\.0-.*-thinking|.*-thinking)$/i,
    apply: (base) => {
      // Only field naming happens here. This rule used to pin thinkingBudget to 1024,
      // which both competed with a level the user had chosen and was a number nobody had
      // picked; sending nothing at all is the documented way to get dynamic thinking.
      const patch: ParameterPatch = {
        generationConfig: {
          // 统一映射 maxTokens → maxOutputTokens（若用户显式设置才透传）
          ...(base?.maxOutputTokens ||
          base?.maxTokens ||
          base?.generationConfig?.maxOutputTokens
            ? {
                maxOutputTokens:
                  base?.maxOutputTokens ??
                  base?.maxTokens ??
                  base?.generationConfig?.maxOutputTokens,
              }
            : {}),
          ...(base?.stop || base?.generationConfig?.stopSequences
            ? {
                stopSequences:
                  base?.stop ?? base?.generationConfig?.stopSequences,
              }
            : {}),
        },
      };
      return mergeDeep(base, patch);
    },
  },
  {
    id: 'google-gemini-image-generation-modalities',
    priority: 90,
    description:
      '为 Gemini 图像生成模型设置默认响应模态为 [IMAGE, TEXT]，避免仅 TEXT 模式导致的 400 错误',
    provider: /^(google\s*ai)$/i,
    providerMode: 'relaxed',
    // 典型：gemini-2.0-*-image-generation（含 preview/flash 变体等）
    model: /gemini-[\d.]+-[\w-]*image-generation/i,
    apply: (base) => {
      const patch: ParameterPatch = {
        generationConfig: {
          responseModalities:
            Array.isArray(
              (base as any)?.generationConfig?.responseModalities,
            ) && (base as any).generationConfig.responseModalities.length > 0
              ? (base as any).generationConfig.responseModalities
              : ['IMAGE', 'TEXT'],
        },
      };
      return mergeDeep(base, patch);
    },
  },
];

export class ParameterPolicyEngine {
  private static _builtin: ParameterRule[] = builtinRules
    .slice()
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));
  // 预留用户自定义规则通道（后续可从存储加载）
  private static _userRules: ParameterRule[] = [];

  /** 注册/替换用户规则集合（可用于未来的设置界面） */
  static setUserRules(rules: ParameterRule[]): void {
    ParameterPolicyEngine._userRules = (rules || [])
      .slice()
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));
  }

  /** 按 provider/model 依次应用匹配的规则，后匹配可覆盖先前注入项（通过优先级调控顺序） */
  static apply(
    providerName: string,
    modelId: string,
    baseOptions: ParameterPatch = {},
  ): ParameterPatch {
    const allRules = [
      ...ParameterPolicyEngine._builtin,
      ...ParameterPolicyEngine._userRules,
    ];
    let merged: ParameterPatch = { ...(baseOptions || {}) };
    for (const rule of allRules) {
      const providerMode = rule.providerMode ?? 'relaxed';
      const matchProvider = rule.provider
        ? providerMode === 'strict'
          ? rule.provider.test(providerName)
          : true // relaxed：放宽到所有提供商
        : true;
      const matchModel = rule.model ? rule.model.test(modelId) : true;
      if (matchProvider && matchModel) {
        merged = rule.apply(merged, { providerName, modelId }) || merged;
      }
    }
    return merged;
  }
}

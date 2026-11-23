'use client';

import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { X, Plus, RotateCcw, Settings, Check, HelpCircle } from 'lucide-react';
import { specializedStorage } from '@/lib/storage';
import { ModelParametersService } from '@/lib/model-parameters';
import type { ModelParameters } from '@/types/model-params';
import {
  DEFAULT_MODEL_PARAMETERS,
  MODEL_PARAMETER_LIMITS,
} from '@/types/model-params';
import {
  resolveProviderConfig,
  type ProviderFieldSupport,
} from '@/lib/llm/provider-field-support';
import {
  supportedThinkingLevels,
  type ThinkingLevel,
} from '@/lib/llm/thinkingLevels';
import {
  thinkingCacheNotice,
  validateThinkingRequest,
} from '@/lib/chat/thinkingRequestValidation';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n/types';

// 自定义参数接口
interface CustomParameter {
  key: string;
  value: string;
  asString: boolean; // 是否强制作为字符串处理
}

function calcPercent(value: number, min: number, max: number) {
  if (max === min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function ParamHelp({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function sliderTrackStyle(
  enabled: boolean,
  value: number,
  min: number,
  max: number,
): CSSProperties {
  const pct = calcPercent(value, min, max);
  if (!enabled) return { background: 'rgba(148, 163, 184, 0.22)' };
  return {
    background: `linear-gradient(to right, var(--glass-accent) 0%, var(--glass-accent) ${pct}%, rgba(148, 163, 184, 0.22) ${pct}%, rgba(148, 163, 184, 0.22) 100%)`,
  };
}

function ParamSliderRow({
  enabled,
  onEnabledChange,
  label,
  help,
  min,
  max,
  step,
  value,
  onChange,
  inputMin,
  inputMax,
}: {
  /** Omit `onEnabledChange` for a parameter that has no on/off state. */
  enabled?: boolean;
  onEnabledChange?: (v: boolean) => void;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  inputMin: number;
  inputMax: number;
}) {
  // Only an explicit switch is on. A stored bag with no switch is "not chosen", and
  // showing it as on made the dialog look like it would send a default it would not.
  const on = onEnabledChange ? enabled === true : true;
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {onEnabledChange ? (
        <Checkbox
          checked={on}
          onCheckedChange={(checked) => onEnabledChange(Boolean(checked))}
        />
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <div className="flex items-center gap-1.5 w-44 shrink-0 min-w-0">
        <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
          {label}
        </Label>
        <ParamHelp text={help} />
      </div>
      <input
        type="range"
        className="param-slider flex-1 min-w-0 h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!on}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={sliderTrackStyle(on, value, min, max)}
      />
      <Input
        type="number"
        className="w-[4.75rem] h-7 shrink-0 px-2 text-xs tabular-nums"
        min={inputMin}
        max={inputMax}
        step={step}
        value={value}
        disabled={!on}
        onChange={(e) => onChange(parseFloat(e.target.value || '0'))}
      />
    </div>
  );
}

function ParamToggleRow({
  enabled,
  onEnabledChange,
  label,
  help,
  value,
  onValueChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  label: string;
  help: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Checkbox
        checked={enabled}
        onCheckedChange={(checked) => onEnabledChange(Boolean(checked))}
      />
      <div className="flex items-center gap-1.5 w-44 shrink-0 min-w-0">
        <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
          {label}
        </Label>
        <ParamHelp text={help} />
      </div>
      <div className="flex-1" />
      <Switch
        size="sm"
        checked={value}
        onCheckedChange={onValueChange}
        disabled={!enabled}
      />
    </div>
  );
}

/**
 * Same row shape as the toggles and sliders, with a dropdown instead of a switch. Used
 * by the thinking level, whose choices come from the mapping table rather than a slider
 * range; `unavailableHint` replaces the control when nothing has been verified for this
 * provider and model.
 */
function ParamSelectRow({
  enabled,
  onEnabledChange,
  label,
  help,
  value,
  options,
  onValueChange,
  unavailableHint,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  label: string;
  help: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (v: string) => void;
  unavailableHint?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Checkbox
        checked={enabled}
        onCheckedChange={(checked) => onEnabledChange(Boolean(checked))}
      />
      <div className="flex items-center gap-1.5 w-44 shrink-0 min-w-0">
        <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
          {label}
        </Label>
        <ParamHelp text={help} />
      </div>
      <div className="flex-1" />
      {unavailableHint ? (
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {unavailableHint}
        </span>
      ) : (
        <select
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          disabled={!enabled}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// 自定义参数相关函数
// Module scope, not a component closure: the thinking advisory below depends on the
// parsed custom rows, and a function recreated on every render would make that memo
// recompute constantly for no reason.
function convertValue(value: string, asString = false): any {
  if (asString) return value;

  // 尝试转换为数字
  const numValue = parseFloat(value);
  if (!isNaN(numValue) && isFinite(numValue) && value.trim() !== '') {
    return numValue;
  }

  // 尝试转换为布尔值
  const lowerValue = value.toLowerCase().trim();
  if (lowerValue === 'true') return true;
  if (lowerValue === 'false') return false;

  // 默认返回字符串
  return value;
}

interface ModelParametersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  modelId: string;
  modelLabel?: string;
}

export function ModelParametersDialog({
  open,
  onOpenChange,
  providerName,
  modelId,
  modelLabel,
}: ModelParametersDialogProps) {
  const t = useTranslation();
  // Empty means the table has never seen this provider/model: the control says so
  // instead of offering tiers nobody verified.
  const thinkingTiers = supportedThinkingLevels(providerName, modelId);
  const levelLabel = (level: ThinkingLevel) =>
    level === 'auto'
      ? t('modelParams.thinkingLevel.auto')
      : t(`thinkingLevel.${level}` as TranslationKey);
  const [parameters, setParameters] = useState<ModelParameters>(
    DEFAULT_MODEL_PARAMETERS,
  );
  const [stopSequences, setStopSequences] = useState<string[]>([]);
  const [newStopSequence, setNewStopSequence] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>(
    [],
  );
  const [savedParameters, setSavedParameters] =
    useState<ModelParameters | null>(null);
  const [advancedEditorOpen, setAdvancedEditorOpen] = useState(false);
  const [advancedJsonText, setAdvancedJsonText] = useState<string>('{}');
  const [advancedJsonError, setAdvancedJsonError] = useState<string>('');

  // Provider字段支持信息
  const [providerSupport, setProviderSupport] = useState<ProviderFieldSupport>(
    () => resolveProviderConfig(providerName).config.support,
  );

  // 更新Provider字段支持信息
  useEffect(() => {
    if (providerName) {
      setProviderSupport(resolveProviderConfig(providerName).config.support);
    }
  }, [providerName]);

  // 加载保存的参数
  useEffect(() => {
    if (open && providerName && modelId) {
      loadModelParameters();
    }
  }, [open, providerName, modelId]);

  // 检测参数变化
  useEffect(() => {
    if (savedParameters) {
      const hasParameterChanges =
        parameters.temperature !== savedParameters.temperature ||
        parameters.maxTokens !== savedParameters.maxTokens ||
        parameters.topP !== savedParameters.topP ||
        (parameters as any).topK !== (savedParameters as any).topK ||
        (parameters as any).minP !== (savedParameters as any).minP ||
        parameters.frequencyPenalty !== savedParameters.frequencyPenalty ||
        parameters.presencePenalty !== savedParameters.presencePenalty ||
        (parameters as any).thinking !== (savedParameters as any).thinking ||
        parameters.thinkingLevel !== savedParameters.thinkingLevel ||
        parameters.enableThinkingLevel !==
          savedParameters.enableThinkingLevel ||
        (parameters as any).streaming !== (savedParameters as any).streaming ||
        JSON.stringify(stopSequences) !==
          JSON.stringify(savedParameters.stopSequences || []) ||
        customParameters.length > 0; // 如果有自定义参数就视为有变更
      setHasChanges(hasParameterChanges);
    } else {
      // 如果没有保存的参数，与系统默认参数比较
      const hasParameterChanges =
        parameters.temperature !== DEFAULT_MODEL_PARAMETERS.temperature ||
        parameters.maxTokens !== DEFAULT_MODEL_PARAMETERS.maxTokens ||
        parameters.topP !== DEFAULT_MODEL_PARAMETERS.topP ||
        (parameters as any).topK !== (DEFAULT_MODEL_PARAMETERS as any).topK ||
        (parameters as any).minP !== (DEFAULT_MODEL_PARAMETERS as any).minP ||
        parameters.frequencyPenalty !==
          DEFAULT_MODEL_PARAMETERS.frequencyPenalty ||
        parameters.presencePenalty !==
          DEFAULT_MODEL_PARAMETERS.presencePenalty ||
        (parameters as any).thinking !==
          (DEFAULT_MODEL_PARAMETERS as any).thinking ||
        (parameters as any).streaming !==
          (DEFAULT_MODEL_PARAMETERS as any).streaming ||
        stopSequences.length > 0 ||
        customParameters.length > 0; // 如果有自定义参数就视为有变更
      setHasChanges(hasParameterChanges);
    }
  }, [parameters, stopSequences, savedParameters, customParameters]);

  const loadModelParameters = async () => {
    if (!providerName || !modelId) {
      return;
    }

    try {
      // The same bag a send reads: cleaned at the storage boundary, migrated once, and null
      // when nothing is stored, so a hand-edited value the wire drops is no longer shown as a
      // choice (#144). A value that cleaned to nothing still sits next to an enabled switch -
      // that paired representation is #140, not this read.
      const savedParams = await ModelParametersService.getModelParametersOrNull(
        providerName,
        modelId,
      );
      if (savedParams) {
        setParameters(savedParams);
        setStopSequences(savedParams.stopSequences || []);
        setSavedParameters(savedParams);
        const adv = savedParams.advancedOptions || {};
        setAdvancedJsonText(JSON.stringify(adv, null, 2));

        // 加载自定义参数
        const customParams: CustomParameter[] = [];
        Object.entries(adv).forEach(([key, value]) => {
          // 排除标准参数
          if (
            ![
              'temperature',
              'maxTokens',
              'topP',
              'topK',
              'minP',
              'frequencyPenalty',
              'presencePenalty',
              'stopSequences',
            ].includes(key)
          ) {
            const asString =
              typeof value === 'string' &&
              !['true', 'false'].includes(value.toLowerCase()) &&
              isNaN(Number(value));
            customParams.push({
              key,
              value: String(value),
              asString,
            });
          }
        });
        setCustomParameters(customParams);
      } else {
        setParameters(DEFAULT_MODEL_PARAMETERS);
        setStopSequences([]);
        setSavedParameters(null);
        setAdvancedJsonText('{}');
        setCustomParameters([]);
      }
    } catch (error) {
      console.error('加载模型参数失败:', error);
      setParameters(DEFAULT_MODEL_PARAMETERS);
      setStopSequences([]);
      setSavedParameters(null);
      setCustomParameters([]);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // 解析高级参数 JSON（严格校验）
      let advanced: Record<string, any> | undefined = undefined;
      try {
        const trimmed = advancedJsonText?.trim();
        const parsed = trimmed ? JSON.parse(trimmed) : {};
        if (parsed && typeof parsed === 'object') {
          advanced = parsed;
          setAdvancedJsonError('');
        }
      } catch (e: any) {
        setAdvancedJsonError(e?.message || t('modelParams.invalidJson'));
        setIsLoading(false);
        return;
      }

      // 合并自定义参数到 advancedOptions
      const customParamsObj: Record<string, any> = {};
      customParameters.forEach((param) => {
        if (param.key.trim()) {
          customParamsObj[param.key] = convertValue(
            param.value,
            param.asString,
          );
        }
      });

      const configToSave = {
        ...parameters,
        stopSequences,
        advancedOptions: { ...advanced, ...customParamsObj },
      };
      // A combination this API refuses is refused here, with the reason already on screen
      // next to the control. Nothing is clamped, lowered or dropped on the way in: the
      // user changes one of the two values, or accepts the consequence.
      const blocking = validateThinkingRequest({
        providerName,
        modelId,
        level: effectiveThinkingLevel,
        maxOutputTokens: parameters.maxTokens,
        advanced: configToSave.advancedOptions,
      });
      if (blocking?.kind === 'blocked') {
        setIsLoading(false);
        return;
      }
      // What is written is what this dialog read (cleaned) plus what the user changed here: a
      // hand-edited value the boundary rejected is not written back. Round-tripping it would
      // restore the split #144 removed.
      await specializedStorage.models.setModelParameters(
        providerName,
        modelId,
        configToSave,
      );
      onOpenChange(false);
    } catch (error) {
      console.error('保存模型参数失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setParameters(DEFAULT_MODEL_PARAMETERS);
    setStopSequences([]);
    setSavedParameters(null);
    setAdvancedJsonText('{}');
    setCustomParameters([]);
  };

  const handleClearSession = () => {
    setParameters(DEFAULT_MODEL_PARAMETERS);
    setStopSequences([]);
    setSavedParameters(null);
    setHasChanges(false);
    setCustomParameters([]);
  };

  const addStopSequence = () => {
    if (
      newStopSequence.trim() &&
      !stopSequences.includes(newStopSequence.trim())
    ) {
      setStopSequences([...stopSequences, newStopSequence.trim()]);
      setParameters((prev) => ({ ...prev, enableStopSequences: true }));
      setNewStopSequence('');
    }
  };

  const removeStopSequence = (index: number) => {
    setStopSequences(stopSequences.filter((_, i) => i !== index));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addStopSequence();
    }
  };

  // The request as it would go out: a level here plus whatever the raw JSON and the
  // custom rows add. The advisory below reads this, and saving refuses the same thing the
  // screen says, so the two can never disagree.
  const effectiveThinkingLevel: ThinkingLevel =
    parameters.enableThinkingLevel === true
      ? (parameters.thinkingLevel ?? 'auto')
      : 'auto';
  const pendingAdvanced = useMemo(() => {
    const merged: Record<string, any> = {};
    try {
      const trimmed = advancedJsonText?.trim();
      const parsed = trimmed ? JSON.parse(trimmed) : {};
      if (parsed && typeof parsed === 'object') Object.assign(merged, parsed);
    } catch {
      // Malformed JSON has its own message right under the editor; the advisory simply
      // has no advanced part to reason about until it parses again.
    }
    for (const param of customParameters) {
      if (param.key.trim()) {
        merged[param.key] = convertValue(param.value, param.asString);
      }
    }
    return merged;
  }, [advancedJsonText, customParameters]);
  const thinkingIssue = useMemo(
    () =>
      validateThinkingRequest({
        providerName,
        modelId,
        level: effectiveThinkingLevel,
        maxOutputTokens: parameters.maxTokens,
        advanced: pendingAdvanced,
      }),
    [
      providerName,
      modelId,
      effectiveThinkingLevel,
      parameters.maxTokens,
      pendingAdvanced,
    ],
  );
  const thinkingCacheHint = useMemo(
    () =>
      thinkingCacheNotice({
        providerName,
        modelId,
        level: effectiveThinkingLevel,
      }),
    [providerName, modelId, effectiveThinkingLevel],
  );

  const addCustomParameter = () => {
    setCustomParameters((prev) => [
      ...prev,
      { key: '', value: '', asString: false },
    ]);
  };

  const updateCustomParameter = (
    index: number,
    field: keyof CustomParameter,
    value: any,
  ) => {
    setCustomParameters((prev) =>
      prev.map((param, i) =>
        i === index ? { ...param, [field]: value } : param,
      ),
    );
  };

  const removeCustomParameter = (index: number) => {
    setCustomParameters((prev) => prev.filter((_, i) => i !== index));
  };

  // 生成预览JSON。Use the same assembly the send path uses, so an unset switch cannot
  // look enabled here, and a field cannot be previewed but never sent.
  const generatePreviewJson = () => {
    const custom: Record<string, any> = {};
    customParameters.forEach((param) => {
      if (param.key.trim()) {
        custom[param.key] = convertValue(param.value, param.asString);
      }
    });
    return ModelParametersService.convertToChatOptions({
      ...parameters,
      stopSequences,
      advancedOptions: {
        ...((parameters as any).advancedOptions || {}),
        ...custom,
      },
    });
  };

  const previewJson = generatePreviewJson();

  // 监听参数变化，验证高级JSON格式
  useEffect(() => {
    try {
      if (advancedJsonText.trim() && advancedJsonText !== '{}') {
        JSON.parse(advancedJsonText);
        setAdvancedJsonError('');
      } else {
        setAdvancedJsonError('');
      }
    } catch (e: any) {
      setAdvancedJsonError(e?.message || t('modelParams.invalidJson'));
    }
  }, [advancedJsonText, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 max-h-[85vh] overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-5 py-3.5 border-b border-slate-200/40 dark:border-slate-700/40">
          <div className="flex items-start gap-2.5 min-w-0">
            <Settings className="w-4 h-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">
                {t('modelParams.title')}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t('modelParams.description')}
              </DialogDescription>
              <p
                className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate"
                title={modelLabel || modelId}
              >
                {modelLabel || modelId}
                {hasChanges ? ` · ${t('modelParams.modified')}` : ''}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {t('modelParams.defaultsHelp')}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <TooltipProvider delayDuration={200}>
          <div className="px-5 py-3 space-y-2.5 max-h-[60vh] overflow-y-auto">
            <ParamSliderRow
              enabled={parameters.enableTemperature === true}
              onEnabledChange={(v) =>
                setParameters((prev) => ({ ...prev, enableTemperature: v }))
              }
              label="Temperature"
              help={t('modelParams.temperatureHelp')}
              min={MODEL_PARAMETER_LIMITS.temperature.min}
              max={MODEL_PARAMETER_LIMITS.temperature.max}
              step={MODEL_PARAMETER_LIMITS.temperature.step}
              value={parameters.temperature || 0}
              onChange={(v) =>
                setParameters((prev) => ({ ...prev, temperature: v }))
              }
              inputMin={MODEL_PARAMETER_LIMITS.temperature.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.temperature.inputMax}
            />
            <ParamSliderRow
              enabled={parameters.enableMaxTokens === true}
              onEnabledChange={(v) =>
                setParameters((prev) => ({ ...prev, enableMaxTokens: v }))
              }
              label="Max Tokens"
              help={t('modelParams.maxTokensHelp')}
              min={MODEL_PARAMETER_LIMITS.maxTokens.min}
              max={MODEL_PARAMETER_LIMITS.maxTokens.max}
              step={MODEL_PARAMETER_LIMITS.maxTokens.step}
              value={parameters.maxTokens || 0}
              onChange={(v) =>
                setParameters((prev) => ({ ...prev, maxTokens: Math.round(v) }))
              }
              inputMin={MODEL_PARAMETER_LIMITS.maxTokens.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.maxTokens.inputMax}
            />
            <ParamSliderRow
              label="Context Window"
              help={t('modelParams.contextWindowHelp')}
              min={MODEL_PARAMETER_LIMITS.contextWindow.min}
              max={MODEL_PARAMETER_LIMITS.contextWindow.max}
              step={MODEL_PARAMETER_LIMITS.contextWindow.step}
              value={parameters.contextWindow || 0}
              onChange={(v) =>
                setParameters((prev) => ({
                  ...prev,
                  contextWindow: Math.round(v) || undefined,
                }))
              }
              inputMin={MODEL_PARAMETER_LIMITS.contextWindow.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.contextWindow.inputMax}
            />
            {typeof parameters.observedContextWindow === 'number' &&
              parameters.observedContextWindow > 0 && (
                <div className="px-3 pb-2 text-[10px] text-slate-400 dark:text-slate-500">
                  {t('modelParams.observedContextWindow').replace(
                    '{0}',
                    parameters.observedContextWindow.toLocaleString(),
                  )}
                  {parameters.contextWindow &&
                  parameters.contextWindow !== parameters.observedContextWindow
                    ? ` · ${t('modelParams.effectiveContextWindow').replace('{0}', Math.min(parameters.contextWindow, parameters.observedContextWindow).toLocaleString())}`
                    : ''}
                </div>
              )}
            <ParamSliderRow
              enabled={parameters.enableTopP === true}
              onEnabledChange={(v) =>
                setParameters((prev) => ({ ...prev, enableTopP: v }))
              }
              label="Top P"
              help={t('modelParams.topPHelp')}
              min={MODEL_PARAMETER_LIMITS.topP.min}
              max={MODEL_PARAMETER_LIMITS.topP.max}
              step={MODEL_PARAMETER_LIMITS.topP.step}
              value={parameters.topP || 0}
              onChange={(v) => setParameters((prev) => ({ ...prev, topP: v }))}
              inputMin={MODEL_PARAMETER_LIMITS.topP.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.topP.inputMax}
            />
            {providerSupport.topK && (
              <ParamSliderRow
                enabled={(parameters as any).enableTopK === true}
                onEnabledChange={(v) =>
                  setParameters((prev) => ({ ...prev, enableTopK: v }) as any)
                }
                label="Top K"
                help={t('modelParams.topKHelp')}
                min={MODEL_PARAMETER_LIMITS.topK.min}
                max={MODEL_PARAMETER_LIMITS.topK.max}
                step={MODEL_PARAMETER_LIMITS.topK.step}
                value={(parameters as any).topK || 0}
                onChange={(v) =>
                  setParameters(
                    (prev) => ({ ...prev, topK: Math.round(v) }) as any,
                  )
                }
                inputMin={MODEL_PARAMETER_LIMITS.topK.inputMin}
                inputMax={MODEL_PARAMETER_LIMITS.topK.inputMax}
              />
            )}
            {providerSupport.minP && (
              <ParamSliderRow
                enabled={(parameters as any).enableMinP === true}
                onEnabledChange={(v) =>
                  setParameters((prev) => ({ ...prev, enableMinP: v }) as any)
                }
                label="Min P"
                help={t('modelParams.minPHelp')}
                min={MODEL_PARAMETER_LIMITS.minP.min}
                max={MODEL_PARAMETER_LIMITS.minP.max}
                step={MODEL_PARAMETER_LIMITS.minP.step}
                value={(parameters as any).minP || 0}
                onChange={(v) =>
                  setParameters((prev) => ({ ...prev, minP: v }) as any)
                }
                inputMin={MODEL_PARAMETER_LIMITS.minP.inputMin}
                inputMax={MODEL_PARAMETER_LIMITS.minP.inputMax}
              />
            )}
            <ParamSliderRow
              enabled={parameters.enableFrequencyPenalty === true}
              onEnabledChange={(v) =>
                setParameters((prev) => ({
                  ...prev,
                  enableFrequencyPenalty: v,
                }))
              }
              label="Frequency Penalty"
              help={t('modelParams.frequencyPenaltyHelp')}
              min={MODEL_PARAMETER_LIMITS.frequencyPenalty.min}
              max={MODEL_PARAMETER_LIMITS.frequencyPenalty.max}
              step={MODEL_PARAMETER_LIMITS.frequencyPenalty.step}
              value={parameters.frequencyPenalty || 0}
              onChange={(v) =>
                setParameters((prev) => ({ ...prev, frequencyPenalty: v }))
              }
              inputMin={MODEL_PARAMETER_LIMITS.frequencyPenalty.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.frequencyPenalty.inputMax}
            />
            <ParamSliderRow
              enabled={parameters.enablePresencePenalty === true}
              onEnabledChange={(v) =>
                setParameters((prev) => ({ ...prev, enablePresencePenalty: v }))
              }
              label="Presence Penalty"
              help={t('modelParams.presencePenaltyHelp')}
              min={MODEL_PARAMETER_LIMITS.presencePenalty.min}
              max={MODEL_PARAMETER_LIMITS.presencePenalty.max}
              step={MODEL_PARAMETER_LIMITS.presencePenalty.step}
              value={parameters.presencePenalty || 0}
              onChange={(v) =>
                setParameters((prev) => ({ ...prev, presencePenalty: v }))
              }
              inputMin={MODEL_PARAMETER_LIMITS.presencePenalty.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.presencePenalty.inputMax}
            />

            {/* No thinking-boolean row: #100 retired its entry point, and a value left
                over from before is translated on read (src/lib/chat/thinkingScope). */}

            {/* Thinking level: nothing sent = the model decides; an unverified model is
                told so rather than offered tiers */}
            <ParamSelectRow
              enabled={parameters.enableThinkingLevel === true}
              onEnabledChange={(v) =>
                setParameters((prev) => ({
                  ...prev,
                  enableThinkingLevel: v,
                }))
              }
              label={t('modelParams.thinkingLevel')}
              help={t('modelParams.thinkingLevel.help')}
              value={parameters.thinkingLevel ?? 'auto'}
              options={[
                { value: 'auto', label: levelLabel('auto') },
                ...thinkingTiers.map((level) => ({
                  value: level,
                  label: levelLabel(level),
                })),
              ]}
              onValueChange={(v) =>
                setParameters((prev) => ({
                  ...prev,
                  thinkingLevel: v as ThinkingLevel,
                }))
              }
              unavailableHint={
                thinkingTiers.length === 0
                  ? t('modelParams.thinkingLevel.unverified')
                  : undefined
              }
            />
            {thinkingIssue?.kind === 'blocked' && (
              <p className="text-xs text-rose-500">
                {t(thinkingIssue.key as TranslationKey)}
              </p>
            )}
            {thinkingIssue?.kind === 'warn' && (
              <p className="text-xs text-amber-500">
                {t(thinkingIssue.key as TranslationKey)}
              </p>
            )}
            {thinkingCacheHint && (
              <p className="text-xs text-slate-400">
                {t(thinkingCacheHint as TranslationKey)}
              </p>
            )}
            <ParamToggleRow
              enabled={(parameters as any).enableStreaming !== false}
              onEnabledChange={(v) =>
                setParameters(
                  (prev) => ({ ...prev, enableStreaming: v }) as any,
                )
              }
              label={t('modelParams.stream')}
              help={t('modelParams.streamHelp')}
              value={(parameters as any).streaming !== false}
              onValueChange={(v) =>
                setParameters((prev) => ({ ...prev, streaming: v }) as any)
              }
            />

            {/* Format - 仅在Provider支持时显示 */}
            {providerSupport.format && (
              <div className="flex items-center gap-2.5 min-w-0">
                <Checkbox
                  checked={(parameters as any).enableFormat === true}
                  onCheckedChange={(checked) =>
                    setParameters(
                      (prev) =>
                        ({ ...prev, enableFormat: Boolean(checked) }) as any,
                    )
                  }
                />
                <div className="flex items-center gap-1.5 w-44 shrink-0">
                  <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    {t('modelParams.format')}
                  </Label>
                  <ParamHelp text={t('modelParams.formatHelp')} />
                </div>
                <div className="flex-1" />
                <select
                  value={(parameters as any).format || 'none'}
                  onChange={(e) =>
                    setParameters(
                      (prev) =>
                        ({
                          ...prev,
                          format:
                            e.target.value === 'none'
                              ? undefined
                              : e.target.value,
                        }) as any,
                    )
                  }
                  disabled={(parameters as any).enableFormat !== true}
                  className="h-7 px-2 text-xs rounded-md border border-slate-200/70 dark:border-slate-600/50 bg-transparent text-slate-700 dark:text-slate-200 disabled:opacity-40"
                >
                  <option value="none">{t('modelParams.formatAny')}</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-2.5 min-w-0">
              <Checkbox
                checked={parameters.enableStopSequences === true}
                onCheckedChange={(checked) =>
                  setParameters((prev) => ({
                    ...prev,
                    enableStopSequences: Boolean(checked),
                  }))
                }
              />
              <div className="flex items-center gap-1.5 w-44 shrink-0">
                <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                  Stop Sequences
                </Label>
                <ParamHelp text={t('modelParams.stopSequencesHelp')} />
              </div>
              <Input
                value={newStopSequence}
                onChange={(e) => setNewStopSequence(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={t('modelParams.stopSequencePlaceholder')}
                className="flex-1 h-7 min-w-0 text-xs"
                disabled={parameters.enableStopSequences !== true}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addStopSequence}
                disabled={
                  parameters.enableStopSequences !== true ||
                  !newStopSequence.trim()
                }
                className="h-7 w-7 p-0 shrink-0"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {stopSequences.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-[calc(1rem+0.625rem+11rem)]">
                {stopSequences.map((sequence, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="flex items-center gap-1 bg-slate-100/80 text-slate-600 dark:bg-white/10 dark:text-slate-300"
                  >
                    <span className="text-xs">{sequence}</span>
                    <button
                      onClick={() => removeStopSequence(index)}
                      className="ml-0.5 text-slate-400 hover:text-rose-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('modelParams.customParameters')}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={addCustomParameter}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {t('provider.models.add')}
                </Button>
              </div>
              {customParameters.map((param, index) => (
                <div key={index} className="flex items-center gap-2 min-w-0">
                  <Input
                    placeholder={t('modelParams.customParameterName')}
                    value={param.key}
                    onChange={(e) =>
                      updateCustomParameter(index, 'key', e.target.value)
                    }
                    className="w-32 h-7 text-xs shrink-0"
                  />
                  <Input
                    placeholder={t('modelParams.customParameterValue')}
                    value={param.value}
                    onChange={(e) =>
                      updateCustomParameter(index, 'value', e.target.value)
                    }
                    className="flex-1 h-7 min-w-0 text-xs"
                  />
                  <label className="flex items-center gap-1.5 shrink-0 text-xs text-slate-500">
                    <Checkbox
                      checked={param.asString}
                      onCheckedChange={(checked) =>
                        updateCustomParameter(
                          index,
                          'asString',
                          Boolean(checked),
                        )
                      }
                    />
                    {t('modelParams.customParameterString')}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCustomParameter(index)}
                    className="h-7 w-7 p-0 text-slate-400 hover:text-rose-500"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('modelParams.preview')}
                </Label>
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  JSON
                </span>
              </div>
              <pre className="text-[11px] leading-5 p-2.5 rounded-lg border border-slate-200/40 dark:border-slate-700/40 bg-transparent overflow-auto max-h-24 text-slate-600 dark:text-slate-300">
                {JSON.stringify(previewJson, null, 2)}
              </pre>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {t('modelParams.advanced')}
                  </Label>
                  <ParamHelp text={t('modelParams.advancedHelp')} />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setAdvancedEditorOpen((v) => !v)}
                >
                  {advancedEditorOpen
                    ? t('modelParams.collapseAdvanced')
                    : t('modelParams.expandAdvanced')}
                </Button>
              </div>
              {advancedEditorOpen && (
                <textarea
                  value={advancedJsonText === '{}' ? '' : advancedJsonText}
                  onChange={(e) =>
                    setAdvancedJsonText(
                      e.target.value && e.target.value.trim().length > 0
                        ? e.target.value
                        : '{}',
                    )
                  }
                  className="w-full h-32 text-xs font-mono p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-700/50 bg-transparent"
                  placeholder={`{\n  "generationConfig": { "thinkingConfig": { "thinkingBudget": 1024 } }\n}`}
                />
              )}
              {advancedJsonError ? (
                <p className="text-xs text-rose-500">
                  {t('modelParams.invalidJsonDetail').replace(
                    '{0}',
                    () => advancedJsonError,
                  )}
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  {t('modelParams.advancedMergeHelp')}
                </p>
              )}
            </div>
          </div>
        </TooltipProvider>

        <DialogFooter className="glass-dialog-footer px-5 py-3 border-t border-slate-200/40 dark:border-slate-700/40">
          <div className="flex items-center gap-2 w-full min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-8 text-xs text-slate-600 dark:text-slate-300"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              {t('modelParams.resetDefaults')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearSession}
              className="h-8 text-xs text-slate-600 dark:text-slate-300"
            >
              {t('modelParams.clear')}
            </Button>
            <div className="flex-1" />
            <Button
              onClick={handleSave}
              disabled={isLoading}
              className="h-8 glass-btn-accent"
            >
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {t('provider.models.saving')}
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {t('provider.models.apply')}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

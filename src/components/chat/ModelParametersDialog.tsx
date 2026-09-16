"use client";

import { useState, useEffect, type CSSProperties } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { X, Plus, RotateCcw, Settings, Check, HelpCircle } from "lucide-react";
import { specializedStorage } from "@/lib/storage";
import type { ModelParameters } from "@/types/model-params";
import { DEFAULT_MODEL_PARAMETERS, MODEL_PARAMETER_LIMITS } from "@/types/model-params";
import { getProviderFieldSupport, type ProviderFieldSupport } from "@/lib/llm/provider-field-support";

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
        <button type="button" className="inline-flex shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function sliderTrackStyle(enabled: boolean, value: number, min: number, max: number): CSSProperties {
  const pct = calcPercent(value, min, max);
  if (!enabled) return { background: "rgba(148, 163, 184, 0.22)" };
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
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
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
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Checkbox checked={enabled} onCheckedChange={(checked) => onEnabledChange(Boolean(checked))} />
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
        disabled={!enabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={sliderTrackStyle(enabled, value, min, max)}
      />
      <Input
        type="number"
        className="w-[4.75rem] h-7 shrink-0 px-2 text-xs tabular-nums"
        min={inputMin}
        max={inputMax}
        step={step}
        value={value}
        disabled={!enabled}
        onChange={(e) => onChange(parseFloat(e.target.value || "0"))}
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
      <Checkbox checked={enabled} onCheckedChange={(checked) => onEnabledChange(Boolean(checked))} />
      <div className="flex items-center gap-1.5 w-44 shrink-0 min-w-0">
        <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
          {label}
        </Label>
        <ParamHelp text={help} />
      </div>
      <div className="flex-1" />
      <Switch size="sm" checked={value} onCheckedChange={onValueChange} disabled={!enabled} />
    </div>
  );
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
  modelLabel
}: ModelParametersDialogProps) {
  const [parameters, setParameters] = useState<ModelParameters>(DEFAULT_MODEL_PARAMETERS);
  const [stopSequences, setStopSequences] = useState<string[]>([]);
  const [newStopSequence, setNewStopSequence] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>([]);
  const [savedParameters, setSavedParameters] = useState<ModelParameters | null>(null);
  const [advancedEditorOpen, setAdvancedEditorOpen] = useState(false);
  const [advancedJsonText, setAdvancedJsonText] = useState<string>('{}');
  const [advancedJsonError, setAdvancedJsonError] = useState<string>('');
  
  // Provider字段支持信息
  const [providerSupport, setProviderSupport] = useState<ProviderFieldSupport>(() => 
    getProviderFieldSupport(providerName)
  );

  // 更新Provider字段支持信息
  useEffect(() => {
    if (providerName) {
      setProviderSupport(getProviderFieldSupport(providerName));
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
        (parameters as any).streaming !== (savedParameters as any).streaming ||
        JSON.stringify(stopSequences) !== JSON.stringify(savedParameters.stopSequences || []) ||
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
        parameters.frequencyPenalty !== DEFAULT_MODEL_PARAMETERS.frequencyPenalty ||
        parameters.presencePenalty !== DEFAULT_MODEL_PARAMETERS.presencePenalty ||
        (parameters as any).thinking !== (DEFAULT_MODEL_PARAMETERS as any).thinking ||
        (parameters as any).streaming !== (DEFAULT_MODEL_PARAMETERS as any).streaming ||
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
      const savedParams = await specializedStorage.models.getModelParameters(providerName, modelId);
      if (savedParams) {
        setParameters(savedParams as ModelParameters);
        setStopSequences((savedParams as ModelParameters).stopSequences || []);
        setSavedParameters(savedParams as ModelParameters);
        const adv = (savedParams as ModelParameters).advancedOptions || {};
        setAdvancedJsonText(JSON.stringify(adv, null, 2));
        
        // 加载自定义参数
        const customParams: CustomParameter[] = [];
        Object.entries(adv).forEach(([key, value]) => {
          // 排除标准参数
          if (!['temperature', 'maxTokens', 'topP', 'topK', 'minP', 'frequencyPenalty', 'presencePenalty', 'stopSequences'].includes(key)) {
            const asString = typeof value === 'string' && !['true', 'false'].includes(value.toLowerCase()) && isNaN(Number(value));
            customParams.push({
              key,
              value: String(value),
              asString
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
        setAdvancedJsonError(e?.message || 'JSON 格式错误');
        setIsLoading(false);
        return;
      }

      // 合并自定义参数到 advancedOptions
      const customParamsObj: Record<string, any> = {};
      customParameters.forEach(param => {
        if (param.key.trim()) {
          customParamsObj[param.key] = convertValue(param.value, param.asString);
        }
      });

      const configToSave = {
        ...parameters,
        stopSequences,
        advancedOptions: { ...advanced, ...customParamsObj }
      };
      await specializedStorage.models.setModelParameters(providerName, modelId, configToSave);
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
    if (newStopSequence.trim() && !stopSequences.includes(newStopSequence.trim())) {
      setStopSequences([...stopSequences, newStopSequence.trim()]);
      setNewStopSequence("");
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

  // 自定义参数相关函数
  const convertValue = (value: string, asString: boolean = false): any => {
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
  };

  const addCustomParameter = () => {
    setCustomParameters(prev => [...prev, { key: '', value: '', asString: false }]);
  };

  const updateCustomParameter = (index: number, field: keyof CustomParameter, value: any) => {
    setCustomParameters(prev => prev.map((param, i) => 
      i === index ? { ...param, [field]: value } : param
    ));
  };

  const removeCustomParameter = (index: number) => {
    setCustomParameters(prev => prev.filter((_, i) => i !== index));
  };

  // 生成预览JSON
  const generatePreviewJson = () => {
    const result: any = {};
    
    // 标准参数
    if (parameters.enableTemperature && parameters.temperature !== undefined) {
      result.temperature = parameters.temperature;
    }
    if (parameters.enableMaxTokens && parameters.maxTokens !== undefined) {
      result.maxTokens = parameters.maxTokens;
    }
    if (parameters.enableTopP && parameters.topP !== undefined) {
      result.topP = parameters.topP;
    }
    if (parameters.enableTopK && parameters.topK !== undefined) {
      result.topK = parameters.topK;
    }
    if (parameters.enableMinP && parameters.minP !== undefined) {
      result.minP = parameters.minP;
    }
    if (parameters.enableFrequencyPenalty && parameters.frequencyPenalty !== undefined) {
      result.frequencyPenalty = parameters.frequencyPenalty;
    }
    if (parameters.enablePresencePenalty && parameters.presencePenalty !== undefined) {
      result.presencePenalty = parameters.presencePenalty;
    }
    if (stopSequences.length > 0) {
      result.stopSequences = stopSequences;
    }
    
    // 思考和流式响应参数
    if ((parameters as any).enableThinking && (parameters as any).thinking !== undefined) {
      result.thinking = (parameters as any).thinking;
    }
    if ((parameters as any).enableStreaming && (parameters as any).streaming !== undefined) {
      result.streaming = (parameters as any).streaming;
    }
    
    // Format参数
    if ((parameters as any).enableFormat && (parameters as any).format && (parameters as any).format !== 'none') {
      result.format = (parameters as any).format;
    }
    
    // 自定义参数
    customParameters.forEach(param => {
      if (param.key.trim()) {
        result[param.key] = convertValue(param.value, param.asString);
      }
    });
    
    return result;
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
      setAdvancedJsonError(e?.message || 'JSON 格式错误');
    }
  }, [advancedJsonText]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 max-h-[85vh] overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-5 py-3.5 border-b border-slate-200/40 dark:border-slate-700/40">
          <div className="flex items-start gap-2.5 min-w-0">
            <Settings className="w-4 h-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">
                模型参数设置
              </DialogTitle>
              <DialogDescription className="sr-only">
                配置此模型的参数设置，这些设置将仅应用于此特定模型。
              </DialogDescription>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate" title={modelLabel || modelId}>
                {modelLabel || modelId}
                {hasChanges ? " · 已修改" : ""}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                此处设置为该模型的默认参数，影响所有会话。你仍可在「会话参数设置」中临时覆盖。
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <TooltipProvider delayDuration={200}>
        <div className="px-5 py-3 space-y-2.5 max-h-[60vh] overflow-y-auto">
          <ParamSliderRow
            enabled={parameters.enableTemperature !== false}
            onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableTemperature: v }))}
            label="Temperature"
            help="控制输出的随机性。数值越低越确定，越高越有创意。常用范围：0.5–1.0。"
            min={MODEL_PARAMETER_LIMITS.temperature.min}
            max={MODEL_PARAMETER_LIMITS.temperature.max}
            step={MODEL_PARAMETER_LIMITS.temperature.step}
            value={parameters.temperature || 0}
            onChange={(v) => setParameters((prev) => ({ ...prev, temperature: v }))}
            inputMin={MODEL_PARAMETER_LIMITS.temperature.inputMin}
            inputMax={MODEL_PARAMETER_LIMITS.temperature.inputMax}
          />
          <ParamSliderRow
            enabled={parameters.enableMaxTokens !== false}
            onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableMaxTokens: v }))}
            label="Max Tokens"
            help="限制单次回复能生成的最大 Token 数。控制输出长度的硬性限制。"
            min={MODEL_PARAMETER_LIMITS.maxTokens.min}
            max={MODEL_PARAMETER_LIMITS.maxTokens.max}
            step={MODEL_PARAMETER_LIMITS.maxTokens.step}
            value={parameters.maxTokens || 0}
            onChange={(v) => setParameters((prev) => ({ ...prev, maxTokens: Math.round(v) }))}
            inputMin={MODEL_PARAMETER_LIMITS.maxTokens.inputMin}
            inputMax={MODEL_PARAMETER_LIMITS.maxTokens.inputMax}
          />
          <ParamSliderRow
            enabled={parameters.enableTopP !== false}
            onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableTopP: v }))}
            label="Top P"
            help="从累计概率最高的候选中采样。越低越保守。与 Temperature 一般二选一调节。"
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
              enabled={(parameters as any).enableTopK !== false}
              onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableTopK: v } as any))}
              label="Top K"
              help="只考虑概率最高的 K 个候选词。与 Temperature 一般二选一调节。"
              min={MODEL_PARAMETER_LIMITS.topK.min}
              max={MODEL_PARAMETER_LIMITS.topK.max}
              step={MODEL_PARAMETER_LIMITS.topK.step}
              value={(parameters as any).topK || 0}
              onChange={(v) => setParameters((prev) => ({ ...prev, topK: Math.round(v) } as any))}
              inputMin={MODEL_PARAMETER_LIMITS.topK.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.topK.inputMax}
            />
          )}
          {providerSupport.minP && (
            <ParamSliderRow
              enabled={(parameters as any).enableMinP !== false}
              onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableMinP: v } as any))}
              label="Min P"
              help="设置最低概率阈值，低于此值的候选词会被过滤。"
              min={MODEL_PARAMETER_LIMITS.minP.min}
              max={MODEL_PARAMETER_LIMITS.minP.max}
              step={MODEL_PARAMETER_LIMITS.minP.step}
              value={(parameters as any).minP || 0}
              onChange={(v) => setParameters((prev) => ({ ...prev, minP: v } as any))}
              inputMin={MODEL_PARAMETER_LIMITS.minP.inputMin}
              inputMax={MODEL_PARAMETER_LIMITS.minP.inputMax}
            />
          )}
          <ParamSliderRow
            enabled={parameters.enableFrequencyPenalty !== false}
            onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableFrequencyPenalty: v }))}
            label="Frequency Penalty"
            help="增大可降低重复词汇的概率。"
            min={MODEL_PARAMETER_LIMITS.frequencyPenalty.min}
            max={MODEL_PARAMETER_LIMITS.frequencyPenalty.max}
            step={MODEL_PARAMETER_LIMITS.frequencyPenalty.step}
            value={parameters.frequencyPenalty || 0}
            onChange={(v) => setParameters((prev) => ({ ...prev, frequencyPenalty: v }))}
            inputMin={MODEL_PARAMETER_LIMITS.frequencyPenalty.inputMin}
            inputMax={MODEL_PARAMETER_LIMITS.frequencyPenalty.inputMax}
          />
          <ParamSliderRow
            enabled={parameters.enablePresencePenalty !== false}
            onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enablePresencePenalty: v }))}
            label="Presence Penalty"
            help="增大可鼓励模型引入新话题。"
            min={MODEL_PARAMETER_LIMITS.presencePenalty.min}
            max={MODEL_PARAMETER_LIMITS.presencePenalty.max}
            step={MODEL_PARAMETER_LIMITS.presencePenalty.step}
            value={parameters.presencePenalty || 0}
            onChange={(v) => setParameters((prev) => ({ ...prev, presencePenalty: v }))}
            inputMin={MODEL_PARAMETER_LIMITS.presencePenalty.inputMin}
            inputMax={MODEL_PARAMETER_LIMITS.presencePenalty.inputMax}
          />

          <ParamToggleRow
            enabled={(parameters as any).enableThinking === true}
            onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableThinking: v } as any))}
            label="思考模式"
            help="启用后，模型会展示思考过程。关闭则直接输出结果。"
            value={!!(parameters as any).thinking}
            onValueChange={(v) => setParameters((prev) => ({ ...prev, thinking: v } as any))}
          />
          <ParamToggleRow
            enabled={(parameters as any).enableStreaming !== false}
            onEnabledChange={(v) => setParameters((prev) => ({ ...prev, enableStreaming: v } as any))}
            label="流式响应"
            help="启用后实时流式输出。关闭则等待全部生成完成后一次性返回。"
            value={(parameters as any).streaming !== false}
            onValueChange={(v) => setParameters((prev) => ({ ...prev, streaming: v } as any))}
          />

          {/* Format - 仅在Provider支持时显示 */}
          {providerSupport.format && (
            <div className="flex items-center gap-2.5 min-w-0">
              <Checkbox
                checked={(parameters as any).enableFormat !== false}
                onCheckedChange={(checked) => setParameters((prev) => ({ ...prev, enableFormat: Boolean(checked) } as any))}
              />
              <div className="flex items-center gap-1.5 w-44 shrink-0">
                <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">输出格式</Label>
                <ParamHelp text='指定模型输出格式。选择 "json" 可强制返回 JSON。' />
              </div>
              <div className="flex-1" />
              <select
                value={(parameters as any).format || "none"}
                onChange={(e) =>
                  setParameters((prev) => ({
                    ...prev,
                    format: e.target.value === "none" ? undefined : e.target.value,
                  } as any))
                }
                disabled={(parameters as any).enableFormat === false}
                className="h-7 px-2 text-xs rounded-md border border-slate-200/70 dark:border-slate-600/50 bg-transparent text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                <option value="none">无限制</option>
                <option value="json">JSON</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-2.5 min-w-0">
            <Checkbox
              checked={parameters.enableStopSequences !== false}
              onCheckedChange={(checked) => setParameters((prev) => ({ ...prev, enableStopSequences: Boolean(checked) }))}
            />
            <div className="flex items-center gap-1.5 w-44 shrink-0">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">Stop Sequences</Label>
              <ParamHelp text="当生成包含这些序列时停止生成。" />
            </div>
            <Input
              value={newStopSequence}
              onChange={(e) => setNewStopSequence(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入停止序列…"
              className="flex-1 h-7 min-w-0 text-xs"
              disabled={parameters.enableStopSequences === false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addStopSequence}
              disabled={parameters.enableStopSequences === false || !newStopSequence.trim()}
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
                  className="flex items-center gap-1 bg-slate-100/80 text-slate-600 dark:bg-white/8 dark:text-slate-300"
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
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">自定义参数</Label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={addCustomParameter}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                添加
              </Button>
            </div>
            {customParameters.map((param, index) => (
              <div key={index} className="flex items-center gap-2 min-w-0">
                <Input
                  placeholder="名称"
                  value={param.key}
                  onChange={(e) => updateCustomParameter(index, "key", e.target.value)}
                  className="w-32 h-7 text-xs shrink-0"
                />
                <Input
                  placeholder="值"
                  value={param.value}
                  onChange={(e) => updateCustomParameter(index, "value", e.target.value)}
                  className="flex-1 h-7 min-w-0 text-xs"
                />
                <label className="flex items-center gap-1.5 shrink-0 text-xs text-slate-500">
                  <Checkbox
                    checked={param.asString}
                    onCheckedChange={(checked) => updateCustomParameter(index, "asString", Boolean(checked))}
                  />
                  字符串
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
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">参数预览</Label>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">JSON</span>
            </div>
            <pre className="text-[11px] leading-5 p-2.5 rounded-lg border border-slate-200/40 dark:border-slate-700/40 bg-transparent overflow-auto max-h-24 text-slate-600 dark:text-slate-300">
{JSON.stringify(previewJson, null, 2)}
            </pre>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">高级设置</Label>
                <ParamHelp text="高级参数会直接合并到请求选项。仅在清楚目标模型支持字段时使用。" />
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdvancedEditorOpen((v) => !v)}>
                {advancedEditorOpen ? "收起" : "展开"}
              </Button>
            </div>
            {advancedEditorOpen && (
              <textarea
                value={advancedJsonText === "{}" ? "" : advancedJsonText}
                onChange={(e) =>
                  setAdvancedJsonText(e.target.value && e.target.value.trim().length > 0 ? e.target.value : "{}")
                }
                className="w-full h-32 text-xs font-mono p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-700/50 bg-transparent"
                placeholder={`{\n  "generationConfig": { "thinkingConfig": { "thinkingBudget": 1024 } }\n}`}
              />
            )}
            {advancedJsonError ? (
              <p className="text-xs text-rose-500">JSON 格式错误：{advancedJsonError}</p>
            ) : (
              <p className="text-xs text-slate-400">将作为高级选项直接合并到请求中。</p>
            )}
          </div>
        </div>
        </TooltipProvider>

        <DialogFooter className="glass-dialog-footer px-5 py-3 border-t border-slate-200/40 dark:border-slate-700/40">
          <div className="flex items-center gap-2 w-full min-w-0">
            <Button variant="ghost" size="sm" onClick={handleReset} className="h-8 text-xs text-slate-600 dark:text-slate-300">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              重置为系统默认
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClearSession} className="h-8 text-xs text-slate-600 dark:text-slate-300">
              清除模型参数
            </Button>
            <div className="flex-1" />
            <Button onClick={handleSave} disabled={isLoading} className="h-8 glass-btn-accent">
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  应用
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 
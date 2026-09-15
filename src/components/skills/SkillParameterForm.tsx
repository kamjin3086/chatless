'use client';

import React, { useState, useCallback, useMemo } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { Skill, SkillParameter, SkillParameterValues } from '@/lib/skills/types';
import { Sparkles, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

interface SkillParameterFormProps {
  skill: Skill;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: SkillParameterValues) => void;
  onCancel?: () => void;
}

export function SkillParameterForm({
  skill,
  open,
  onOpenChange,
  onSubmit,
  onCancel,
}: SkillParameterFormProps) {
  const parameters = skill.parameters || [];
  
  // 初始化参数值
  const initialValues = useMemo(() => {
    const values: SkillParameterValues = {};
    for (const param of parameters) {
      if (param.default !== undefined) {
        values[param.name] = param.default;
      } else if (param.type === 'multiselect') {
        values[param.name] = [];
      } else if (param.type === 'boolean') {
        values[param.name] = false;
      } else if (param.type === 'number') {
        values[param.name] = 0;
      } else {
        values[param.name] = '';
      }
    }
    return values;
  }, [parameters]);

  const [values, setValues] = useState<SkillParameterValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 重置表单
  React.useEffect(() => {
    if (open) {
      setValues(initialValues);
      setErrors({});
    }
  }, [open, initialValues]);

  // 更新参数值
  const updateValue = useCallback((name: string, value: string | number | boolean | string[]) => {
    setValues(prev => ({ ...prev, [name]: value }));
    // 清除该字段的错误
    if (errors[name]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  }, [errors]);

  // 验证表单
  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    
    for (const param of parameters) {
      const value = values[param.name];
      
      // 必填验证
      if (param.required) {
        if (value === undefined || value === null || value === '') {
          newErrors[param.name] = `${param.label} 是必填项`;
          continue;
        }
        if (Array.isArray(value) && value.length === 0) {
          newErrors[param.name] = `请至少选择一个 ${param.label}`;
          continue;
        }
      }
      
      // 类型特定验证
      if (value !== undefined && value !== null && value !== '') {
        const validation = param.validation;
        
        if (param.type === 'number' && typeof value === 'number') {
          if (validation?.min !== undefined && value < validation.min) {
            newErrors[param.name] = validation.message || `${param.label} 不能小于 ${validation.min}`;
          }
          if (validation?.max !== undefined && value > validation.max) {
            newErrors[param.name] = validation.message || `${param.label} 不能大于 ${validation.max}`;
          }
        }
        
        if ((param.type === 'text' || param.type === 'textarea') && typeof value === 'string') {
          if (validation?.minLength !== undefined && value.length < validation.minLength) {
            newErrors[param.name] = validation.message || `${param.label} 至少需要 ${validation.minLength} 个字符`;
          }
          if (validation?.maxLength !== undefined && value.length > validation.maxLength) {
            newErrors[param.name] = validation.message || `${param.label} 不能超过 ${validation.maxLength} 个字符`;
          }
          if (validation?.pattern) {
            const regex = new RegExp(validation.pattern);
            if (!regex.test(value)) {
              newErrors[param.name] = validation.message || `${param.label} 格式不正确`;
            }
          }
        }
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [parameters, values]);

  // 提交表单
  const handleSubmit = useCallback(() => {
    if (validate()) {
      onSubmit(values);
    }
  }, [validate, onSubmit, values]);

  // 检查参数是否应该显示
  const shouldShowParameter = useCallback((param: SkillParameter): boolean => {
    if (!param.showWhen) return true;
    const { parameter, value } = param.showWhen;
    return values[parameter] === value;
  }, [values]);

  // 分离普通参数和高级参数
  const { normalParams, advancedParams } = useMemo(() => {
    const normal: SkillParameter[] = [];
    const advanced: SkillParameter[] = [];
    for (const param of parameters) {
      if (param.advanced) {
        advanced.push(param);
      } else {
        normal.push(param);
      }
    }
    return { normalParams: normal, advancedParams: advanced };
  }, [parameters]);

  // 渲染单个参数输入
  const renderParameterInput = (param: SkillParameter) => {
    if (!shouldShowParameter(param)) return null;

    const error = errors[param.name];
    const value = values[param.name];

    switch (param.type) {
      case 'text':
        return (
          <div key={param.name} className="space-y-2">
            <Label htmlFor={param.name} className="flex items-center gap-1">
              {param.label}
              {param.required && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id={param.name}
              type="text"
              value={String(value || '')}
              onChange={(e) => updateValue(param.name, e.target.value)}
              placeholder={param.placeholder}
              className={cn(error && 'border-red-500')}
            />
            {param.description && (
              <p className="text-xs text-gray-500">{param.description}</p>
            )}
            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>
        );

      case 'textarea':
        return (
          <div key={param.name} className="space-y-2">
            <Label htmlFor={param.name} className="flex items-center gap-1">
              {param.label}
              {param.required && <span className="text-red-500">*</span>}
            </Label>
            <Textarea
              id={param.name}
              value={String(value || '')}
              onChange={(e) => updateValue(param.name, e.target.value)}
              placeholder={param.placeholder}
              rows={3}
              className={cn(error && 'border-red-500')}
            />
            {param.description && (
              <p className="text-xs text-gray-500">{param.description}</p>
            )}
            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>
        );

      case 'number':
        return (
          <div key={param.name} className="space-y-2">
            <Label htmlFor={param.name} className="flex items-center gap-1">
              {param.label}
              {param.required && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id={param.name}
              type="number"
              value={String(value || 0)}
              onChange={(e) => updateValue(param.name, Number(e.target.value))}
              placeholder={param.placeholder}
              min={param.validation?.min}
              max={param.validation?.max}
              className={cn(error && 'border-red-500')}
            />
            {param.description && (
              <p className="text-xs text-gray-500">{param.description}</p>
            )}
            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>
        );

      case 'boolean':
        return (
          <div key={param.name} className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label htmlFor={param.name} className="flex items-center gap-1">
                {param.label}
                {param.required && <span className="text-red-500">*</span>}
              </Label>
              {param.description && (
                <p className="text-xs text-gray-500">{param.description}</p>
              )}
            </div>
            <Switch
              checked={Boolean(value)}
              onCheckedChange={(checked) => updateValue(param.name, checked)}
            />
          </div>
        );

      case 'select':
        return (
          <div key={param.name} className="space-y-2">
            <Label htmlFor={param.name} className="flex items-center gap-1">
              {param.label}
              {param.required && <span className="text-red-500">*</span>}
            </Label>
            {param.options && param.options.length <= 4 ? (
              // 选项少时用 RadioGroup
              <RadioGroup
                value={String(value || '')}
                onValueChange={(v: string) => updateValue(param.name, v)}
                className="flex flex-wrap gap-4"
              >
                {param.options.map((option) => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={option.value} id={`${param.name}-${option.value}`} />
                    <Label htmlFor={`${param.name}-${option.value}`} className="font-normal cursor-pointer">
                      {option.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            ) : (
              // 选项多时用 Select
              <Select
                value={String(value || '')}
                onValueChange={(v: string) => updateValue(param.name, v)}
              >
                <SelectTrigger className={cn(error && 'border-red-500')}>
                  <SelectValue placeholder={param.placeholder || '请选择'} />
                </SelectTrigger>
                <SelectContent>
                  {param.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {param.description && (
              <p className="text-xs text-gray-500">{param.description}</p>
            )}
            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>
        );

      case 'multiselect':
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <div key={param.name} className="space-y-2">
            <Label className="flex items-center gap-1">
              {param.label}
              {param.required && <span className="text-red-500">*</span>}
            </Label>
            <div className="flex flex-wrap gap-3">
              {param.options?.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${param.name}-${option.value}`}
                    checked={selectedValues.includes(option.value)}
                    onCheckedChange={(checked) => {
                      const newValue = checked
                        ? [...selectedValues, option.value]
                        : selectedValues.filter(v => v !== option.value);
                      updateValue(param.name, newValue);
                    }}
                  />
                  <Label htmlFor={`${param.name}-${option.value}`} className="font-normal cursor-pointer">
                    {option.label}
                  </Label>
                </div>
              ))}
            </div>
            {param.description && (
              <p className="text-xs text-gray-500">{param.description}</p>
            )}
            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  if (parameters.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>{skill.name} 参数配置</DialogTitle>
              <DialogDescription>
                请填写以下参数以定制技能行为
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
          {/* 普通参数 */}
          {normalParams.map(renderParameterInput)}
          
          {/* 高级参数（可折叠） */}
          {advancedParams.length > 0 && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                高级选项
              </button>
              {showAdvanced && (
                <div className="mt-4 space-y-4">
                  {advancedParams.map(renderParameterInput)}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
          >
            取消
          </Button>
          <Button onClick={handleSubmit}>
            应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


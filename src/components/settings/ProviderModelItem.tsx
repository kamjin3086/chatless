"use client";
import React, { useState, useRef, useEffect } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { InputField } from "./InputField";
import { KeyRound, MoreHorizontal, SlidersHorizontal, Brain, Workflow, Camera, Trash2, Zap, RotateCcw } from "lucide-react";
import type { ModelMetadata } from "@/lib/metadata/types";
import { toast } from "@/components/ui/sonner";
import { getModelCapabilities } from "@/lib/provider/staticModels";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useModelCheckStore } from '@/store/modelCheckStore';

interface ProviderModelItemProps {
  providerName: string;
  model: ModelMetadata;
  showApiKeyFields: boolean;
  apiKeyValue: string;
  setApiKeyValue: (next: string) => void;
  onModelApiKeyChange: (modelName: string, apiKey: string) => void;
  onModelApiKeyBlur: (modelName: string) => void;
  onOpenParameters: (modelId: string, modelLabel?: string) => void;
  onRename: (modelName: string, nextLabel: string) => Promise<void>;
  canDelete: boolean;
  onDelete: () => Promise<void>;
  // 批量模式回显/设置策略
  showStrategyBadge?: boolean;
  strategy?: string | null;
  onStrategyChange?: (s: string | null) => void;
  allowStrategyActions?: boolean;
  allowDelete?: boolean;
}

function ProviderModelItemBase(props: ProviderModelItemProps) {
  const {
    providerName,
    model,
    showApiKeyFields,
    apiKeyValue,
    setApiKeyValue,
    onModelApiKeyChange,
    onModelApiKeyBlur,
    onOpenParameters,
    onRename: _onRename,
    canDelete,
    onDelete,
    showStrategyBadge,
    strategy,
    onStrategyChange,
    allowStrategyActions = true,
    allowDelete = true,
  } = props;

  // 控制“模型级 API Key”输入展开/收起
  const [editingModelKey, setEditingModelKey] = useState(false);
  const modelKeyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!editingModelKey) return;
      if (modelKeyRef.current && !modelKeyRef.current.contains(e.target as Node)) {
        setEditingModelKey(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [editingModelKey]);

  return (
    <div className="group/item w-full flex items-center gap-1 pl-2 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors rounded">
      {/* 左侧：模型名与能力标记 */}
      <div className="flex flex-row items-center justify-start flex-auto min-w-0 pr-1 gap-1 text-[11px]">
        <button
          type="button"
          className="text-left text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate hover:bg-gray-100/60 dark:hover:bg-gray-800/60 rounded px-0.5"
          title={model.name}
          onClick={async()=>{ 
            try { 
              await navigator.clipboard.writeText(model.name);  
              toast.success('已复制模型ID', { description: model.name, duration: 2000 });
            } catch { toast.error('复制失败'); } 
          }}
        >
          {model.label || model.name}
        </button>

        {/* 能力图标 */}
        {(() => {
          const caps = getModelCapabilities(model.name);
          const items: Array<{ ok: boolean; Icon: any; title: string }> = [
            { ok: !!caps.supportsThinking, Icon: Brain, title: '支持思考/推理' },
            { ok: !!caps.supportsFunctionCalling, Icon: Workflow, title: '支持工具调用' },
            { ok: !!caps.supportsVision, Icon: Camera, title: '支持视觉' },
          ];
          return (
            <span className="inline-flex items-center gap-0.5 text-gray-400">
              {items.filter(i=>i.ok).map((i, idx) => (
                <i.Icon key={idx} className="w-3 h-3" title={i.title} />
              ))}
            </span>
          );
        })()}
        {/* 策略小徽标（仅批量模式展示） */}
        {showStrategyBadge && (
          <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] border ${strategy? 'border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-300' : 'border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-400'}`}
            title={strategy ? `当前覆盖策略：${strategy}` : '使用 Provider 默认策略'}>
            {strategy || '默认'}
          </span>
        )}
      </div>

      {/* 右侧：输入与菜单，整体右对齐 */}
      <div className="ml-auto mr-2 flex items-center gap-0.5">
        {/* 健康检查：悬浮可见的小按钮 */}
        {(() => {
          const prompt = "Respond with only the word 'OK'";
          const inputTokenEst = Math.max(1, Math.round(prompt.length / 4));
          const maxOut = 8;
          const [isChecking, setIsChecking] = useState(false);
          const last = useModelCheckStore(s=>s.getResult(providerName, model.name));
          const setResult = useModelCheckStore(s=>s.setResult);
          async function runHealthCheck() {
            setIsChecking(true)
            const start = Date.now();
            // 极小成本提示词与参数
            const messages = [{ role: 'user', content: prompt }];
            const opts: any = { temperature: 0, maxTokens: 8, stream: true };
            // 简单 token 估算（英文4字符≈1token）
            try {
              const { chat } = await import('@/lib/llm');
              const result = await chat(providerName, model.name, messages as any, opts);
              const content = (result?.content || '').trim();
              const ok = !!content;
              const duration = Date.now() - start;
              const outputTokenEst = Math.max(1, Math.round((content || 'OK').length / 4));
              const totalTokenEst = inputTokenEst + outputTokenEst;
              if (ok) {
                setResult(providerName, model.name, { ok: true, durationMs: duration, tokenEstimate: totalTokenEst, timestamp: Date.now() });
                toast.success(`模型 ${model.label || model.name} 可用`, {
                  description: `耗时 ${duration}ms · 估算Tokens≈${totalTokenEst}`,
                });
              } else {
                throw new Error('响应内容为空，可能为不兼容的返回格式');
              }
            } catch (err: any) {
              const duration = Date.now() - start;
              const msg: string = (err?.userMessage) || (typeof err?.message === 'string' ? err.message : '测试失败');
              // 归类常见错误，给出友好指引
              let hint = '';
              const em = (msg || '').toLowerCase();
              if (em.includes('no_key') || em.includes('no key')) {
                hint = '未配置密钥：请为该 Provider 或模型设置 API Key';
              } else if (em.includes('401')) {
                hint = '认证失败：请检查 API Key 是否正确/有权限';
              } else if (em.includes('404')) {
                hint = '未找到：请检查服务地址或模型名称是否正确';
              } else if (em.includes('429')) {
                hint = '限流：请稍后重试或降低频率';
              } else if (em.includes('http 5') || em.includes(' 5')) {
                hint = '服务异常：提供商服务暂时异常，请稍后重试';
              }
              toast.error('模型不可用', {
                description: `${msg}${hint ? ` · ${hint}` : ''} · ${duration}ms`,
                duration: 6000,
              });
              setResult(providerName, model.name, { ok: false, durationMs: duration, message: msg, timestamp: Date.now() });
            }
            setIsChecking(false)
          }
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="cursor-pointer h-5 w-5 flex items-center justify-center rounded  dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto focus:opacity-100 focus:pointer-events-auto transition-opacity"
                    onClick={(e)=>{ e.preventDefault(); runHealthCheck(); }}
                    title=""
                  >
                    {isChecking? <RotateCcw className="w-4 h-4 animate-spin" />:<Zap className="w-4 h-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {last ? (
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium flex items-center gap-1">
                        上次检查：{new Date(last.timestamp).toLocaleTimeString()}
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${last.ok ? 'bg-green-500' : 'bg-red-500'}`}
                          title={last.ok ? '可用' : '不可用'}
                        ></span>
                      </div>
                      <div className="text-xs">结果：{last.ok ? '可用' : '不可用'}</div>
                      <div className="text-xs">耗时：{last.durationMs}ms{typeof last.tokenEstimate==='number' ? ` · Tokens≈${last.tokenEstimate}` : ''}</div>
                      {last.message ? <div className="text-xs text-red-500">{last.message}</div> : null}
                      <div className="text-xs text-gray-500">点击重新检查</div>
                    </div>
                  ) : (
                    <div className="text-xs">快速健康检查 · 预计消耗 ≤ {inputTokenEst + maxOut} tokens</div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })()}

        {/* 先放菜单按钮 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 dark:text-gray-500">
              <MoreHorizontal className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-56 p-1">
            {/* 头部标题 */}
            <div className="px-2 py-1.5 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate block" title={model.label || model.name}>
                {model.label || model.name}
              </span>
            </div>

            {/* 参数设置 */}
            <DropdownMenuItem 
              className="flex items-center gap-2 px-2 py-1.5 text-[11px] cursor-pointer" 
              onSelect={() => {
                onOpenParameters(model.name, model.label);
              }}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-gray-500" />
              <span>参数设置</span>
            </DropdownMenuItem>

            {/* 策略设置 */}
            {allowStrategyActions && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2 px-2 py-1.5 text-[11px] cursor-pointer">
                  <Workflow className="w-3.5 h-3.5 text-gray-500" />
                  <span className="flex-1">请求策略</span>
                  {strategy && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded">
                      {strategy}
                    </span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44 p-1">
                  {/* 自动推断 */}
                  <DropdownMenuItem 
                    className="flex items-center gap-2 px-2 py-1.5 text-[11px]"
                    onSelect={async(e: any) => {
                      e?.preventDefault?.();
                      try {
                        const { inferStrategyFromModelId } = require('@/lib/provider/strategyInference');
                        const { specializedStorage } = await import('@/lib/storage');
                        const st = inferStrategyFromModelId(model.name);
                        if (!st) { toast.success('未命中规则，已跳过'); return; }
                        await specializedStorage.models.setModelStrategy(providerName, model.name, st);
                        onStrategyChange?.(st);
                        toast.success('已自动推断并设置策略');
                      } catch(err) { 
                        console.error(err); 
                        toast.error('自动推断失败'); 
                      }
                    }}
                  >
                    <Zap className="w-3 h-3 text-purple-500" />
                    <span>自动推断</span>
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator />
                  
                  {/* 策略选项 */}
                  {['openai-compatible','openai-responses','openai','anthropic','gemini','deepseek'].map((s) => (
                    <DropdownMenuItem 
                      key={s}
                      className={`flex items-center gap-2 px-2 py-1.5 text-[11px] ${strategy === s ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300' : ''}`}
                      onSelect={async(e: any) => {
                        e?.preventDefault?.();
                        try { 
                          const { specializedStorage } = await import('@/lib/storage'); 
                          await specializedStorage.models.setModelStrategy(providerName, model.name, s as any); 
                          onStrategyChange?.(s); 
                          toast.success('已更新策略'); 
                        } catch(err) { 
                          console.error(err); 
                          toast.error('更新策略失败'); 
                        }
                      }}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${strategy === s ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span>{s}</span>
                    </DropdownMenuItem>
                  ))}
                  
                  <DropdownMenuSeparator />
                  
                  {/* 清除策略 */}
                  <DropdownMenuItem 
                    className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-gray-500"
                    onSelect={async(e: any) => {
                      e?.preventDefault?.();
                      try { 
                        const { specializedStorage } = await import('@/lib/storage'); 
                        await specializedStorage.models.removeModelStrategy(providerName, model.name); 
                        onStrategyChange?.(null); 
                        toast.success('已清除覆盖'); 
                      } catch(err) { 
                        console.error(err); 
                        toast.error('清除失败'); 
                      }
                    }}
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>重置为默认</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            <DropdownMenuSeparator />

            {/* 重命名 */}
            <div className="px-1">
              {(() => {
                const { ProviderRenameModelDialog } = require('./ProviderRenameModelDialog');
                return (
                  <ProviderRenameModelDialog providerName={providerName} modelName={model.name} currentLabel={model.label} />
                );
              })()}
            </div>
            {canDelete && allowDelete && (
              <>
                <DropdownMenuSeparator />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem 
                      variant="destructive" 
                      className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400 cursor-pointer" 
                      onSelect={(e:any)=>e?.preventDefault?.()}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>删除模型</span>
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除该模型？</AlertDialogTitle>
                      <AlertDialogDescription>该操作仅删除本地配置中的"用户新增模型"条目，不会影响远端服务。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={onDelete}>确认删除</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 模型级 API Key：默认以小钥匙图标呈现，点击后展开输入框 */}
        {showApiKeyFields && (
          <div className="flex items-center" ref={modelKeyRef}>
            {!editingModelKey ? (
              <button
                type="button"
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400"
                title={apiKeyValue ? '已设置模型密钥（点击修改）' : '设置模型密钥'}
                onClick={()=>setEditingModelKey(true)}
              >
                <KeyRound className="w-3.5 h-3.5" />
              </button>
            ) : (
              <InputField
                label=""
                type="password"
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                onBlur={() => { onModelApiKeyChange(model.name, apiKeyValue || ''); onModelApiKeyBlur(model.name); setEditingModelKey(false); }}
                onKeyDown={(e:any)=>{ if (e.key === 'Escape') { setEditingModelKey(false); e.currentTarget.blur(); } }}
                placeholder="模型 API Key (可选)"
                className="h-7 text-xs w-40"
                wrapperClassName="mb-0 flex-shrink-0"
                icon={<KeyRound className="w-3 h-3 text-gray-400" />}
              />
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export function ProviderModelItem(props: ProviderModelItemProps) {
  return <ProviderModelItemBase {...props} />;
}

export const ProviderModelItemMemo = React.memo(ProviderModelItemBase);


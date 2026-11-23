"use client";
import React, { useState, useRef, useEffect } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { InputField } from "./InputField";
import { ProviderRenameModelDialog } from "./ProviderRenameModelDialog";
import { KeyRound, MoreHorizontal, SlidersHorizontal, Brain, Workflow, Camera, Trash2, Zap, RotateCcw, Check } from "lucide-react";
import type { ModelMetadata } from "@/lib/metadata/types";
import { toast } from "@/components/ui/sonner";
import { useTranslation } from "@/i18n/useTranslation";
import { translateProviderModelNotification } from "./providerModelPresentation";
import { getHtmlLang } from "@/i18n";
import type { TranslationKey } from "@/i18n/types";
import { useLocaleStore } from "@/store/localeStore";
import { getModelCapabilities } from "@/lib/provider/staticModels";
import { inferStrategyFromModelId } from "@/lib/provider/strategyInference";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useModelCheckStore } from '@/store/modelCheckStore';
import { MODEL_PROBE_MAX_OUTPUT_TOKENS, MODEL_PROBE_TOKEN_BOUND, probeModel } from '@/lib/llm/modelProbe';

// Keep the persisted note unchanged; render this known first-party note in the current locale.
const TRUNCATED_PROBE_NOTE = `回答在 ${MODEL_PROBE_MAX_OUTPUT_TOKENS} tokens 上限处截断，端点已回包`;

/**
 * Common failures get a one-line remedy; the provider's own text stays in front of
 * it. Classification is by substring because these are HTTP/transport texts, not
 * typed errors.
 */
function getFailureHintKey(msg: string): TranslationKey | undefined {
  const em = (msg || '').toLowerCase();
  if (em.includes('no_key') || em.includes('no key')) {
    return 'provider.models.check.noKey';
  }
  if (em.includes('401')) return 'provider.models.check.unauthorized';
  if (em.includes('404')) return 'provider.models.check.notFound';
  if (em.includes('429')) return 'provider.models.check.rateLimited';
  if (em.includes('http 5') || em.includes(' 5')) {
    return 'provider.models.check.serviceError';
  }
  return undefined;
}

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

  const t = useTranslation();
  const locale = useLocaleStore((state) => state.locale);

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
    <div className="group/item w-full flex items-center gap-1 px-1.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors rounded-md">
      {/* 左侧：模型名与能力标记 */}
      <div className="flex flex-row items-center justify-start flex-auto min-w-0 pr-1 gap-1.5 text-sm">
        <button
          type="button"
          className="text-left text-sm font-medium text-slate-700 dark:text-slate-300 truncate hover:text-slate-900 dark:hover:text-slate-100 rounded-md px-0.5"
          title={model.name}
          onClick={async()=>{ 
            try { 
              await navigator.clipboard.writeText(model.name);  
              toast.success(translateProviderModelNotification('provider.models.idCopied'), { description: model.name, duration: 2000 });
            } catch { toast.error(translateProviderModelNotification('provider.models.copyIdFailed')); }
          }}
        >
          {model.label || model.name}
        </button>

        {/* 能力图标 */}
        {(() => {
          const caps = getModelCapabilities(model.name);
          const items: Array<{ ok: boolean; Icon: any; title: string }> = [
            { ok: !!caps.supportsThinking, Icon: Brain, title: t('provider.models.supportsReasoning') },
            { ok: !!caps.supportsFunctionCalling, Icon: Workflow, title: t('provider.models.supportsTools') },
            { ok: !!caps.supportsVision, Icon: Camera, title: t('provider.models.supportsVision') },
          ];
          return (
            <span className="inline-flex items-center gap-0.5 text-slate-400">
              {items.filter(i=>i.ok).map((i, idx) => (
                <i.Icon key={idx} className="w-3.5 h-3.5" title={i.title} />
              ))}
            </span>
          );
        })()}
        {/* 策略小徽标（仅批量模式展示） */}
        {showStrategyBadge && (
          <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[10px] border ${strategy? 'border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-300' : 'border-slate-300 text-slate-400 dark:border-slate-700 dark:text-slate-400'}`}
            title={strategy ? t('provider.models.currentOverride').replace('{0}', () => strategy) : t('provider.models.followDefault')}>
            {strategy || t('provider.models.default')}
          </span>
        )}
      </div>

      {/* 右侧：输入与菜单，整体右对齐 */}
      <div className="ml-auto mr-2 flex items-center gap-0.5">
        {/* 健康检查：悬浮可见的小按钮 */}
        {(() => {
          const [isChecking, setIsChecking] = useState(false);
          const last = useModelCheckStore(s=>s.getResult(providerName, model.name));
          const setResult = useModelCheckStore(s=>s.setResult);
          async function runHealthCheck() {
            setIsChecking(true)
            try {
              const verdict = await probeModel(providerName, model.name);
              if (verdict.ok) {
                // 截断是探测自己 8 tokens 上限造成的，端点已经回包，模型可用（#151）
                const note = verdict.status === 'truncated'
                  ? TRUNCATED_PROBE_NOTE
                  : undefined;
                setResult(providerName, model.name, { ok: true, durationMs: verdict.durationMs, tokenEstimate: verdict.tokenEstimate, note, timestamp: Date.now() });
                const details = [
                  translateProviderModelNotification('provider.models.check.duration').replace('{0}', String(verdict.durationMs)),
                  translateProviderModelNotification('provider.models.check.tokenEstimate').replace('{0}', String(verdict.tokenEstimate)),
                ];
                if (note) details.push(translateProviderModelNotification('provider.models.check.truncated').replace('{0}', String(MODEL_PROBE_MAX_OUTPUT_TOKENS)));
                toast.success(translateProviderModelNotification('provider.models.check.success').replace('{0}', () => model.label || model.name), {
                  description: details.join(' · '),
                });
                return;
              }
              const msg = verdict.message || translateProviderModelNotification('provider.models.check.testFailed');
              const hintKey = getFailureHintKey(msg);
              const hint = hintKey ? translateProviderModelNotification(hintKey) : undefined;
              const duration = translateProviderModelNotification('provider.models.check.duration').replace('{0}', String(verdict.durationMs));
              toast.error(translateProviderModelNotification('provider.models.check.failure'), {
                description: `${msg}${hint ? ` · ${hint}` : ''} · ${duration}`,
                duration: 6000,
              });
              setResult(providerName, model.name, { ok: false, durationMs: verdict.durationMs, message: msg, timestamp: Date.now() });
            } finally {
              setIsChecking(false)
            }
          }
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="cursor-pointer h-5 w-5 flex items-center justify-center rounded-md  dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 opacity-0 pointer-events-none group-hover/item:opacity-100 group-hover/item:pointer-events-auto focus:opacity-100 focus:pointer-events-auto transition-opacity"
                    onClick={(e)=>{ e.preventDefault(); runHealthCheck(); }}
                    aria-label={t('provider.models.check.run')}
                  >
                    {isChecking? <RotateCcw className="w-4 h-4 animate-spin" />:<Zap className="w-4 h-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {last ? (
                    <div className="space-y-0.5">
                      <div className="text-xs font-medium flex items-center gap-1">
                        {t('provider.models.check.lastChecked').replace('{0}', new Date(last.timestamp).toLocaleTimeString(getHtmlLang(locale)))}
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${last.ok ? 'bg-green-500' : 'bg-red-500'}`}
                          title={t(last.ok ? 'provider.models.check.available' : 'provider.models.check.unavailable')}
                        ></span>
                      </div>
                      <div className="text-xs">{t('provider.models.check.result').replace('{0}', t(last.ok ? 'provider.models.check.available' : 'provider.models.check.unavailable'))}</div>
                      <div className="text-xs">{t('provider.models.check.duration').replace('{0}', String(last.durationMs))}{typeof last.tokenEstimate === 'number' ? ` · ${t('provider.models.check.tokenEstimate').replace('{0}', String(last.tokenEstimate))}` : ''}</div>
                      {last.note ? <div className="text-xs text-slate-500">{last.note === TRUNCATED_PROBE_NOTE ? t('provider.models.check.truncated').replace('{0}', String(MODEL_PROBE_MAX_OUTPUT_TOKENS)) : last.note}</div> : null}
                      {last.message ? <div className="text-xs text-red-500">{last.message}</div> : null}
                      <div className="text-xs text-slate-500">{t('provider.models.check.recheck')}</div>
                    </div>
                  ) : (
                    <div className="text-xs">{t('provider.models.check.quick').replace('{0}', String(MODEL_PROBE_TOKEN_BOUND))}</div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })()}

        {/* 先放菜单按钮 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label={t('provider.models.actions')} className="h-4 w-4 flex items-center justify-center rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 dark:text-slate-500">
              <MoreHorizontal className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-48">
            <DropdownMenuLabel className="truncate" title={model.label || model.name}>
              {model.label || model.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={() => {
                onOpenParameters(model.name, model.label);
              }}
            >
              <SlidersHorizontal />
              {t('provider.models.parameters')}
            </DropdownMenuItem>

            {allowStrategyActions && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Workflow />
                  {t('provider.models.requestStrategy')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <DropdownMenuItem
                    onSelect={async (e: any) => {
                      e?.preventDefault?.();
                      try {
                        const { specializedStorage } = await import('@/lib/storage');
                        const st = inferStrategyFromModelId(model.name);
                        if (!st) { toast.success(translateProviderModelNotification('provider.models.inferStrategySkipped')); return; }
                        await specializedStorage.models.setModelStrategy(providerName, model.name, st);
                        onStrategyChange?.(st);
                        toast.success(translateProviderModelNotification('provider.models.inferStrategyApplied'));
                      } catch (err) {
                        console.error(err);
                        toast.error(translateProviderModelNotification('provider.models.inferStrategyFailed'));
                      }
                    }}
                  >
                    <Zap />
                    {t('provider.models.inferStrategy')}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {([
                    ['openai-compatible', 'OpenAI Compatible'],
                    ['openai-responses', 'OpenAI Responses'],
                    ['openai', 'OpenAI Strict'],
                    ['anthropic', 'Anthropic'],
                    ['gemini', 'Gemini'],
                    ['deepseek', 'DeepSeek'],
                  ] as const).map(([id, label]) => (
                    <DropdownMenuItem
                      key={id}
                      onSelect={async (e: any) => {
                        e?.preventDefault?.();
                        try {
                          const { specializedStorage } = await import('@/lib/storage');
                          await specializedStorage.models.setModelStrategy(providerName, model.name, id as any);
                          onStrategyChange?.(id);
                          toast.success(translateProviderModelNotification('provider.models.modelStrategyUpdated'));
                        } catch (err) {
                          console.error(err);
                          toast.error(translateProviderModelNotification('provider.models.modelStrategyFailed'));
                        }
                      }}
                    >
                      <Check className={strategy === id ? "opacity-100" : "opacity-0"} />
                      {label}
                    </DropdownMenuItem>
                  ))}

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onSelect={async (e: any) => {
                      e?.preventDefault?.();
                      try {
                        const { specializedStorage } = await import('@/lib/storage');
                        await specializedStorage.models.removeModelStrategy(providerName, model.name);
                        onStrategyChange?.(null);
                        toast.success(translateProviderModelNotification('provider.models.overrideCleared'));
                      } catch (err) {
                        console.error(err);
                        toast.error(translateProviderModelNotification('provider.models.clearOverridesFailed'));
                      }
                    }}
                  >
                    <RotateCcw />
                    {t('provider.models.resetStrategy')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            <DropdownMenuSeparator />

            <ProviderRenameModelDialog providerName={providerName} modelName={model.name} currentLabel={model.label} />
            {canDelete && allowDelete && (
              <>
                <DropdownMenuSeparator />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e: any) => e?.preventDefault?.()}
                    >
                      <Trash2 />
                      {t('provider.models.delete')}
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('provider.models.deleteTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('provider.models.deleteDescription')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={onDelete}>{t('provider.models.confirmDelete')}</AlertDialogAction>
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
                className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400"
                title={apiKeyValue ? t('provider.models.editModelKey') : t('provider.models.setModelKey')}
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
                placeholder={t('provider.models.optionalModelKey')}
                className="h-7 text-xs w-40"
                wrapperClassName="mb-0 flex-shrink-0"
                icon={<KeyRound className="w-3 h-3 text-slate-400" />}
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


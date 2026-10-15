'use client';

/**
 * The quick thinking-level switch (#100).
 *
 * Deliberately thin. Every rule - which scope is answering, what a click writes, where the
 * shortcut steps, what happens to the retired boolean - lives in `@/lib/chat/thinkingScope`
 * and its two friends, where it is tested. This file draws that and routes writes to
 * whichever store owns the scope. The repo has no component test harness, so anything
 * logic-shaped here would be untested by construction.
 */
import { Brain } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ModelParametersService } from '@/lib/model-parameters';
import {
  type ThinkingChoice,
  type ThinkingMigration,
  type ThinkingScope,
  applyThinkingChoice,
  cycleThinkingLevel,
  effectiveThinking,
  migrateLegacyThinkingBoolean,
  readThinkingChoice,
} from '@/lib/chat/thinkingScope';
import {
  clearMessageScope,
  peekMessageScope,
  setMessageScope,
  subscribeMessageScope,
} from '@/lib/chat/messageThinkingScope';
import type { ThinkingLevel } from '@/lib/llm/thinkingLevels';
import type { ModelParameters } from '@/types/model-params';
import { useLocaleStore } from '@/store/localeStore';
import type { TranslationKey } from '@/i18n/types';
import { cn } from '@/lib/utils';

interface ThinkingLevelSwitchProps {
  provider: string;
  modelId: string | null;
  conversationId: string;
  sessionParameters?: Partial<ModelParameters> | null;
  /** Lets the page reload its session bag after this control writes one. */
  onSessionParametersSaved?: () => void | Promise<void>;
  disabled?: boolean;
}

/** True when the keystroke belongs to text entry, not to the shortcut. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

export function ThinkingLevelSwitch({
  provider,
  modelId,
  conversationId,
  sessionParameters,
  onSessionParametersSaved,
  disabled = false,
}: ThinkingLevelSwitchProps) {
  const translate = useLocaleStore((s) => s.t);
  // Level, scope and source names are picked from data, which a key union cannot express,
  // so the cast lives here at the boundary instead of blurring the whole function.
  const t = (key: string) => translate(key as TranslationKey);
  const [open, setOpen] = useState(false);
  // One place to write, so the menu is a level and nothing else. The model default and
  // the per-message override stay where they were: the model parameters dialog, and the
  // keyboard cycle, which still reach every scope.
  const COMMIT_SCOPE: ThinkingScope = 'conversation';
  const [modelParams, setModelParams] = useState<Partial<ModelParameters>>({});
  const [pending, setPending] = useState<Partial<ModelParameters> | null>(null);
  const [migration, setMigration] = useState<ThinkingMigration>('none');
  // The same migration applied to the conversation's own bag, because a boolean can be
  // stored there too and the send honours it: an explanation the user never sees is not one.
  const sessionMigration = useMemo<ThinkingMigration>(
    () =>
      sessionParameters
        ? migrateLegacyThinkingBoolean({
            provider,
            modelId: modelId ?? '',
            params: sessionParameters,
          }).migration
        : 'none',
    [sessionParameters, provider, modelId],
  );

  const reload = useCallback(async () => {
    if (!modelId) return;
    const [raw, stored] = await Promise.all([
      ModelParametersService.getRawModelParameters(provider, modelId),
      ModelParametersService.getModelParameters(provider, modelId),
    ]);
    setModelParams(stored);
    setMigration(
      migrateLegacyThinkingBoolean({ provider, modelId, params: raw })
        .migration,
    );
    setPending(peekMessageScope(conversationId));
  }, [provider, modelId, conversationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const stop = subscribeMessageScope(conversationId, () =>
      setPending(peekMessageScope(conversationId)),
    );
    return stop;
  }, [conversationId]);

  const view = useMemo(
    () =>
      effectiveThinking({
        provider,
        modelId: modelId ?? '',
        modelParams,
        conversationParams: sessionParameters,
        messageParams: pending,
      }),
    [provider, modelId, modelParams, sessionParameters, pending],
  );

  /**
   * Write a choice where the chosen scope says to write it. A conversation choice goes to
   * the session store the session panel uses, then the page reloads its copy - this control
   * does not keep a second answer to the same question.
   */
  const commit = useCallback(
    async (target: ThinkingScope, level: ThinkingChoice) => {
      if (!modelId) return;
      const next = applyThinkingChoice({
        scope: target,
        level,
        modelParams,
        conversationParams: sessionParameters,
        messageParams: pending,
      });
      // A lasting choice retires a pending one-shot so the new value is the one that shows.
      if (next.clearedMessageOverride) clearMessageScope(conversationId);
      if (target === 'message') {
        setMessageScope(conversationId, next.messageParams);
      } else if (target === 'model') {
        await ModelParametersService.setModelParameters(
          provider,
          modelId,
          next.modelParams as ModelParameters,
        );
      } else {
        await ModelParametersService.setSessionParameters(
          conversationId,
          next.conversationParams as ModelParameters,
        );
        await onSessionParametersSaved?.();
      }
      await reload();
    },
    [
      modelId,
      modelParams,
      sessionParameters,
      pending,
      conversationId,
      provider,
      onSessionParametersSaved,
      reload,
    ],
  );

  useEffect(() => {
    if (disabled || view.options.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      // Alt+D, not Alt+T: the toast region already answers to Alt+T for screen-reader
      // users (sonner announces "Notifications alt+T"), and taking a key an assistive
      // technology already promises is not mine to take. Alt+D for depth.
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === 'd' || event.key === 'D') &&
        !isTextEntry(event.target)
      ) {
        event.preventDefault();
        // Cycle into whichever scope is answering, so a step changes what the user is
        // looking at instead of writing somewhere the readout will not show.
        const target: ThinkingScope =
          view.source === 'conversation' || view.source === 'message'
            ? view.source
            : 'model';
        void commit(
          target,
          cycleThinkingLevel({
            options: view.options,
            current: view.level,
            shift: event.shiftKey ? -1 : 1,
          }),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, commit, disabled]);

  if (!modelId) return null;

  /**
   * The tier names are the wire vocabulary (`reasoning_effort` takes `low`, `medium`,
   * `high`), so they are shown as-is. A translated 中 next to a server that says `medium`
   * is one more thing to translate in your head for no benefit.
   */
  const rawLevel = (level: ThinkingLevel) => level;
  const canSayOff = view.options.includes('off');
  const tiers = view.options.filter(
    (level) => level !== 'auto' && level !== 'off',
  );
  const migrationNote = (which: ThinkingMigration) =>
    which === 'off'
      ? t('thinkingSwitch.migration.off')
      : which === 'kept-on'
        ? t('thinkingSwitch.migration.kept-on')
        : which === 'kept-unsupported'
          ? t('thinkingSwitch.migration.kept-unsupported')
          : null;
  const hint = view.stale
    ? t('thinkingSwitch.staleHint')
    : !view.verified
      ? t('thinkingSwitch.unverifiedHint')
      : migrationNote(migration) || migrationNote(sessionMigration);
  // Whether this chat is the scope currently refusing to send a level.
  const suppressing = readThinkingChoice(sessionParameters) === 'suppress';
  const readout = rawLevel(view.level);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${t('thinkingSwitch.label')}: ${readout}`}
          title={`${t('thinkingSwitch.label')} · ${readout} — ${t('thinkingShortcut.help')}`}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors',
            'hover:bg-slate-100/60 dark:hover:bg-slate-800/40',
            view.level === 'auto'
              ? 'text-slate-500 dark:text-slate-400'
              : 'text-slate-700 dark:text-slate-200',
          )}
        >
          <Brain className="h-4 w-4" />
          <span className="max-w-[7rem] truncate">{readout}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" solid className="w-56 p-1.5 text-[12px]">
        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              type="button"
              onClick={() => {
                void commit(COMMIT_SCOPE, 'inherit');
                setOpen(false);
              }}
              className={cn(
                'w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800',
                view.level === 'auto' && !suppressing && 'font-medium',
              )}
            >
              auto
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                // `off` where the endpoint can say "do not think"; where it cannot, the
                // honest choice is to send no thinking level at all.
                void commit(COMMIT_SCOPE, canSayOff ? 'off' : 'suppress');
                setOpen(false);
              }}
              className={cn(
                'w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800',
                (view.level === 'off' || suppressing) && 'font-medium',
              )}
            >
              off
            </button>
          </li>
          {tiers.map((level) => (
            <li key={level}>
              <button
                type="button"
                onClick={() => {
                  void commit(COMMIT_SCOPE, level);
                  setOpen(false);
                }}
                className={cn(
                  'w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800',
                  level === view.level && 'font-medium',
                )}
              >
                {rawLevel(level)}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {hint && <div className="mt-0.5">{hint}</div>}
          {pending && (
            <div className="mt-0.5">
              {t('thinkingSwitch.pendingHint')} ·{' '}
              {String(pending.thinkingLevel ?? 'auto')}
            </div>
          )}
          <div className="mt-0.5">{t('thinkingShortcut.help')}</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

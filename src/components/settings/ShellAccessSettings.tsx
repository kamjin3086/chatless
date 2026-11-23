"use client";

import { useCallback, useEffect, useState } from "react";
import { TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

import { SettingsCard } from "./SettingsCard";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { useChatStore } from "@/store/chatStore";
import { useTranslation } from "@/i18n/useTranslation";
import {
  clearConversationAccess,
  getConversationAccess,
  getGlobalAccess,
  setGlobalAccess,
  type AccessLevel,
} from "@/lib/mcp/accessPolicy";
import { cn } from "@/lib/utils";

/**
 * Command execution trust.  The agent used to keep a low-risk command list and
 * a set of "trusted working directories"; both are gone, so this is the single
 * place that decides whether a command is run without asking.
 */
export function ShellAccessSettings() {
  const t = useTranslation();
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('ask');
  const conversationId = useChatStore((s) => s.currentConversationId);
  const [conversationOverride, setConversationOverride] = useState<AccessLevel | undefined>();

  useEffect(() => {
    void getGlobalAccess('shell').then(setAccessLevel);
  }, []);

  useEffect(() => {
    setConversationOverride(getConversationAccess('shell', conversationId || ''));
  }, [conversationId]);

  const onChange = useCallback(async (level: AccessLevel) => {
    setAccessLevel(level);
    try {
      await setGlobalAccess('shell', level);
    } catch (error) {
      console.error('[ShellAccessSettings] 保存命令策略失败:', error);
      setAccessLevel(await getGlobalAccess('shell'));
    }
  }, []);

  return (
    <SettingsCard>
      <SettingsSectionHeader icon={TerminalSquare} title={t('settings.security.shell.title')} />

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        {t('settings.security.shell.description')}
      </p>

      <div className="mt-3 rounded-lg border border-slate-200/60 dark:border-slate-700/40 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{t('settings.security.shell.askBeforeRun')}</div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {accessLevel === 'unrestricted'
                ? t('settings.security.shell.unrestrictedHint')
                : t('settings.security.shell.askHint')}
            </div>
          </div>
          <div className="shrink-0 flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
            {(['ask', 'unrestricted'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => void onChange(level)}
                className={cn(
                  'px-2.5 py-1 text-[11px] transition-colors',
                  accessLevel === level
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                {level === 'ask' ? t('settings.security.askEveryTime') : t('settings.security.neverAsk')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {conversationOverride === 'unrestricted' && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20 px-2.5 py-2">
          <span className="text-[11px] text-amber-700 dark:text-amber-300">
            {t('settings.security.shell.conversationOverrideNotice')}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              clearConversationAccess('shell', conversationId || '');
              setConversationOverride(undefined);
            }}
          >
            {t('settings.security.shell.restoreAsk')}
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}

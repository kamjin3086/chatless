"use client";

import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderInput, Radio, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ModelSelector } from './ModelSelector';
import { useAndroidChatNavigation } from './androidChatNavigation';
import { selectSelectableProviders } from '@/lib/provider/modelPickerVisibility';
import { hasAndroidAuthorizedFolders } from '@/lib/documents/android/androidAuthorizedRoots';
import { useTranslation } from '@/i18n/useTranslation';

export type ChatSetupState = 'initializing' | 'no_provider' | 'no_model' | 'ready';

interface ChatEmptyStateProps {
  setupState: ChatSetupState;
  modelPicker: ComponentProps<typeof ModelSelector>;
  /** Put text into the composer. Only wired where the composer can take it (Android). */
  onStarter?: (text: string) => void;
}

const modelSettings = '/settings?tab=localModels';

/**
 * The phone's opening screen. Three starters, all of which the tools on this device can
 * actually answer, and each one is the text it sends - the tap is an edit, not a dice roll.
 * The folder starter only appears once something is authorized, so it never promises a read
 * the user has not granted yet.
 */
function AndroidStarters({ onStarter }: { onStarter?: (text: string) => void }) {
  const t = useTranslation();
  const [authorized, setAuthorized] = useState(false);
  useEffect(() => {
    let alive = true;
    hasAndroidAuthorizedFolders()
      .then((value) => alive && setAuthorized(value))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const starters = [
    ...(authorized
      ? [{ icon: FolderInput, text: t('chatStarter.starterFolders') }]
      : []),
    { icon: Radio, text: t('chatStarter.starterTimer') },
    { icon: Search, text: t('chatStarter.starterSearch') },
  ];
  return (
    <div className="flex min-h-[9rem] flex-1 flex-col items-center justify-center gap-6 px-6 pb-1 text-center">
      <div className="space-y-1.5">
        <h2 className="text-[1.375rem] font-semibold leading-snug tracking-tight text-foreground">
          {t('chatStarter.title')}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('chatStarter.mobileHint')}</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {starters.map(({ icon: Icon, text: label }) => (
          <button
            key={label}
            type="button"
            onClick={() => onStarter?.(label)}
            className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/70 px-4 text-left text-sm text-foreground shadow-sm backdrop-blur-sm transition-colors active:bg-accent"
          >
            <Icon aria-hidden="true" className="size-4 shrink-0 text-primary/70" />
            <span className="truncate">{label}</span>
            <Sparkles aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-muted-foreground/60" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatEmptyState({ setupState, modelPicker, onStarter }: ChatEmptyStateProps) {
  const androidNavigation = useAndroidChatNavigation();
  const t = useTranslation();

  if (setupState === 'initializing') {
    return <p role="status" className="py-4 text-center text-sm text-muted-foreground">{t('chatStarter.initializing')}</p>;
  }

  if (setupState === 'ready') {
    // Desktop keeps the single line it has always shown; the phone gets a start panel, because
    // an empty transcript on a phone is a blank wall with a keyboard bolted to the bottom.
    return androidNavigation ? (
      <AndroidStarters onStarter={onStarter} />
    ) : (
      <h2 className="mb-4 px-4 text-center text-2xl font-semibold tracking-tight text-foreground">
        {t('chatStarter.title')}
      </h2>
    );
  }

  const noProvider = setupState === 'no_provider';
  const canPickModel = !noProvider && selectSelectableProviders(modelPicker.allMetadata).some(({ models }) => models?.length > 0);
  return (
    <div className="flex flex-col items-center gap-3 px-5 text-center">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {t(noProvider ? 'chatStarter.noProvider' : canPickModel ? 'chatStarter.noSelection' : 'chatStarter.noModels')}
      </h2>
      {canPickModel ? (
        <ModelSelector {...modelPicker} setupLabel={t('chatStarter.chooseModel')} />
      ) : androidNavigation ? (
        <Button onClick={() => androidNavigation.openModelSettings(noProvider)}>
          {t(noProvider ? 'chatStarter.addProvider' : 'chatStarter.manageModels')}
        </Button>
      ) : (
        <Button asChild size="sm">
          <Link href={noProvider ? `${modelSettings}&action=addProvider` : modelSettings}>
            {t(noProvider ? 'chatStarter.addProvider' : 'chatStarter.manageModels')}
          </Link>
        </Button>
      )}
    </div>
  );
}

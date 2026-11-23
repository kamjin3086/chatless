"use client";

import type { ComponentProps } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ModelSelector } from './ModelSelector';
import { selectSelectableProviders } from '@/lib/provider/modelPickerVisibility';
import { useTranslation } from '@/i18n/useTranslation';

export type ChatSetupState = 'initializing' | 'no_provider' | 'no_model' | 'ready';

interface ChatEmptyStateProps {
  setupState: ChatSetupState;
  modelPicker: ComponentProps<typeof ModelSelector>;
}

const modelSettings = '/settings?tab=localModels';

export function ChatEmptyState({ setupState, modelPicker }: ChatEmptyStateProps) {
  const t = useTranslation();

  if (setupState === 'initializing') {
    return <p role="status" className="py-4 text-center text-sm text-muted-foreground">{t('chatStarter.initializing')}</p>;
  }

  if (setupState === 'ready') {
    return (
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

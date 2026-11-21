'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Check, Search, Settings } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import type { ModelMetadata, ProviderMetadata } from '@/lib/metadata/types';
import { useLocaleStore } from '@/store/localeStore';
import { cn } from '@/lib/utils';
import { ProviderGlyph } from './ProviderGlyph';

interface AndroidModelPickerProps {
  trigger: ReactNode;
  models: ProviderMetadata[];
  recent: { provider: ProviderMetadata; model: ModelMetadata }[];
  selection: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: string) => void;
  onSettings: () => void;
}

export function AndroidModelPicker({
  trigger,
  models,
  recent,
  selection,
  query,
  onQueryChange,
  onOpenChange,
  onSelect,
  onSettings,
}: AndroidModelPickerProps) {
  const t = useLocaleStore((state) => state.t);
  useLocaleStore((state) => state.locale);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  function changeOpen(next: boolean) {
    setOpen(next);
    onOpenChange(next);
  }

  function renderModel(
    provider: ProviderMetadata,
    model: ModelMetadata,
    showProvider = false,
  ) {
    const value = `${provider.name}::${model.name}`;
    const selected = value === selection;
    return (
      <button
        type="button"
        key={value}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm active:bg-muted',
          selected && 'bg-muted',
        )}
        aria-pressed={selected}
        onClick={() => {
          onSelect(value);
          changeOpen(false);
        }}
      >
        {showProvider && <ProviderGlyph provider={provider} size={16} />}
        <span className="min-w-0 flex-1 break-words">
          <span className="block">{model.label || model.name}</span>
          {showProvider && (
            <span className="block text-xs text-muted-foreground">
              {provider.displayName || provider.name}
            </span>
          )}
        </span>
        {selected && <Check aria-hidden="true" className="size-4 shrink-0" />}
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        ref={panel}
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col gap-2 p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panel.current?.focus({ preventScroll: true });
        }}
      >
        <DialogTitle className="py-2 pr-12 text-base">
          {t('chatStarter.chooseModel')}
        </DialogTitle>
        <div className="flex shrink-0 items-center gap-1">
          <label className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <span className="sr-only">{t('androidChat.searchModels')}</span>
            <input
              type="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 w-full rounded-lg border border-input bg-background pr-2 pl-9 text-base"
              placeholder={t('androidChat.searchModels')}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
          <IconButton
            icon={Settings}
            title={t('chatStarter.manageModels')}
            className="size-11"
            onClick={() => {
              changeOpen(false);
              onSettings();
            }}
          />
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {!query && recent.length > 0 && (
            <div className="mb-2 border-b border-border pb-2">
              <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {t('androidChat.recentModels')}
              </h3>
              {recent.map(({ provider, model }) =>
                renderModel(provider, model, true),
              )}
            </div>
          )}
          <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {t('androidChat.availableModels')}
          </h3>
          {models.map((provider) => (
            <div key={provider.name} className="mb-2">
              <h4 className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                <ProviderGlyph provider={provider} size={16} />
                <span className="min-w-0 break-words">
                  {provider.displayName || provider.name}
                </span>
              </h4>
              {provider.models.map((model) => renderModel(provider, model))}
            </div>
          ))}
          {!models.length && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t('androidChat.noModels')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useId, useState } from 'react';
import { Shield, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { useConversationAccessStore } from '@/store/conversationAccessStore';
import { useTranslation } from '@/i18n/useTranslation';

const modes = [
  {
    value: 'default',
    name: 'toolApproval.defaultMode',
    details: 'toolApproval.defaultDetails',
  },
  {
    value: 'automatic',
    name: 'toolApproval.automaticMode',
    details: 'toolApproval.automaticDetails',
  },
] as const;
type Mode = (typeof modes)[number]['value'];

export function ConversationApprovalControl({
  conversationId,
}: { conversationId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Mode | null>(null);
  const t = useTranslation();
  const access = useConversationAccessStore(
    (state) => state.conversations[conversationId],
  );
  const automatic = access?.automatic ?? false;
  const hasGrants = Boolean(
    access &&
      (access.tools.length ||
        access.directories.length ||
        Object.keys(access.levels).length),
  );
  const currentMode: Mode = automatic ? 'automatic' : 'default';
  const selectedMode = draft ?? currentMode;
  const buttonLabel = automatic
    ? t('toolApproval.automaticMode')
    : hasGrants
      ? t('toolApproval.temporaryStatus')
      : t('toolApproval.title');
  const status = `${t('toolApproval.title')} · ${t(automatic ? 'toolApproval.automaticMode' : 'toolApproval.defaultMode')}${hasGrants ? ` · ${t('toolApproval.temporaryStatus')}` : ''}`;

  const changeOpen = (next: boolean) => {
    if (!next) setDraft(null);
    setOpen(next);
  };
  const applyMode = () => {
    if (selectedMode === currentMode) return;
    const store = useConversationAccessStore.getState();
    if (selectedMode === 'automatic') store.setAutomatic(conversationId, true);
    else store.revoke(conversationId);
    changeOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant={automatic ? 'soft' : 'ghost'}
          size="sm"
          aria-label={status}
          title={status}
          className={cn(
            'gap-1 px-2 text-xs',
            automatic
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-muted-foreground',
          )}
        >
          {automatic ? (
            <ShieldCheck aria-hidden="true" className="size-4" />
          ) : (
            <Shield aria-hidden="true" className="size-4" />
          )}
          <span className={automatic ? undefined : 'hidden sm:inline'}>
            {buttonLabel}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] gap-4 overflow-y-auto px-5 py-5 sm:max-w-lg md:w-[calc(100%-2rem)]">
        <DialogHeader className="text-left">
          <DialogTitle>
            <span id={`${id}-title`}>{t('toolApproval.title')}</span>
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t('toolApproval.scope')}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          aria-labelledby={`${id}-title`}
          value={selectedMode}
          onValueChange={(value) =>
            setDraft(value === 'automatic' ? 'automatic' : 'default')
          }
        >
          {modes.map(({ value, name, details }) => {
            const optionId = `${id}-${value}`;
            const clearsGrants = value === 'default' && automatic && hasGrants;
            return (
              <label
                key={value}
                htmlFor={optionId}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                  selectedMode === value
                    ? 'border-sky-700/50 bg-sky-500/10 dark:border-sky-400/50 dark:bg-sky-400/10'
                    : 'border-border hover:bg-muted/60',
                )}
              >
                <RadioGroupItem
                  value={value}
                  id={optionId}
                  className="mt-0.5 shrink-0"
                  aria-labelledby={`${optionId}-name`}
                  aria-describedby={`${optionId}-details`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      id={`${optionId}-name`}
                      className="text-sm font-medium text-foreground"
                    >
                      {t(name)}
                    </span>
                    {currentMode === value && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground">
                        {t('toolApproval.current')}
                      </span>
                    )}
                  </span>
                  <span
                    id={`${optionId}-details`}
                    className="mt-1 block text-sm leading-relaxed text-muted-foreground"
                  >
                    {t(details)}
                    {value === 'automatic' && (
                      <span className="mt-1 block">
                        {t('toolApproval.automaticLimits')}
                      </span>
                    )}
                    {clearsGrants && (
                      <span className="mt-1 block">
                        {t('toolApproval.clearOnSwitch')}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>

        {hasGrants && !automatic && (
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">
              {t('toolApproval.temporaryStatus')}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                useConversationAccessStore.getState().revoke(conversationId);
                changeOpen(false);
              }}
            >
              {t('toolApproval.revoke')}
            </Button>
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('toolApproval.resetNote')}
        </p>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => changeOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={applyMode} disabled={selectedMode === currentMode}>
            {t('toolApproval.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

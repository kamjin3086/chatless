import { CalendarDays, Check, Folder, SlidersHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n/useTranslation';
import { useUiPreferences } from '@/store/uiPreferences';

export function ConversationViewMenu({
  archiveVisible,
  onArchiveVisibleChange,
}: {
  archiveVisible: boolean;
  onArchiveVisibleChange: (visible: boolean) => void;
}) {
  const t = useTranslation();
  const grouping = useUiPreferences((state) => state.conversationGrouping);
  const setGrouping = useUiPreferences(
    (state) => state.setConversationGrouping,
  );
  const initialized = useUiPreferences((state) => state.initialized);
  const choices = [
    { value: 'time', label: t('chatSidebar.byTime'), icon: CalendarDays },
    { value: 'workspace', label: t('chatSidebar.byWorkspace'), icon: Folder },
  ] as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={!initialized}
          aria-label={t('chatSidebar.viewSettings')}
          title={t('chatSidebar.viewSettings')}
          className="grid size-8 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-500/10 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-600 disabled:opacity-50 data-[state=open]:bg-slate-500/10 dark:text-slate-300 dark:hover:text-slate-100 dark:focus-visible:outline-sky-400"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{t('chatSidebar.grouping')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={grouping}
          onValueChange={(value) => {
            if (value === 'time' || value === 'workspace') setGrouping(value);
          }}
        >
          {choices.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="min-h-8 gap-2 px-2.5 text-xs [&>span:first-child]:hidden"
            >
              <Icon
                aria-hidden="true"
                className="size-3.5 text-slate-600 dark:text-slate-300"
              />
              <span className="flex-1">{label}</span>
              <Check
                aria-hidden="true"
                className={`size-3.5 ${value === grouping ? 'opacity-100' : 'opacity-0'}`}
              />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={archiveVisible}
          onCheckedChange={onArchiveVisibleChange}
          className="text-xs"
        >
          {t('chatSidebar.archived')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

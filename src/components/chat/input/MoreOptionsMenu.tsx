"use client";

/**
 * 更多选项菜单 - 会话参数设置
 */

import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/useTranslation";

interface MoreOptionsMenuProps {
  disabled?: boolean;
  hasSessionParameters?: boolean;
  canEditSessionParameters?: boolean;
  onOpenSessionParameters?: () => void;
}

export function MoreOptionsMenu({
  disabled = false,
  hasSessionParameters,
  canEditSessionParameters,
  onOpenSessionParameters,
}: MoreOptionsMenuProps) {
  const t = useTranslation();

  if (!canEditSessionParameters) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={disabled}
      onClick={onOpenSessionParameters}
      className={cn(
        "h-8 w-8 shrink-0 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
        hasSessionParameters && "text-slate-700 dark:text-slate-200"
      )}
      title={t('chatUi.sessionParameters')}
    >
      <Settings className="w-4 h-4" />
    </Button>
  );
}


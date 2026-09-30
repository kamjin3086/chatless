import { AlertTriangle, X } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useEffect, useState } from 'react';
import StorageUtil from '@/lib/storage';

interface InfoBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  id?: string; // unique id for persist dismiss
  message: string;
  type?: 'warning' | 'info' | 'error';
}

export function InfoBanner({ id, message, type = 'warning', className, ...rest }: InfoBannerProps) {
  const storageKey = id ? `banner_dismiss_${id}` : undefined;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    (async () => {
      if (storageKey) {
        const dismissed = await StorageUtil.getItem<string>(storageKey, null, 'user-preferences.json');
        if (dismissed === '1') setHidden(true);
      }
    })();
  }, [storageKey]);

  const handleClose = () => {
    setHidden(true);
    if (storageKey) StorageUtil.setItem(storageKey, '1', 'user-preferences.json');
  };

  if (hidden) return null;

  const colors = {
    warning: "bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300/60 dark:border-yellow-700/60 text-yellow-800 dark:text-yellow-200",
    info: "bg-slate-100/70 dark:bg-white/8 border-slate-300/60 dark:border-white/12 text-slate-700 dark:text-slate-200",
    error: "bg-red-50 dark:bg-red-900/30 border-red-300/60 dark:border-red-700/60 text-red-800 dark:text-red-200",
  };

  return (
    <div {...rest} className={cn("p-3 rounded-md flex items-start justify-between", className)}>
      {/* <div className={cn("w-1 rounded-sm mr-3 self-stretch", type==='warning' ? 'bg-yellow-300/60' : type==='error' ? 'bg-red-300/60' : 'bg-blue-300/60')} /> */}
      <div className={cn("flex items-center gap-2 text-xs flex-1 border rounded-md px-3 py-2", colors[type])}>
        <AlertTriangle className="w-4 h-4 opacity-70 flex-shrink-0" />
        <span className="opacity-80 leading-snug">{message}</span>
      </div>
      <button onClick={handleClose} className="p-1 ml-2 text-xs opacity-60 hover:opacity-100">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
} 
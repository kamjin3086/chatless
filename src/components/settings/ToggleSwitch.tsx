import { useId } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';

interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tooltip?: string;
  className?: string;
}

/**
 * 紧凑的开关切换组件
 */
export function ToggleSwitch({
  label,
  description,
  checked,
  onChange,
  tooltip,
  className,
}: ToggleSwitchProps) {
  const id = useId();

  return (
    <div className={cn("flex items-center justify-between gap-4 py-1", className)}>
      <div className="flex items-center gap-1.5 min-w-0">
        <label htmlFor={id} className="text-xs text-slate-700 dark:text-slate-300">
          {label}
        </label>
        {description && (
          <span className="text-[10px] text-slate-400 hidden sm:inline">{description}</span>
        )}
        {tooltip && (
          <div className="group relative">
            <HelpCircle className="w-3 h-3 text-slate-400 hover:text-slate-600 cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 max-w-xs">
              {tooltip}
            </div>
          </div>
        )}
      </div>

      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

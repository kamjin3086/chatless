import { useId } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectFieldProps {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  description?: string;
  tooltip?: string;
  className?: string;
}

/**
 * 紧凑的下拉选择字段
 */
export function SelectField({
  label,
  options,
  value,
  onChange,
  tooltip,
  className,
}: SelectFieldProps) {
  const id = useId();
  
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="flex items-center gap-1.5 min-w-0">
        <label htmlFor={id} className="text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
          {label}
        </label>
        {tooltip && (
          <div className="group relative">
            <HelpCircle className="w-3 h-3 text-slate-400 hover:text-slate-600 cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 max-w-xs">
              {tooltip}
            </div>
          </div>
        )}
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 px-2 text-xs border border-slate-200/60 dark:border-slate-700/40 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600 min-w-[120px]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

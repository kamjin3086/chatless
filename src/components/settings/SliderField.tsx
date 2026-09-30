import { useId } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';

interface SliderFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  valueLabel?: string;
  tooltip?: string;
  className?: string;
}

export function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  valueLabel,
  tooltip,
  className,
}: SliderFieldProps) {
  const id = useId();

  return (
    <div className={cn("flex items-center justify-between gap-4 py-1", className)}>
      <div className="flex items-center gap-1.5 min-w-0">
        <label htmlFor={id} className="text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
          {label}
        </label>
        {tooltip && (
          <div className="group relative">
            <HelpCircle className="w-3 h-3 text-slate-400 hover:text-slate-600 cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 max-w-xs">
              {tooltip}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-[148px]">
        <Slider
          id={id}
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={(v) => onChange(v[0] ?? value)}
          className="flex-1"
        />
        <span className="w-9 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
          {valueLabel ?? `${Math.round(value)}`}
        </span>
      </div>
    </div>
  );
}

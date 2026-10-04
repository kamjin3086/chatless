"use client";

import { useId } from 'react';
import { ShortcutCapture } from './ShortcutCapture';
import { HelpCircle } from 'lucide-react';

interface ShortcutFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  tooltip?: string;
}

export function ShortcutField({
  label,
  value,
  onChange,
  description,
  tooltip,
}: ShortcutFieldProps) {
  const id = useId();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
        {tooltip && (
          <div className="group relative">
            <HelpCircle className="w-4 h-4 text-slate-400 hover:text-slate-600 cursor-help transition-colors" />
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
              {tooltip}
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-900"></div>
            </div>
          </div>
        )}
      </div>
      <ShortcutCapture value={value} onChange={onChange} />
    </div>
  );
} 
'use client';

import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronDown, LineChart } from "lucide-react";

export function AnalyticsHeader() {
  // TODO: Add state and logic for date range selection
  return (
    <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-800 dark:to-slate-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white flex items-center justify-center shadow-md">
            <LineChart className="w-5 h-5" />
          </div>
          <span className="font-semibold text-lg text-slate-800 dark:text-slate-200">使用统计</span>
        </div>
        <div className="relative">
          {/* Placeholder for Date Range Picker - Use shadcn Date Picker later */}
          <Button 
            variant="outline"
            className="date-selector flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors duration-200 h-9"
          >
            <CalendarDays className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <span>最近30天</span>
            <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500 ml-1 opacity-50" />
          </Button>
        </div>
      </div>
    </div>
  );
} 
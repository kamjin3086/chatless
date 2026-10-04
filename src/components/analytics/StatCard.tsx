'use client';

import { Button } from "@/components/ui/button";
import { LucideIcon, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  icon: LucideIcon;
  iconColorClass?: string; // e.g., "text-primary", "text-secondary"
}

export function StatCard({ title, icon: Icon, iconColorClass = "text-primary" }: StatCardProps) {
  return (
    <div className="chart-card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden transition-shadow duration-300 hover:shadow-md">
      <div className="p-3 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 dark:from-slate-800/30 dark:to-slate-900/30 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", iconColorClass)} />
          <h3 className="font-medium text-slate-700 dark:text-slate-300 text-sm">{title}</h3>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="action-btn text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-1 h-6 w-6 transition-colors duration-200 focus:outline-none focus:ring-0 focus:ring-offset-0"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>
      <div className="p-4">
        {/* Placeholder for actual chart */}
        <div className="chart-placeholder bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-700/50 dark:to-slate-800/50 border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center h-[220px] rounded-lg text-slate-500 dark:text-slate-400 text-sm transition-all duration-300 hover:border-slate-300 dark:hover:border-slate-600">
          {title} 图表区域
        </div>
      </div>
    </div>
  );
} 
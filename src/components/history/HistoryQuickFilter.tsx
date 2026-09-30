'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Star, Clock, Calendar, CalendarDays, CalendarRange } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useHistoryStore } from '@/store/historyStore';

type FilterType = 'all' | 'today' | 'week' | 'month' | 'favorite';

interface HistoryQuickFilterProps {
  onFilterChange?: (filter: FilterType) => void;
}

export default function HistoryQuickFilter({ onFilterChange = () => {} }: HistoryQuickFilterProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const { setFilter, currentFilter } = useHistoryStore();

  const handleFilterClick = (filter: FilterType) => {
    setActiveFilter(filter);
    onFilterChange(filter);
    
    // 根据筛选类型设置存储状态
    switch (filter) {
      case 'all':
        setFilter({ dateRange: 'all', isFavorite: undefined });
        break;
      case 'today':
        setFilter({ dateRange: 'today', isFavorite: undefined });
        break;
      case 'week':
        setFilter({ dateRange: 'week', isFavorite: undefined });
        break;
      case 'month':
        setFilter({ dateRange: 'month', isFavorite: undefined });
        break;
      case 'favorite':
        setFilter({ dateRange: 'all', isFavorite: true });
        break;
    }
  };

  const getButtonClasses = (filter: FilterType) => {
    const baseClasses = "px-3 py-1.5 rounded-full text-xs transition-all duration-200 flex items-center gap-1.5 h-8 whitespace-nowrap border font-medium";
    if (activeFilter === filter) {
      return cn(baseClasses, "glass-chip-active bg-slate-200/50 text-slate-800 border-slate-300/50 dark:bg-white/10 dark:text-slate-200 dark:border-white/15");
    }
    return cn(baseClasses, "text-slate-600 border-slate-200/70 hover:bg-slate-100/60 dark:text-slate-300 dark:border-slate-600/50 dark:hover:bg-white/8");
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
        {/* 时间筛选组 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap mr-1">时间范围:</span>
          <Button 
            onClick={() => handleFilterClick('all')} 
            className={getButtonClasses('all')} 
            variant="ghost"
          >
            <Clock className="w-3.5 h-3.5" />
            全部时间
          </Button>
          <Button 
            onClick={() => handleFilterClick('today')} 
            className={getButtonClasses('today')} 
            variant="ghost"
          >
            <Calendar className="w-3.5 h-3.5" />
            今天
          </Button>
          <Button 
            onClick={() => handleFilterClick('week')} 
            className={getButtonClasses('week')} 
            variant="ghost"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            本周
          </Button>
          <Button 
            onClick={() => handleFilterClick('month')} 
            className={getButtonClasses('month')} 
            variant="ghost"
          >
            <CalendarRange className="w-3.5 h-3.5" />
            本月
          </Button>
        </div>
        
        {/* 分隔线 */}
        <div className="border-r border-gray-300 dark:border-gray-600 h-6 mx-1 self-center"></div>
        
        {/* 状态筛选组 */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap mr-1">特殊标记:</span>
          <Button 
            onClick={() => handleFilterClick('favorite')} 
            className={getButtonClasses('favorite')} 
            variant="ghost"
          >
            <Star className={cn("h-3.5 w-3.5", activeFilter === 'favorite' ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400")}/>
            收藏
          </Button>
        </div>
      </div>
    </div>
  );
} 

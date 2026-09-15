"use client";

import { useState } from 'react';
import type React from 'react';
import { Button } from "@/components/ui/button";
import { 
  LayoutGrid, Star, Briefcase, Code, Pencil, GraduationCap, Lightbulb, Plus, BarChart, Languages 
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  iconColor?: string; // Optional color class
  count?: number;
}

const categories: Category[] = [
  { id: 'all', name: '全部提示词', icon: LayoutGrid, count: 32 }, // Placeholder count
  { id: 'favorite', name: '常用提示词', icon: Star, iconColor: 'text-yellow-400', count: 8 },
  { id: 'work', name: '工作效率', icon: Briefcase, iconColor: 'text-blue-500', count: 8 },
  { id: 'code', name: '编程开发', icon: Code, iconColor: 'text-purple-500', count: 6 },
  { id: 'write', name: '写作创作', icon: Pencil, iconColor: 'text-green-500', count: 5 },
  { id: 'learn', name: '学习教育', icon: GraduationCap, iconColor: 'text-red-500', count: 4 },
  { id: 'creative', name: '创意思考', icon: Lightbulb, iconColor: 'text-yellow-500', count: 3 },
];

const recommended: Category[] = [
    { id: 'rec-data', name: '数据分析', icon: BarChart, iconColor: 'text-blue-500' },
    { id: 'rec-translate', name: '语言翻译', icon: Languages, iconColor: 'text-green-500' },
];

interface CategorySidebarProps {
  onSelectCategory?: (categoryId: string) => void;
}

export function CategorySidebar({ onSelectCategory = () => {} }: CategorySidebarProps) {
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const handleSelect = (id: string) => {
    setActiveCategory(id);
    onSelectCategory(id);
  };

  return (
    <div className="w-56 border-r border-gray-200 dark:border-gray-700 overflow-y-auto custom-scrollbar bg-white dark:bg-gray-800 flex flex-col h-full glass-surface">
      {/* Header */}
      <div className="p-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <h3 className="font-medium text-gray-700 dark:text-gray-300 text-sm">分类</h3>
        <Button variant="ghost" size="icon" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 h-6 w-6">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Categories List */}
      <div className="flex-grow overflow-y-auto custom-scrollbar py-1">
        <div className="space-y-0.5">
          {categories.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <div 
                key={cat.id} 
                className={cn(
                  "category-item flex items-center justify-between px-3 py-2 cursor-pointer transition-colors duration-200",
                  isActive ? "bg-indigo-50 dark:bg-indigo-900/50 text-primary dark:text-indigo-300 font-medium" : "hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
                )}
                onClick={() => handleSelect(cat.id)}
              >
                <div className="flex items-center gap-2">
                  <cat.icon className={cn("w-5 h-5 flex-shrink-0", cat.iconColor ? cat.iconColor : (isActive ? "text-primary dark:text-indigo-300" : "text-gray-500 dark:text-gray-400"))} />
                  <span className="text-sm truncate">{cat.name}</span>
                </div>
                {cat.count !== undefined && (
                  <span className={cn("text-xs px-1.5 py-0.5 rounded-lg flex-shrink-0", isActive ? "bg-primary/20 text-primary dark:bg-indigo-500/30 dark:text-indigo-200" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400")}>
                    {cat.count}
                  </span>
                )}
                {/* Add edit button on hover if needed */}
              </div>
            );
          })}
        </div>

        {/* Recommended Section */}
        <div className="mt-4 px-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-gray-700 dark:text-gray-400 uppercase tracking-wider">智能推荐</h3>
            {/* <i className="fas fa-magic text-purple-500"></i> */}
          </div>
          <div className="space-y-1">
            {recommended.map((rec) => (
              <div 
                key={rec.id}
                className="category-item flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-600 dark:text-gray-400 cursor-pointer transition-colors duration-200"
                onClick={() => handleSelect(rec.id)} // Or handle differently
              >
                <rec.icon className={cn("w-4 h-4 flex-shrink-0", rec.iconColor)} />
                <span>{rec.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Footer - Sync Status */}
      <div className="flex-shrink-0 p-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 border-t border-gray-200 dark:border-gray-700 mt-auto">
        {/* <i className="fas fa-cloud-upload-alt"></i> */}
        <span>同步状态待实现</span>
      </div>
    </div>
  );
} 
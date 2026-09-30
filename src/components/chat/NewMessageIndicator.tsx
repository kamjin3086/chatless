"use client";

import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NewMessageIndicatorProps {
  show: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * 新消息指示器
 * 当用户在查看历史消息时，如果有新消息到达，显示此提示
 */
export function NewMessageIndicator({ show, onClick, className }: NewMessageIndicatorProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ 
            type: "spring", 
            stiffness: 400, 
            damping: 25 
          }}
          onClick={onClick}
          className={cn(
            // 锚定在聊天面板内，而不是整个窗口，避免浮到侧边栏/其他区域上方。
            "absolute left-1/2 -translate-x-1/2 bottom-28 z-50",
            "flex items-center gap-2 px-4 py-2",
            "bg-blue-500 dark:bg-blue-600",
            "text-white text-sm font-medium",
            "rounded-full shadow-lg",
            "transition-all duration-200",
            "hover:bg-blue-600 dark:hover:bg-blue-700",
            "hover:shadow-xl hover:scale-105",
            "active:scale-95",
            "cursor-pointer select-none",
            className
          )}
          aria-label="查看新消息"
        >
          <span>新消息</span>
          <ChevronDown className="w-4 h-4 animate-bounce" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}


"use client";

import { ArrowDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ScrollToBottomButtonProps {
  show: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * 回到底部按钮
 * 当用户向上滚动查看历史消息时显示，点击可快速回到底部并恢复自动滚动
 */
export function ScrollToBottomButton({ show, onClick, className }: ScrollToBottomButtonProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          initial={{ opacity: 0, y: 20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.8 }}
          transition={{ 
            type: "spring", 
            stiffness: 500, 
            damping: 30,
            duration: 0.2 
          }}
          onClick={onClick}
          className={cn(
            // 位置交给外层的导航条容器（锚定在聊天面板内），组件本身不再 fixed 到窗口。
            "flex items-center justify-center",
            "w-12 h-12 rounded-full",
            "bg-white dark:bg-gray-800",
            "border-2 border-gray-200 dark:border-gray-700",
            "shadow-lg hover:shadow-xl",
            "transition-all duration-200",
            "hover:scale-110 active:scale-95",
            "group",
            className
          )}
          aria-label="回到底部"
          title="回到底部并恢复自动滚动"
        >
          <ArrowDown 
            className={cn(
              "w-5 h-5",
              "text-gray-600 dark:text-gray-300",
              "group-hover:text-blue-600 dark:group-hover:text-blue-400",
              "transition-colors duration-200"
            )}
          />
          
          {/* 脉冲动画提示 */}
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-blue-400 dark:border-blue-500"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.3, opacity: 0 }}
            transition={{ 
              repeat: Number.POSITIVE_INFINITY, 
              duration: 1.5,
              ease: "easeOut"
            }}
          />
        </motion.button>
      )}
    </AnimatePresence>
  );
}


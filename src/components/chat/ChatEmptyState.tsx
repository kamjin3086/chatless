"use client";

import { Bot, Mail, BrainCircuit, HeartPulse, FileCode, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

interface ChatEmptyStateProps {
  onPromptClick: (prompt: string) => void;
}

const examplePrompts = [
  {
    icon: <Mail className="w-4 h-4" />,
    text: "帮我写一封关于产品发布的邮件",
    color: "text-sky-500",
    hoverBg: "hover:bg-sky-50 dark:hover:bg-sky-950/30",
  },
  {
    icon: <BrainCircuit className="w-4 h-4" />,
    text: "用简单的语言解释什么是黑洞",
    color: "text-violet-500",
    hoverBg: "hover:bg-violet-50 dark:hover:bg-violet-950/30",
  },
  {
    icon: <HeartPulse className="w-4 h-4" />,
    text: "给我一些关于健康饮食的建议",
    color: "text-rose-500",
    hoverBg: "hover:bg-rose-50 dark:hover:bg-rose-950/30",
  },
  {
    icon: <FileCode className="w-4 h-4" />,
    text: "写一个Python脚本来重命名文件",
    color: "text-amber-500",
    hoverBg: "hover:bg-amber-50 dark:hover:bg-amber-950/30",
  },
];

export function ChatEmptyState({ onPromptClick }: ChatEmptyStateProps) {
  return (
    <div className="pt-16 sm:pt-24 max-w-xl mx-auto text-center space-y-6 px-4">
      {/* 机器人图标 - 带有微妙的渐变光晕 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="flex justify-center"
      >
        <div className="relative">
          {/* 光晕效果 */}
          <div className="absolute inset-0 blur-2xl opacity-20 bg-gradient-to-br from-blue-400 via-violet-400 to-purple-400 rounded-full scale-150" />
          <Bot 
            className="relative w-12 h-12 sm:w-14 sm:h-14 text-slate-400 dark:text-slate-500" 
            strokeWidth={1.2} 
          />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.08 }}
        className="space-y-2"
      >
        <h2 className="text-xl sm:text-2xl font-medium text-slate-700 dark:text-slate-200">
          今天有什么可以帮您？
        </h2>
        <p className="text-sm text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>您可以提出任何问题，我会尽力回答</span>
        </p>
      </motion.div>
      
      {/* 示例提示 - 带有彩色图标和轻盈的交互效果 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-8">
        {examplePrompts.map((prompt, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.16 + index * 0.04 }}
            onClick={() => onPromptClick(prompt.text)}
            className={`
              flex items-center gap-3 px-4 py-3.5 rounded-xl text-left
              border border-transparent
              hover:border-slate-200/50 dark:hover:border-slate-700/50
              ${prompt.hoverBg}
              transition-all duration-200 group
            `}
          >
            <span className={`shrink-0 ${prompt.color} opacity-70 group-hover:opacity-100 transition-opacity`}>
              {prompt.icon}
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">
              {prompt.text}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { Bot, Mail, BrainCircuit, HeartPulse, FileCode, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type ChatSetupState = "initializing" | "no_provider" | "no_model" | "ready";

interface ChatEmptyStateProps {
  onPromptClick: (prompt: string) => void;
  setupState?: ChatSetupState;
}

const examplePrompts = [
  { icon: Mail, text: "帮我写一封关于产品发布的邮件", iconClass: "text-sky-500 dark:text-sky-400" },
  { icon: BrainCircuit, text: "用简单的语言解释什么是黑洞", iconClass: "text-blue-500 dark:text-blue-400" },
  { icon: HeartPulse, text: "给我一些关于健康饮食的建议", iconClass: "text-emerald-500 dark:text-emerald-400" },
  { icon: FileCode, text: "写一个Python脚本来重命名文件", iconClass: "text-indigo-500 dark:text-indigo-400" },
];

function subtitleFor(setupState: ChatSetupState): string {
  if (setupState === "no_provider") return "请先在设置中添加一个模型服务";
  if (setupState === "no_model") return "请先在顶部选择一个模型";
  return "您可以提出任何问题，我会尽力回答";
}

export function ChatEmptyState({ onPromptClick, setupState = "ready" }: ChatEmptyStateProps) {
  if (setupState === "initializing") {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-16">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>正在初始化模型服务…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center text-center space-y-4 px-4 py-8 w-full max-w-xl mx-auto min-h-0">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="flex justify-center"
      >
        <div className="relative">
          <div className="absolute inset-0 blur-2xl rounded-full scale-150 glass-empty-glow" />
          <Bot
            className="relative w-10 h-10 sm:w-11 sm:h-11 text-sky-500/70 dark:text-sky-400/80"
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
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {subtitleFor(setupState)}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
        {examplePrompts.map((prompt, index) => {
          const Icon = prompt.icon;
          return (
            <motion.button
              key={index}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: 0.16 + index * 0.04 }}
              onClick={() => onPromptClick(prompt.text)}
              className="flex items-center gap-2 py-1.5 px-0.5 text-left bg-transparent hover:bg-transparent rounded-none border-0 shadow-none appearance-none cursor-pointer group"
            >
              <Icon className={cn("w-3.5 h-3.5 shrink-0 transition-colors", prompt.iconClass)} />
              <span className="text-sm text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">
                {prompt.text}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

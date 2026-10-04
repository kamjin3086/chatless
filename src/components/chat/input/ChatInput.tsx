"use client";

import { useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImageIcon, PaperclipIcon, Database, Send } from "lucide-react";

interface ChatInputProps {
  onSubmit: (content: string) => void;
  onSelectKnowledge?: () => void;
  disabled?: boolean;
}

export function ChatInput({
  onSubmit,
  onSelectKnowledge,
  disabled = false,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showTip, setShowTip] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    setShowTip(true);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(input.trim());
    setInput("");
  };

  const canSubmit = input.trim().length > 0 && !disabled;

  return (
    <div className="relative flex flex-col w-full max-w-full px-4 py-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
      <div className="relative flex w-full">
        <TextareaAutosize
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          className={cn(
            "w-full resize-none bg-transparent py-3 pl-12 pr-14",
            "text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400",
            "border-0 border-b border-slate-200 dark:border-slate-700",
            "focus:outline-none focus:border-slate-400/60 dark:focus:border-slate-500/60",
            "transition-all duration-200"
          )}
          maxRows={12}
          disabled={disabled}
        />

        {/* 左侧按钮组 */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-9 w-9 rounded-xl cursor-pointer",
              "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
              "hover:bg-slate-100 dark:hover:bg-slate-800",
              "transition-all duration-200"
            )}
            onClick={() => {/* 图片上传逻辑 */}}
            disabled={disabled}
          >
            <ImageIcon className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-9 w-9 rounded-xl cursor-pointer",
              "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
              "hover:bg-slate-100 dark:hover:bg-slate-800",
              "transition-all duration-200"
            )}
            onClick={() => {/* 文件上传逻辑 */}}
            disabled={disabled}
          >
            <PaperclipIcon className="w-5 h-5" />
          </Button>
        </div>

        {/* 右侧按钮组 */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {/* 知识库选择按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 px-3 rounded-full cursor-pointer",
              "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700",
              "text-sm font-medium",
              "transition-all duration-200"
            )}
            onClick={onSelectKnowledge}
            disabled={disabled}
          >
            <Database className="w-4 h-4 mr-1" />
            选择知识库
          </Button>

          {/* 发送按钮 */}
          <Button
            variant="default"
            size="icon"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className={cn(
              "h-9 w-9 rounded-full cursor-pointer",
              "bg-gradient-to-br from-blue-500 to-blue-600",
              "hover:from-blue-600 hover:to-blue-700",
              "disabled:from-slate-300 disabled:to-slate-400",
              "transition-all duration-200",
              "shadow-sm"
            )}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 底部提示 */}
      {showTip && (
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          提示：按下 Enter 发送消息，Shift + Enter 换行
        </div>
      )}
    </div>
  );
} 
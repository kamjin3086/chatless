"use client";

/**
 * 聊天模式选择器
 * 
 * 提供 Chat / Agent 模式切换，带有颜色区分
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquare, Bot, ChevronDown, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ActionPanel,
  ActionPanelTrigger,
  ActionPanelContent,
  ActionPanelList,
  ActionPanelItem,
} from "@/components/ui/action-panel";

export type ChatMode = "chat" | "agent";

interface ModeConfig {
  id: ChatMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const MODES: ModeConfig[] = [
  {
    id: "chat",
    label: "Chat",
    description: "普通对话模式",
    icon: <MessageSquare className="w-4 h-4" />,
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "hover:bg-slate-100 dark:hover:bg-slate-800",
  },
  {
    id: "agent",
    label: "Agent",
    description: "智能体模式，可调用工具",
    icon: <Bot className="w-4 h-4" />,
    color: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-900/50",
  },
];

interface ChatModeSelectorProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
}

export function ChatModeSelector({
  mode,
  onModeChange,
  disabled = false,
}: ChatModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const currentMode = MODES.find((m) => m.id === mode) || MODES[0];

  const handleSelect = (selectedMode: ChatMode) => {
    onModeChange(selectedMode);
    setOpen(false);
  };

  return (
    <ActionPanel open={open} onOpenChange={setOpen}>
      <ActionPanelTrigger>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-7 px-2.5 gap-1.5 rounded-lg text-xs font-medium transition-all duration-150",
            mode === "agent"
              ? "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          )}
        >
          {currentMode.icon}
          <span>{currentMode.label}</span>
          {mode === "agent" && <Sparkles className="w-3 h-3 opacity-60" />}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </ActionPanelTrigger>

      <ActionPanelContent width="sm" maxHeight="12rem">
        <ActionPanelList>
          {MODES.map((m) => (
            <ActionPanelItem
              key={m.id}
              icon={<span className={m.color}>{m.icon}</span>}
              title={<span className={mode === m.id ? m.color : ""}>{m.label}</span>}
              description={m.description}
              selected={mode === m.id}
              suffix={mode === m.id ? <Check className={cn("w-4 h-4", m.color)} /> : null}
              onClick={() => handleSelect(m.id)}
            />
          ))}
        </ActionPanelList>
      </ActionPanelContent>
    </ActionPanel>
  );
}

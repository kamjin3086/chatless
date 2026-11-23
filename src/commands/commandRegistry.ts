import type { LucideIcon } from 'lucide-react';

export interface Command {
  id: string;
  titleI18n: string; // i18n key
  section: string;   // e.g. navigation / settings / action
  hintI18n?: string; // optional right side hint description (i18n key)
  keywords?: string[];
  icon?: LucideIcon;
  action: () => void | Promise<void>;
}

const registry: Command[] = [];

export function registerCommand(cmd: Command) {
  // 避免重复
  if (!registry.find((c) => c.id === cmd.id)) {
    registry.push(cmd);
  }
}

export function getCommands() {
  return registry;
} 
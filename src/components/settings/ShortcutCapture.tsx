"use client";
import { useState } from "react";

const BLACKLIST = [
  'mod+c', 'mod+v', 'mod+x', 'mod+s', 'mod+z', 'mod+shift+z',
  'mod+a', 'mod+tab', 'mod+w', 'mod+q', 'mod+r', 'mod+f',
  'ctrl+alt+delete', 'ctrl+shift+escape', 'alt+f4', 'alt+tab'
];

// 验证快捷键是否有效
const validateShortcut = (combo: string): { valid: boolean; error?: string } => {
  const parts = combo.toLowerCase().split('+');
  
  // 检查基本格式
  if (parts.length < 2) {
    return { valid: false, error: '快捷键需包含至少一个修饰键和一个按键' };
  }

  // 检查是否包含修饰键
  const hasModifier = parts.some(part => 
    ['mod', 'ctrl', 'alt', 'shift'].includes(part)
  );
  if (!hasModifier) {
    return { valid: false, error: '快捷键必须包含至少一个修饰键 (Ctrl/⌘/Alt/Shift)' };
  }

  // 检查是否包含有效按键
  const lastPart = parts[parts.length - 1];
  if (!lastPart || lastPart.length === 0) {
    return { valid: false, error: '快捷键必须包含有效的按键' };
  }

  // 检查黑名单
  if (BLACKLIST.includes(combo)) {
    return { valid: false, error: '该组合与系统/常用快捷键冲突' };
  }

  return { valid: true };
};

interface ShortcutCaptureProps {
  value: string;
  onChange: (val: string) => void;
}

export function ShortcutCapture({ value, onChange }: ShortcutCaptureProps) {
  const [error, setError] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    const isMac = navigator.platform.includes('Mac');
    
    // 处理修饰键，确保与CommandPalette的匹配逻辑一致
    if (e.metaKey || (!isMac && e.ctrlKey)) {
      parts.push('mod');
    } else if (e.ctrlKey) {
      parts.push('ctrl');
    }

    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');

    const key = e.key.toLowerCase();
    const ignore = ['control', 'meta', 'shift', 'alt', 'tab', 'escape'];
    if (!ignore.includes(key)) parts.push(key);

    const combo = parts.join('+');
    
    // 使用新的验证逻辑
    const validation = validateShortcut(combo);
    if (!validation.valid) {
      setError(validation.error || '快捷键格式无效');
      return;
    }

    setError(null);
    onChange(combo);
  };

  const formatDisplay = (combo: string) => {
    if (!combo) return '';
    return combo.split('+').map(p => {
      switch (p) {
        case 'mod': return '⌘';
        case 'ctrl': return '⌃';
        case 'shift': return '⇧';
        case 'alt': return '⌥';
        default: return p.toUpperCase();
      }
    }).join(' + ');
  };

  return (
    <div>
      <input
        readOnly
        value={formatDisplay(value)}
        onKeyDown={handleKeyDown}
        placeholder="按下组合键..."
        className="w-full px-3 py-2.5 border border-slate-100 rounded-lg focus:ring-1 focus:ring-blue-500/30 focus:border-blue-200 transition-all duration-150 bg-white dark:bg-slate-800/30 dark:border-slate-700/30 hover:border-slate-200 dark:hover:border-slate-600/50 cursor-pointer text-center font-mono tracking-wide text-sm"
      />
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
} 
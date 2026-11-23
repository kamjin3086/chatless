"use client";
import { useState } from "react";
import { translate } from '@/i18n';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';

const BLACKLIST = [
  'mod+c', 'mod+v', 'mod+x', 'mod+s', 'mod+z', 'mod+shift+z',
  'mod+a', 'mod+tab', 'mod+w', 'mod+q', 'mod+r', 'mod+f',
  'ctrl+alt+delete', 'ctrl+shift+escape', 'alt+f4', 'alt+tab'
];

const getShortcutError = (combo: string): TranslationKey | null => {
  const parts = combo.toLowerCase().split('+');
  
  // 检查基本格式
  if (parts.length < 2) {
    return 'settings.shortcut.error.incomplete';
  }

  // 检查是否包含修饰键
  const hasModifier = parts.some(part => 
    ['mod', 'ctrl', 'alt', 'shift'].includes(part)
  );
  if (!hasModifier) {
    return 'settings.shortcut.error.modifier';
  }

  // 检查是否包含有效按键
  const lastPart = parts[parts.length - 1];
  if (!lastPart || lastPart.length === 0) {
    return 'settings.shortcut.error.key';
  }

  // 检查黑名单
  if (BLACKLIST.includes(combo)) {
    return 'settings.shortcut.error.conflict';
  }

  return null;
};

interface ShortcutCaptureProps {
  value: string;
  onChange: (val: string) => void;
}

export function ShortcutCapture({ value, onChange }: ShortcutCaptureProps) {
  const locale = useLocaleStore((state) => state.locale);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

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
    
    const nextErrorKey = getShortcutError(combo);
    setErrorKey(nextErrorKey);
    if (nextErrorKey) return;
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
        placeholder={translate(locale, 'settings.shortcut.placeholder')}
        className="w-full px-3 py-2.5 border border-slate-100 rounded-lg focus:ring-1 focus:ring-blue-500/30 focus:border-blue-200 transition-all duration-150 bg-white dark:bg-slate-800/30 dark:border-slate-700/30 hover:border-slate-200 dark:hover:border-slate-600/50 cursor-pointer text-center font-mono tracking-wide text-sm"
      />
      {errorKey && <p className="text-sm text-red-500 mt-1">{translate(locale, errorKey)}</p>}
    </div>
  );
} 
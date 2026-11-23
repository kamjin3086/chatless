"use client";

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { translate } from '@/i18n';
import type { Locale } from '@/i18n/types';

// Tauri Menu API imports
interface MenuOptions {
  items: MenuItem[];
}

interface MenuItem {
  id: string;
  text: string;
  action?: () => void;
  enabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  children: React.ReactNode;
  menuItems: MenuItem[];
  disabled?: boolean;
}

export function ContextMenu({ children, menuItems, disabled = false }: ContextMenuProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsVisible(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsVisible(false);
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isVisible]);

  const handleContextMenu = async (event: React.MouseEvent) => {
    if (disabled) return;
    
    event.preventDefault();
    event.stopPropagation();

    // Read the cursor before any await: the synthetic event is pooled, and the
    // native menu is built asynchronously.
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // Try the Tauri Menu API (if available)
    try {
      await popupNativeMenu(menuItems, mouseX, mouseY);
      return;
    } catch (error) {
      // Tauri Menu API not available in a plain browser tab
      console.warn('Tauri Menu API not available, using browser fallback:', error);
    }

    // Browser fallback menu - uses the cursor position captured above
    setPosition({ x: mouseX, y: mouseY });
    setIsVisible(true);
  };

  const handleMenuItemClick = (item: MenuItem) => {
    setIsVisible(false);
    if (item.action) {
      item.action();
    }
  };

  return (
    <>
      <div onContextMenu={handleContextMenu} className="h-full w-full">
        {children}
      </div>
      
      {/* Browser fallback context menu */}
      {isVisible && (
        <div
          ref={menuRef}
          className={cn(
            "context-menu glass-overlay fixed z-50 min-w-48 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700",
            "bg-white dark:bg-slate-800 shadow-xl ring-1 ring-black/5 dark:ring-white/5",
            "py-2 text-sm text-slate-700 dark:text-slate-200",
            "animate-in fade-in-0 zoom-in-95 duration-100"
          )}
          style={{
            left: position.x,
            top: position.y,
          }}
        >
          {menuItems.map((item, index) => (
            item.separator ? (
              <div key={`separator-${index}`} className="h-px bg-slate-200 dark:bg-slate-600 my-1.5 mx-3" />
            ) : (
              <div
                key={item.id}
                className={cn(
                  "relative flex cursor-pointer select-none items-center gap-3 rounded-md px-4 py-2.5 mx-1.5 outline-none transition-all duration-150",
                  item.id === 'delete' 
                    ? "hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 active:bg-red-100 dark:active:bg-red-900/30"
                    : "hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 active:bg-slate-200 dark:active:bg-slate-600",
                  item.enabled === false && "opacity-50 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent"
                )}
                onClick={() => item.enabled !== false && handleMenuItemClick(item)}
              >
                {item.text}
              </div>
            )
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Pop the native context menu at the cursor.
 *
 * The position is not optional. `popup()` without it reaches muda's no-position
 * branch, which anchors on the display's *root* window instead of ours
 * (`muda-0.17.1/src/platform_impl/gtk/mod.rs:1385`), so under Wayland the menu
 * opens at a spot of the compositor's choosing - in practice the middle of the
 * screen - instead of under the pointer.
 *
 * Viewport coordinates are also window coordinates here: the window is
 * `decorations: false` and the webview fills it. Logical (CSS px), because muda
 * converts to logical itself and flips the y-axis for macOS.
 */
export async function popupNativeMenu(
  menuItems: MenuItem[],
  x: number,
  y: number
): Promise<void> {
  const [{ Menu }, { LogicalPosition }] = await Promise.all([
    import('@tauri-apps/api/menu'),
    import('@tauri-apps/api/dpi'),
  ]);

  const items = menuItems
    .filter(item => !item.separator)
    .map(item => ({
      id: item.id,
      text: item.text,
      action: item.action
    }));

  const menu = await Menu.new({ items });
  await menu.popup(new LogicalPosition(x, y));
}

// 预定义的菜单项创建函数
export const createConversationMenuItems = (
  locale: Locale,
  conversationId: string,
  isStarred: boolean,
  onEdit: (id: string) => void,
  onDelete: (id: string) => void,
  onStar: (id: string) => void,
  onDuplicate?: (id: string) => void,
  onExport?: (id: string) => void,
  archive?: { text: string; action: () => void },
): MenuItem[] => [
  {
    id: 'edit',
    text: translate(locale, 'conversation.rename'),
    action: () => onEdit(conversationId)
  },
  {
    id: 'separator-1',
    text: '',
    separator: true
  },
  {
    id: 'export',
    text: translate(locale, 'conversation.export'),
    action: () => onExport?.(conversationId),
    enabled: !!onExport
  },
  {
    id: 'separator-1b',
    text: '',
    separator: true,
  },
  {
    id: 'star',
    text: translate(locale, isStarred ? 'conversation.unfavorite' : 'conversation.favorite'),
    action: () => onStar(conversationId)
  },
  {
    id: 'duplicate',
    text: translate(locale, 'conversation.duplicate'),
    action: () => onDuplicate?.(conversationId),
    enabled: !!onDuplicate
  },
  {
    id: 'separator-2',
    text: '',
    separator: true
  },
  ...(archive ? [{ id: 'archive', ...archive }] : []),
  {
    id: 'delete',
    text: translate(locale, 'conversation.delete'),
    action: () => onDelete(conversationId)
  }
];

export const createMessageMenuItems = (
  locale: Locale,
  messageId: string,
  content: string,
  isAssistant: boolean,
  onCopy: (content: string) => void,
  onEdit?: (id: string) => void,
  onRetry?: (id: string) => void,
  onStar?: (id: string) => void,
  onDelete?: (id: string) => void
): MenuItem[] => {
  const items: MenuItem[] = [
    {
      id: 'copy',
      text: translate(locale, 'chatMessage.copyContent'),
      action: () => onCopy(content)
    }
  ];

  if (onEdit && !isAssistant) {
    items.push(
      {
        id: 'separator-1',
        text: '',
        separator: true
      },
      {
        id: 'edit',
        text: translate(locale, 'chatMessage.editMessage'),
        action: () => onEdit(messageId)
      }
    );
  }

  if (onRetry && isAssistant) {
    items.push(
      {
        id: 'separator-2',
        text: '',
        separator: true
      },
      {
        id: 'retry',
        text: translate(locale, 'chatGeneration.regenerate'),
        action: () => onRetry(messageId)
      }
    );
  }

  if (onStar) {
    items.push(
      {
        id: 'separator-3',
        text: '',
        separator: true
      },
      {
        id: 'star',
        text: translate(locale, 'chatMessage.starAnswer'),
        action: () => onStar(messageId)
      }
    );
  }

  if (onDelete) {
    items.push(
      {
        id: 'separator-4',
        text: '',
        separator: true
      },
      {
        id: 'delete',
        text: translate(locale, 'chatMessage.deleteMessage'),
        action: () => onDelete(messageId)
      }
    );
  }

  return items;
}; 

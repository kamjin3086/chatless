"use client";

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

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

    // 立即获取鼠标位置信息，避免异步操作后事件失效
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // 尝试使用 Tauri Menu API（如果可用）
    try {
      const { Menu } = await import('@tauri-apps/api/menu');
      
      const items = menuItems
        .filter(item => !item.separator)
        .map(item => ({
          id: item.id, 
          text: item.text,
          action: item.action
        }));

      const menu = await Menu.new({ items });
      await menu.popup();
      return;
    } catch (error) {
      // Tauri Menu API 不可用，使用浏览器自定义菜单
      console.warn('Tauri Menu API not available, using browser fallback:', error);
    }

    // 浏览器 fallback 菜单 - 使用预先获取的鼠标位置
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

// 预定义的菜单项创建函数
export const createConversationMenuItems = (
  conversationId: string,
  isStarred: boolean,
  onEdit: (id: string) => void,
  onDelete: (id: string) => void,
  onStar: (id: string) => void,
  onDuplicate?: (id: string) => void,
  onExport?: (id: string) => void
): MenuItem[] => [
  {
    id: 'edit',
    text: '重命名对话',
    action: () => onEdit(conversationId)
  },
  {
    id: 'separator-1',
    text: '',
    separator: true
  },
  {
    id: 'export',
    text: '导出对话',
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
    text: isStarred ? '取消收藏' : '收藏对话',
    action: () => onStar(conversationId)
  },
  {
    id: 'duplicate',
    text: '复制对话',
    action: () => onDuplicate?.(conversationId),
    enabled: !!onDuplicate
  },
  {
    id: 'separator-2',
    text: '',
    separator: true
  },
  {
    id: 'delete',
    text: '删除对话',
    action: () => onDelete(conversationId)
  }
];

export const createMessageMenuItems = (
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
      text: '复制内容',
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
        text: '编辑消息',
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
        text: '重新生成',
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
        text: '收藏回答',
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
        text: '删除消息',
        action: () => onDelete(messageId)
      }
    );
  }

  return items;
}; 

"use client";

import { useEffect, useState, useMemo, useRef } from 'react';
import { useUiPreferences } from '@/store/uiPreferences';
import { StorageUtil } from '@/lib/storage';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getCommands, Command } from '@/commands/commandRegistry';
import { cn } from '@/lib/utils';

// 简易 i18n placeholder
const t = (k: string) => k;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<number>(-1); // -1 表示输入框
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [escStage, setEscStage] = useState<'first' | 'ready'>('ready');
  const [shortcutStatus, setShortcutStatus] = useState<'working' | 'error' | 'unknown'>('unknown');

  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);
  // 每次渲染重置 refs 数组长度
  itemRefs.current = [];

  // 来自用户偏好
  const { cmdPaletteEnabled, cmdPaletteShortcut } = useUiPreferences();

  // 解析快捷键字符串，仅支持类似 'mod+k' / 'ctrl+shift+p'
  const matchesShortcut = (e: KeyboardEvent) => {
    const parts = cmdPaletteShortcut.toLowerCase().split('+');
    const keyPart = parts.pop() || '';
    
    // 检查修饰键
    const expectCtrl = parts.includes('ctrl');
    const expectMeta = parts.includes('mod') || parts.includes('meta');
    const expectShift = parts.includes('shift');
    const expectAlt = parts.includes('alt');

    const isMac = navigator.platform.includes('Mac');
    
    // 优化修饰键匹配逻辑
    let ctrlOk = true;
    let metaOk = true;
    let shiftOk = true;
    let altOk = true;

    // 处理Ctrl键
    if (expectCtrl) {
      ctrlOk = e.ctrlKey;
    } else if (expectMeta) {
      // 如果期望mod键，在非Mac上Ctrl键应该为true，在Mac上应该为false
      ctrlOk = isMac ? !e.ctrlKey : e.ctrlKey;
    } else {
      // 如果不期望Ctrl键，则不应该按下
      ctrlOk = !e.ctrlKey;
    }

    // 处理Meta键（Cmd键）
    if (expectMeta) {
      metaOk = isMac ? e.metaKey : e.ctrlKey;
    } else {
      // 如果不期望Meta键，则不应该按下
      metaOk = isMac ? !e.metaKey : true;
    }

    // 处理Shift键
    if (expectShift) {
      shiftOk = e.shiftKey;
    } else {
      shiftOk = !e.shiftKey;
    }

    // 处理Alt键
    if (expectAlt) {
      altOk = e.altKey;
    } else {
      altOk = !e.altKey;
    }

    // 检查按键是否匹配
    const keyMatch = e.key.toLowerCase() === keyPart;

    return ctrlOk && metaOk && shiftOk && altOk && keyMatch;
  };

  // 快捷键监听
  useEffect(() => {
    if (!cmdPaletteEnabled) return;
    
    const handler = (e: KeyboardEvent) => {
      // 调试模式：在开发环境下输出快捷键信息
      if (process.env.NODE_ENV === 'development') {
        const isMac = navigator.platform.includes('Mac');
        // console.debug('快捷键调试:', {
        //   key: e.key,
        //   ctrlKey: e.ctrlKey,
        //   metaKey: e.metaKey,
        //   shiftKey: e.shiftKey,
        //   altKey: e.altKey,
        //   isMac,
        //   expectedShortcut: cmdPaletteShortcut,
        //   target: e.target
        // });
      }

      // 如果当前焦点在输入框、textarea或contenteditable元素中，且不是我们自己的输入框，则跳过
      const target = e.target as HTMLElement;
      if (target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.contentEditable === 'true'
      )) {
        // 检查是否是我们自己的命令面板输入框
        if (!inputRef.current?.contains(target)) {
          return;
        }
      }

      if (matchesShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((p) => !p);
      }
    };

    // 使用捕获阶段确保我们的处理器优先执行
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cmdPaletteEnabled, cmdPaletteShortcut]);

  // 监听测试事件
  useEffect(() => {
    const handleTestEvent = () => {
      setOpen(true);
    };

    window.addEventListener('test-command-palette', handleTestEvent);
    return () => window.removeEventListener('test-command-palette', handleTestEvent);
  }, []);

  // 检测快捷键状态
  useEffect(() => {
    if (!cmdPaletteEnabled) {
      setShortcutStatus('unknown');
      return;
    }

    // 简单的状态检测：如果快捷键格式正确且不在黑名单中，认为可能正常工作
    const parts = cmdPaletteShortcut.toLowerCase().split('+');
    const hasModifier = parts.some(part => ['mod', 'ctrl', 'alt', 'shift'].includes(part));
    const hasKey = parts.length >= 2 && parts[parts.length - 1] && parts[parts.length - 1].length > 0;
    
    if (hasModifier && hasKey) {
      setShortcutStatus('working');
    } else {
      setShortcutStatus('error');
    }
  }, [cmdPaletteEnabled, cmdPaletteShortcut]);

  // 直接从全局注册表获取命令
  const commands: Command[] = useMemo(() => getCommands(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = commands;
    if (q) list = commands.filter((c) => {
      const txt = t(c.titleI18n).toLowerCase();
      if (txt.includes(q)) return true;
      return c.keywords?.some((k) => k.toLowerCase().includes(q));
    });

    // 根据使用次数排序（高到低），相同次数保持原顺序
    return list.sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  }, [query, commands, usage]);

  const run = (cmd: Command) => {
    setOpen(false);
    cmd.action();
    recordUsage(cmd.id);
  };

  // 打开或列表变化时重置高亮
  useEffect(() => {
    if (!open) return;
    setHighlight(-1);
  }, [open, filtered]);

  // 初始加载指令使用次数
  useEffect(() => {
    const load = async () => {
      const data = await StorageUtil.getItem<Record<string, number>>('commandUsage', {}, 'user-preferences.json');
      const u = data || {};
      // 清理已不存在的指令 key
      const cmdIds = new Set(commands.map(c => c.id));
      let changed = false;
      Object.keys(u).forEach(k => {
        if (!cmdIds.has(k)) {
          delete u[k];
          changed = true;
        }
      });
      if (changed) {
        // 异步保存精简后的数据
        StorageUtil.setItem('commandUsage', u, 'user-preferences.json');
      }
      setUsage(u);
    };
    load();
  }, []);

  // 记录指令使用并持久化
  const recordUsage = async (id: string) => {
    setUsage((prev) => {
      const next = { ...prev, [id]: (prev[id] || 0) + 1 };
      // 异步持久化，捕获异常避免中断
      StorageUtil.setItem('commandUsage', next, 'user-preferences.json').catch(console.error);
      return next;
    });
  };

  // 根据 highlight 变化自动聚焦和滚动
  useEffect(() => {
    if (!open) return;
    
    if (highlight === -1) {
      // 焦点回到输入框
      inputRef.current?.focus();
      // 确保光标在输入框末尾
      if (inputRef.current) {
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
      }
    } else {
      // 焦点移动到指令项
      const element = itemRefs.current[highlight];
      if (element) {
        element.focus();
        // 确保选中的项目在视图中完全可见
        element.scrollIntoView({ 
          block: 'nearest', 
          behavior: 'smooth',
          inline: 'nearest'
        });
      }
    }
  }, [highlight, open, filtered]);

  // 重置 escStage 当输入变化或面板关闭
  useEffect(() => {
    if (!open) setEscStage('ready');
    if (!query) setEscStage('ready');
  }, [open, query]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg p-0 overflow-hidden border border-slate-100 rounded-xl bg-white dark:bg-slate-900 shadow-lg">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">Search and execute commands</DialogDescription>
        
        {/* 搜索输入区域 */}
        <div className="border-b border-slate-50 dark:border-slate-800 px-4 py-3">
          <Input
            ref={inputRef}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="输入以搜索指令…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filtered.length > 0) {
                  // 从输入框向下导航到第一个指令项
                  setHighlight(0);
                }
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (filtered.length > 0) {
                  // 从输入框向上导航到最后一个指令项
                  setHighlight(filtered.length - 1);
                }
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlight >= 0 && highlight < filtered.length) {
                  run(filtered[highlight]);
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                if (query && escStage === 'ready') {
                  setQuery('');
                  setEscStage('first');
                } else {
                  setOpen(false);
                }
              }
            }}
            className="h-9 border-0 bg-transparent px-0 py-0 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-0 focus:outline-none"
            onFocus={() => setHighlight(-1)}
          />
        </div>

        {/* 命令列表区域 */}
        <div className="max-h-80 overflow-y-auto scroll-smooth" role="listbox">
          {filtered.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">没有匹配项</p>
            </div>
          )}

          {['navigation', 'action', 'settings'].map((sec) => {
            const items = filtered.filter((i) => i.section === sec);
            if (items.length === 0) return null;
            return (
              <div key={sec} className="border-t border-slate-50 dark:border-slate-800 first:border-none">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {sec === 'navigation' ? '导航' : sec === 'action' ? '操作' : '设置'}
                  </p>
                </div>
                                 {items.map((c, idxInSec) => {
                   // 计算在视觉顺序中的全局索引
                   const globalIdx = filtered.findIndex((it) => it.id === c.id);
                   const Icon = c.icon as any;
                   


                  const renderTitle = () => {
                    if (!query) return t(c.titleI18n);
                    const qLow = query.toLowerCase();
                    const title = t(c.titleI18n);
                    const index = title.toLowerCase().indexOf(qLow);
                    if (index === -1) return title;
                    return (
                      <>
                        {title.slice(0, index)}
                        <mark className="bg-transparent text-blue-600 dark:text-blue-400 font-medium">
                          {title.slice(index, index + qLow.length)}
                        </mark>
                        {title.slice(index + qLow.length)}
                      </>
                    );
                  };

                  return (
                    <button
                      key={c.id}
                      role="option"
                      aria-selected={highlight === globalIdx}
                      ref={(el) => {
                        if (el) itemRefs.current[globalIdx] = el;
                      }}
                      onClick={() => run(c)}
                                             onKeyDown={(e) => {
                         if (e.key === 'ArrowDown') {
                           e.preventDefault();
                           // 向下导航：到下一个项目，如果是最后一个则循环到第一个
                           const nextIdx = globalIdx + 1 >= filtered.length ? 0 : globalIdx + 1;
                           setHighlight(nextIdx);
                         } else if (e.key === 'ArrowUp') {
                           e.preventDefault();
                           // 向上导航：到上一个项目，如果是第一个则循环到最后一个
                           const prevIdx = globalIdx - 1 < 0 ? filtered.length - 1 : globalIdx - 1;
                           setHighlight(prevIdx);
                         } else if (e.key === 'Enter') {
                           e.preventDefault();
                           run(c);
                         } else if (e.key === 'Escape') {
                           e.preventDefault();
                           // 在命令项中按Escape键回到输入框
                           setHighlight(-1);
                         }
                       }}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-2.5 text-sm focus:outline-none transition-all duration-150",
                        highlight === globalIdx 
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100" 
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {Icon && (
                          <Icon className={cn(
                            "w-4 h-4",
                            highlight === globalIdx 
                              ? "text-blue-500 dark:text-blue-400" 
                              : "text-slate-500 dark:text-slate-400"
                          )} />
                        )}
                        <span className="font-medium">{renderTitle()}</span>
                      </div>
                      {c.hint && (
                        <span className={cn(
                          "text-xs ml-4 font-mono",
                          highlight === globalIdx 
                            ? "text-blue-600 dark:text-blue-300" 
                            : "text-slate-400 dark:text-slate-500"
                        )}>
                          {c.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
} 
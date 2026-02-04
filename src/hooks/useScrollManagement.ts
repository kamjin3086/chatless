import { useState, useRef, useCallback, useEffect } from 'react';

// 滚动配置常量
const SCROLL_BOTTOM_THRESHOLD = 100; // 接近底部的判定距离
const USER_SCROLL_TIMEOUT = 1000; // 用户停止滚动后的超时时间
const CONTENT_CHANGE_TIMEOUT = 500; // 内容变化检测超时
const SCROLL_SENSITIVITY = 5; // 滚动检测灵敏度（像素）

export const useScrollManagement = (
    messagesContainerRef: React.RefObject<HTMLDivElement | null>, 
    messages: any[] | undefined,
    currentConversationId: string | null,
    isLoading: boolean
) => {
  const messageRefs = useRef<{ [key: string]: HTMLDivElement }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 核心状态：是否应该自动滚动到底部
  const [shouldFollowOutput, setShouldFollowOutput] = useState(true);
  
  // UI 状态：是否显示"回到底部"按钮
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  
  // 是否有新消息（用户查看历史时）
  const [hasNewMessageWhileAway, setHasNewMessageWhileAway] = useState(false);
  
  // Refs - 不触发重渲染
  const isUserScrollingRef = useRef(false); // 用户是否正在主动滚动
  const lastScrollTopRef = useRef(0);
  const previousConversationIdRef = useRef<string | null>(null);
  const lastMessageCountRef = useRef(0);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const contentChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessagesLengthRef = useRef(0);

  // 判断是否接近底部
  const isNearBottom = useCallback((container: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  // 监听会话切换和消息变化
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isNewConversation = previousConversationIdRef.current !== currentConversationId;
    const messageCount = messages?.length || 0;
    const hasNewMessage = messageCount > lastMessageCountRef.current;
    const messagesLength = messages?.length || 0;

    // 更新消息计数
    lastMessageCountRef.current = messageCount;

    // 会话切换：重置所有状态
    if (isNewConversation) {
      console.log('[Scroll] 会话切换，重置状态');
      setShouldFollowOutput(true);
      setShowScrollToBottom(false);
      setHasNewMessageWhileAway(false);
      isUserScrollingRef.current = false;
      previousConversationIdRef.current = currentConversationId;
      lastMessagesLengthRef.current = messagesLength;
      
      // 清除所有定时器
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
        userScrollTimeoutRef.current = null;
      }
      if (contentChangeTimeoutRef.current) {
        clearTimeout(contentChangeTimeoutRef.current);
        contentChangeTimeoutRef.current = null;
      }
      return;
    }

    // 检测消息数量变化（新消息到达或重试）
    const messagesCountChanged = messagesLength !== lastMessagesLengthRef.current;
    lastMessagesLengthRef.current = messagesLength;

    // 有新消息或消息数量变化
    if (hasNewMessage || messagesCountChanged) {
      console.log('[Scroll] 消息变化，hasNew:', hasNewMessage, 'countChanged:', messagesCountChanged);
      
      // 清除之前的内容变化定时器
      if (contentChangeTimeoutRef.current) {
        clearTimeout(contentChangeTimeoutRef.current);
      }
      
      // 设置内容变化检测
      contentChangeTimeoutRef.current = setTimeout(() => {
        contentChangeTimeoutRef.current = null;
      }, CONTENT_CHANGE_TIMEOUT);

      // 如果用户正在查看历史，显示新消息提示
      if (isUserScrollingRef.current) {
        console.log('[Scroll] 用户查看历史时有新消息');
        setHasNewMessageWhileAway(true);
      } else if (shouldFollowOutput) {
        // 用户未手动滚动，自动跟随
        console.log('[Scroll] 自动跟随新消息');
        requestAnimationFrame(() => {
          if (container && !isUserScrollingRef.current) {
            const target = container.scrollHeight - container.clientHeight;
            container.scrollTop = target;
          }
        });
      }
    }

    previousConversationIdRef.current = currentConversationId;
  }, [messages, currentConversationId, shouldFollowOutput, messagesContainerRef]);

  // 滚动监听：检测用户滚动行为
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const scrollDiff = scrollTop - lastScrollTopRef.current;
      const nearBottom = isNearBottom(container);
      
      // 更新"回到底部"按钮显示状态
      setShowScrollToBottom(!nearBottom);
      
      // 清除之前的用户滚动超时
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
      
      // 检测用户滚动（需要有明显的滚动距离）
      if (Math.abs(scrollDiff) > SCROLL_SENSITIVITY) {
        const isScrollingUp = scrollDiff < 0;
        
        // 向上滚动：停止自动跟随
        if (isScrollingUp) {
          console.log('[Scroll] 用户向上滚动，停止自动跟随');
          isUserScrollingRef.current = true;
          setShouldFollowOutput(false);
        }
        
        // 向下滚动到底部：恢复自动跟随
        if (!isScrollingUp && nearBottom) {
          console.log('[Scroll] 用户滚动到底部，恢复自动跟随');
          isUserScrollingRef.current = false;
          setShouldFollowOutput(true);
          setHasNewMessageWhileAway(false); // 清除新消息提示
        }
        
        // 设置超时：一段时间后清除用户滚动标记
        if (!nearBottom) {
          userScrollTimeoutRef.current = setTimeout(() => {
            // 如果用户停止滚动一段时间后还没到底部，保持停止状态
            userScrollTimeoutRef.current = null;
          }, USER_SCROLL_TIMEOUT);
        }
      }
      
      lastScrollTopRef.current = scrollTop;
    };

    // 鼠标滚轮事件：快速响应滚动
    const handleWheel = (event: WheelEvent) => {
      const nearBottom = isNearBottom(container);
      
      // 向上滚轮：立即停止自动跟随
      if (event.deltaY < 0) {
        isUserScrollingRef.current = true;
        setShouldFollowOutput(false);
      }
      
      // 向下滚轮到底部：恢复自动跟随
      if (event.deltaY > 0 && nearBottom) {
        isUserScrollingRef.current = false;
        setShouldFollowOutput(true);
        setHasNewMessageWhileAway(false);
      }
    };

    // 触摸事件：移动端支持
    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0].clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touchY = event.touches[0].clientY;
      const diff = touchY - touchStartY;
      const nearBottom = isNearBottom(container);
      
      // 向上滑动：停止自动跟随
      if (diff > 15) {
        isUserScrollingRef.current = true;
        setShouldFollowOutput(false);
      }
      
      // 向下滑动到底部：恢复自动跟随
      if (diff < -15 && nearBottom) {
        isUserScrollingRef.current = false;
        setShouldFollowOutput(true);
        setHasNewMessageWhileAway(false);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
      if (contentChangeTimeoutRef.current) {
        clearTimeout(contentChangeTimeoutRef.current);
      }
    };
  }, [isNearBottom, messagesContainerRef]);

  // 导航到指定消息
  const handleNavigateToMessage = useCallback((messageId: string) => {
    console.log('[Scroll] 导航到消息:', messageId);
    const messageElement = messageRefs.current[messageId];
    if (messageElement && messagesContainerRef.current) {
      // 停止自动跟随
      isUserScrollingRef.current = true;
      setShouldFollowOutput(false);
      
      // 滚动到消息
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messagesContainerRef]);

  // 滚动到顶部
  const handleScrollToTop = useCallback(() => {
    console.log('[Scroll] 滚动到顶部');
    const container = messagesContainerRef.current;
    if (!container) return;
    
    // 停止自动跟随
    isUserScrollingRef.current = true;
    setShouldFollowOutput(false);
    
    container.scrollTo({ top: 0, behavior: 'smooth' });
  }, [messagesContainerRef]);

  // 滚动到底部
  const handleScrollToBottom = useCallback(() => {
    console.log('[Scroll] 手动滚动到底部');
    const container = messagesContainerRef.current;
    if (!container) return;
    
    // 恢复自动跟随
    isUserScrollingRef.current = false;
    setShouldFollowOutput(true);
    setShowScrollToBottom(false);
    setHasNewMessageWhileAway(false);
    
    // 平滑滚动到底部
    const target = container.scrollHeight - container.clientHeight;
    container.scrollTo({ top: target, behavior: 'smooth' });
  }, [messagesContainerRef]);

  // 如果接近底部，确保滚动到底部
  const ensureBottomIfNear = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    if (isNearBottom(container) && shouldFollowOutput) {
      requestAnimationFrame(() => {
        if (container) {
          const target = container.scrollHeight - container.clientHeight;
          container.scrollTop = target;
        }
      });
    }
  }, [messagesContainerRef, isNearBottom, shouldFollowOutput]);

  /**
   * ✅ 稳定跟随：流式期间（尤其是代码块渲染）会产生"二次布局变化"
   * 
   * 典型现象：
   * - token 已经在继续追加，但渲染 Markdown（代码块/换行/字体度量）会在稍后重新排版，导致 scrollHeight 突增
   * - Virtuoso 的 followOutput=auto 会认为用户"离开了底部"，从而停止跟随
   *
   * 解决思路：
   * - 仅在 shouldFollowOutput 且用户未主动滚动时启用
   * - 监听 DOM 变化（MutationObserver），在下一帧将滚动位置重新钉到底部
   * - 采用 scrollTop 直接赋值（避免 smooth 造成追赶延迟）
   * 
   * 修复：即使 isLoading=false，只要 shouldFollowOutput=true 就应该监听 DOM 变化
   * 因为消息内容可能在 isLoading 变为 false 后仍有渲染变化（如 Markdown 解析、代码高亮）
   */
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    // 修复：移除 isLoading 的强制检查，只要 shouldFollowOutput=true 就启用监听
    // 这样可以确保即使在非加载状态下，内容变化也能触发滚动
    if (!shouldFollowOutput) return;

    let rafId: number | null = null;
    const stickToBottomIfNeeded = () => {
      rafId = null;
      if (!shouldFollowOutput) return;
      if (isUserScrollingRef.current) return; // 用户主动查看历史时不打扰
      // 只要用户处于"跟随模式"，就允许在布局变化后补一次到底部
      const target = container.scrollHeight - container.clientHeight;
      // 仅当不在底部时才滚动，避免不必要的滚动操作
      if (Math.abs(container.scrollTop - target) > 5) {
        container.scrollTop = target;
      }
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(stickToBottomIfNeeded);
    };

    const mo = new MutationObserver(() => {
      schedule();
    });
    try {
      mo.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch {
      // 某些环境下（极少）可能不允许 observe，忽略即可
    }

    // 初始化时立即检查一次
    schedule();

    return () => {
      try { mo.disconnect(); } catch { /* noop */ }
      if (rafId !== null) {
        try { cancelAnimationFrame(rafId); } catch { /* noop */ }
        rafId = null;
      }
    };
  }, [messagesContainerRef, shouldFollowOutput]);

  // 简化：直接返回计算值，不再使用基于时间的防抖
  // 界面抖动的根本解决方案在 ChatMessage.tsx 中通过检测工具调用状态实现
  const computedFollowOutput = shouldFollowOutput && (isLoading || contentChangeTimeoutRef.current !== null);

  return {
    messageRefs,
    messagesEndRef,
    handleNavigateToMessage,
    handleScrollToTop,
    handleScrollToBottom,
    ensureBottomIfNear,
    showScrollToBottom,
    isAtBottom: !showScrollToBottom,
    hasNewMessageWhileAway,
    // 导出给 Virtuoso 使用的 followOutput 状态
    shouldFollowOutput: computedFollowOutput,
  };
};

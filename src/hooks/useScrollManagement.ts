import { useState, useRef, useCallback, useEffect } from 'react';

// 滚动配置常量
/** 距离底部多远算"接近底部"（决定新消息提示的显示）。 */
const SCROLL_BOTTOM_THRESHOLD = 100;
/** 距离底部多近才算"真的在底部"（决定是否恢复跟随）。 */
const BOTTOM_EPSILON = 8;
/**
 * 一次滚轮/触摸/按键手势在多长时间内仍算"用户意图"。
 * 只有用户意图才能改变跟随模式；流式渲染自身造成的 scrollTop 变化
 * （布局重排、锚点修正、自动贴底）不再被误判成"用户滚上去了"。
 */
const USER_INTENT_WINDOW = 700;
/** 我们自己写入 scrollTop 后，这段时间内、且位置吻合的滚动事件不算用户滚动。 */
const PROGRAMMATIC_SCROLL_WINDOW = 250;
/** 手势收敛等待时间：滚轮停下来之后再判断方向。 */
const GESTURE_SETTLE_MS = 140;
/** 向上累计超过这个距离，视为"用户想往上读"。用累计值过滤回弹与惯性噪音。 */
const UPWARD_INTENT_PX = 12;

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
  
  // UI 状态：用户是否离开过底部（"回到底部"按钮）
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  
  // 是否有新消息（用户查看历史时）
  const [hasNewMessageWhileAway, setHasNewMessageWhileAway] = useState(false);
  
  // Refs - 不触发重渲染
  const isUserScrollingRef = useRef(false); // 跟随是否被用户手势关掉
  const previousConversationIdRef = useRef<string | null>(null);
  const lastMessageCountRef = useRef(0);
  const lastMessagesLengthRef = useRef(0);
  /** 最近一次用户手势（滚轮/触摸/按键/按下指针）的时间戳。 */
  const lastUserIntentRef = useRef(0);
  /** 手势期间累计的向上滚动距离。 */
  const upwardIntentRef = useRef(0);
  /** 最近一次由代码写入的滚动位置，用于识别"这不是用户滚的"。 */
  const programmaticScrollRef = useRef<{ top: number; at: number } | null>(null);
  /** shouldFollowOutput 的同步镜像，供事件回调立即读取（state 更新是异步的）。 */
  const followingRef = useRef(true);

  const isNearBottom = useCallback((container: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const isAtBottom = useCallback((container: HTMLElement) => {
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= BOTTOM_EPSILON;
  }, []);

  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next;
    isUserScrollingRef.current = !next;
    setShouldFollowOutput(next);
    if (next) setHasNewMessageWhileAway(false);
  }, []);

  const markUserIntent = useCallback((upwardPx = 0) => {
    lastUserIntentRef.current = performance.now();
    if (upwardPx > 0) upwardIntentRef.current += upwardPx;
  }, []);

  /** 只有代码自己贴底时才走这里，这样 scroll 事件不会被误判成用户滚动。 */
  const pinToBottom = useCallback((container: HTMLElement) => {
    const target = container.scrollHeight - container.clientHeight;
    if (Math.abs(container.scrollTop - target) <= 1) return;
    programmaticScrollRef.current = { top: target, at: performance.now() };
    container.scrollTop = target;
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
      setFollowing(true);
      setIsAwayFromBottom(false);
      setHasNewMessageWhileAway(false);
      upwardIntentRef.current = 0;
      previousConversationIdRef.current = currentConversationId;
      lastMessagesLengthRef.current = messagesLength;
      return;
    }

    // 检测消息数量变化（新消息到达或重试）
    const messagesCountChanged = messagesLength !== lastMessagesLengthRef.current;
    lastMessagesLengthRef.current = messagesLength;

    if (hasNewMessage || messagesCountChanged) {
      // 如果用户正在查看历史，显示新消息提示
      if (isUserScrollingRef.current) {
        setHasNewMessageWhileAway(true);
      } else if (followingRef.current) {
        requestAnimationFrame(() => {
          const node = messagesContainerRef.current;
          if (node && followingRef.current) pinToBottom(node);
        });
      }
    }

    previousConversationIdRef.current = currentConversationId;
  }, [messages, currentConversationId, messagesContainerRef, pinToBottom, setFollowing]);

  // 滚动监听：区分"用户意图"与"渲染副作用"
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    /** A held pointer (scrollbar drag) keeps intent alive for as long as it is down. */
    let pointerDown = false;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const nearBottom = isNearBottom(container);
      setIsAwayFromBottom(!nearBottom);

      const programmatic = programmaticScrollRef.current;
      const isOurScroll =
        !!programmatic &&
        performance.now() - programmatic.at < PROGRAMMATIC_SCROLL_WINDOW &&
        Math.abs(scrollTop - programmatic.top) <= 2;

      // 布局变化（Markdown 重排、代码高亮、字体度量）和自动贴底都会改
      // scrollTop。它们既不能停止跟随，也不能恢复跟随。
      if (isOurScroll) return;
      const hasUserIntent =
        pointerDown || performance.now() - lastUserIntentRef.current <= USER_INTENT_WINDOW;
      if (!hasUserIntent) return;

      if (isAtBottom(container)) {
        if (!followingRef.current) setFollowing(true);
        upwardIntentRef.current = 0;
        return;
      }

      // 视口确实离开底部，才停止跟随。触控板在底部回弹产生的 scroll 事件
      // 不会离开底部，因此不会再误杀跟随。
      if (!nearBottom && followingRef.current) setFollowing(false);
    };

    /**
     * 手势收敛：滚轮/触摸停下来之后再判断方向。
     * 用户只想往上读一点（还没离开 100px 判定区）时同样应该停止跟随，
     * 但向下的惯性或底部回弹不能算。
     */
    const settleGesture = () => {
      settleTimer = null;
      const upward = upwardIntentRef.current;
      upwardIntentRef.current = 0;
      if (upward < UPWARD_INTENT_PX) {
        // 没有向上意图时，只有真的在底部才恢复跟随
        if (isAtBottom(container)) setFollowing(true);
        return;
      }
      const scrollable = container.scrollHeight - container.clientHeight > BOTTOM_EPSILON;
      if (scrollable) setFollowing(false);
    };

    const scheduleSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(settleGesture, GESTURE_SETTLE_MS);
    };

    const handleWheel = (event: WheelEvent) => {
      // 只累计向上意图；向下的惯性/回弹不会停止跟随。
      markUserIntent(event.deltaY < 0 ? -event.deltaY : 0);
      scheduleSettle();
    };

    // 触摸事件：移动端支持
    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0].clientY;
      markUserIntent();
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touchY = event.touches[0].clientY;
      const diff = touchY - touchStartY;
      // 手指往下拖动 = 内容往上滚 = 向上意图
      if (diff > 0) markUserIntent(diff);
      touchStartY = touchY;
    };

    const handleTouchEnd = () => scheduleSettle();

    // 键盘翻页也能停止跟随
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'ArrowUp' || event.key === 'Home') {
        markUserIntent(UPWARD_INTENT_PX);
        scheduleSettle();
      } else if (event.key === 'PageDown' || event.key === 'ArrowDown' || event.key === 'End' || event.key === ' ') {
        markUserIntent();
        scheduleSettle();
      }
    };

    // 拖动滚动条不会触发 wheel，但会先按下指针；按住期间一直算用户意图，
    // 否则一次很长的拖拽会超出意图窗口，自动贴底又会把视图抢回去。
    const handlePointerDown = () => {
      pointerDown = true;
      markUserIntent();
    };
    const handlePointerUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      markUserIntent();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerUp, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [isAtBottom, isNearBottom, markUserIntent, messagesContainerRef, setFollowing]);

  // 导航到指定消息
  const handleNavigateToMessage = useCallback((messageId: string) => {
    const messageElement = messageRefs.current[messageId];
    if (messageElement && messagesContainerRef.current) {
      setFollowing(false);
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messagesContainerRef, setFollowing]);

  // 滚动到顶部
  const handleScrollToTop = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    setFollowing(false);
    programmaticScrollRef.current = { top: 0, at: performance.now() };
    container.scrollTo({ top: 0, behavior: 'smooth' });
  }, [messagesContainerRef, setFollowing]);

  // 滚动到底部
  const handleScrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    setFollowing(true);
    setIsAwayFromBottom(false);
    upwardIntentRef.current = 0;
    programmaticScrollRef.current = {
      top: container.scrollHeight - container.clientHeight,
      at: performance.now(),
    };
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messagesContainerRef, setFollowing]);

  // 如果接近底部，确保滚动到底部
  const ensureBottomIfNear = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    if (isNearBottom(container) && followingRef.current) {
      requestAnimationFrame(() => {
        const node = messagesContainerRef.current;
        if (node && followingRef.current) pinToBottom(node);
      });
    }
  }, [messagesContainerRef, isNearBottom, pinToBottom]);

  /**
   * 流式期间逐帧贴底。
   *
   * 之前跟随依赖 MutationObserver：只有 DOM 真的变化时才补一次。虚拟列表
   * （Virtuoso）经常只改样式/测量，不产生 mutation；Markdown 重排又发生在
   * 下一帧，于是 token 还在追加、界面却停住不动——即"偶尔不跟随"。
   * 现在只要在跟随模式且正在生成，就每帧直接对齐到底部，不依赖任何事件触发。
   */
  useEffect(() => {
    if (!isLoading || !shouldFollowOutput) return;
    let rafId: number | null = null;
    const tick = () => {
      const container = messagesContainerRef.current;
      if (container && followingRef.current) pinToBottom(container);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isLoading, shouldFollowOutput, messagesContainerRef, pinToBottom]);

  /**
   * 流式结束后的收尾：代码高亮、图片、字体度量可能都在最后一帧之后才定型，
   * 不会再走上面的逐帧循环，所以仍然监听 DOM（含 style/class 变化）补一次。
   */
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!shouldFollowOutput) return;

    let rafId: number | null = null;
    const stickToBottomIfNeeded = () => {
      rafId = null;
      if (!followingRef.current) return;
      pinToBottom(container);
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(stickToBottomIfNeeded);
    };

    const mo = new MutationObserver(schedule);
    try {
      mo.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    } catch {
      // 某些环境下（极少）可能不允许 observe，忽略即可
    }

    schedule();

    return () => {
      try { mo.disconnect(); } catch { /* noop */ }
      if (rafId !== null) {
        try { cancelAnimationFrame(rafId); } catch { /* noop */ }
        rafId = null;
      }
    };
  }, [messagesContainerRef, shouldFollowOutput, pinToBottom]);

  return {
    messageRefs,
    messagesEndRef,
    handleNavigateToMessage,
    handleScrollToTop,
    handleScrollToBottom,
    ensureBottomIfNear,
    // 不再跟随时也给出"回到底部"，否则用户往上读一点就找不回按钮
    showScrollToBottom: isAwayFromBottom || !shouldFollowOutput,
    isAtBottom: !isAwayFromBottom,
    hasNewMessageWhileAway,
    shouldFollowOutput,
  };
};

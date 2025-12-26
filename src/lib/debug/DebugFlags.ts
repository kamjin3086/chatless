export type DebugCategory = 'events' | 'render' | 'store' | 'ui';

type RuntimeFlags = Partial<Record<DebugCategory, boolean>>;

// 代码级默认开关
//
// ⚠️ 重要：这些开关一旦开启，会在流式期间产生大量 console 输出，严重拖慢渲染与事件循环，
// 从而出现“服务端早就完成了，但界面还在逐字输出/追赶”的错觉。
//
// 因此默认全部关闭，仅在需要排查问题时通过 setRuntimeDebugFlags() 显式开启。
const DEFAULT_FLAGS: Record<DebugCategory, boolean> = {
  events: false,
  store: false,
  ui: false,
  render: false,
};

let runtimeFlags: RuntimeFlags = {};

export function setRuntimeDebugFlags(flags: RuntimeFlags): void {
  // 允许在代码层（或测试注入）覆盖默认值
  runtimeFlags = { ...runtimeFlags, ...flags };
}

export function isDebugEnabled(category: DebugCategory): boolean {
  if (category in runtimeFlags) return !!runtimeFlags[category as DebugCategory];
  return DEFAULT_FLAGS[category];
}



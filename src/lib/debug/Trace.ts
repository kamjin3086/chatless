import { isDebugEnabled, type DebugCategory } from './DebugFlags';

export function trace(category: DebugCategory, messageId: string | undefined, label: string, data?: unknown): void {
  // 1. 快速检查开关：如果未启用，立即返回，不执行任何后续逻辑
  if (!isDebugEnabled(category)) return;

  // 2. 避免昂贵的序列化：只有在确实需要打印时才处理数据
  // 以前即使 category 没开，传参时的对象构建可能已经发生了（在调用侧）
  // 但至少这里不要再做 JSON.stringify 或字符串拼接
  try {
    const time = new Date().toISOString().split('T')[1]?.replace('Z', '') || '';
    const prefix = `[TRACE:${category}]${messageId ? `(${messageId.substring(0,8)})` : ''} ${time} - ${label}`;
    
    if (data !== undefined) {
      // 避免打印过大对象，只截取前 100 字符预览
      const preview = typeof data === 'string' 
        ? (data.length > 500 ? data.slice(0, 500) + '...' : data)
        : (Array.isArray(data) ? `Array(${data.length})` : typeof data === 'object' ? 'Object' : String(data));
      
      console.log(prefix, preview);
    } else {
      console.log(prefix);
    }
  } catch { /* noop */ }
}



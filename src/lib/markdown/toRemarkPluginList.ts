/**
 * Streamdown 的 defaultRemarkPlugins 是 Record<string, plugin>，不是数组。
 * - 传入 [] 会覆盖 Streamdown 默认插件，GFM 表格无法渲染
 * - 把整个 Record 当成单个 plugin/preset 会触发 unified empty preset 错误
 */
export function toRemarkPluginList(input: unknown): unknown[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean);
  if (typeof input === 'object') {
    return Object.values(input as Record<string, unknown>).filter(Boolean);
  }
  return [input];
}

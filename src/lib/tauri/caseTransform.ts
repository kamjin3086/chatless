/**
 * Tauri invoke 参数大小写转换工具
 *
 * 规范：
 * - Rust 后端统一使用 snake_case
 * - 前端代码使用 camelCase
 * - 在 invoke 调用时自动转换
 */

/**
 * 将 camelCase 字符串转换为 snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * 将 snake_case 字符串转换为 camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * 递归将对象的所有 key 从 camelCase 转换为 snake_case
 */
export function keysToSnakeCase<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => keysToSnakeCase(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const snakeKey = camelToSnake(key);
      result[snakeKey] = keysToSnakeCase((obj as Record<string, unknown>)[key]);
    }
    return result as T;
  }

  return obj;
}

/**
 * 递归将对象的所有 key 从 snake_case 转换为 camelCase
 */
export function keysToCamelCase<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => keysToCamelCase(item)) as T;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = keysToCamelCase((obj as Record<string, unknown>)[key]);
    }
    return result as T;
  }

  return obj;
}

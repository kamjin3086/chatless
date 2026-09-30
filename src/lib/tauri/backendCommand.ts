/**
 * Tauri command 调用约定：payload 包裹 + camelCase/snake_case 自动转换。
 *
 * Rust 侧统一 snake_case，前端统一 camelCase；所有命令都经过这里，避免每个模块
 * 各自实现一份转换逻辑后行为不一致。
 */

import { keysToCamelCase, keysToSnakeCase } from './caseTransform';

let cachedInvoke: typeof import('@tauri-apps/api/core').invoke | null = null;

async function getInvoke(): Promise<typeof import('@tauri-apps/api/core').invoke> {
  if (!cachedInvoke) {
    const { invoke } = await import('@tauri-apps/api/core');
    cachedInvoke = invoke;
  }
  return cachedInvoke;
}

export async function invokeBackend<TResult>(
  command: string,
  params: Record<string, unknown> = {},
): Promise<TResult> {
  const invoke = await getInvoke();
  const result = await invoke<unknown>(command, { payload: keysToSnakeCase(params) });
  return keysToCamelCase(result) as TResult;
}

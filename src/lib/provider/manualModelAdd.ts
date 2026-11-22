import type { ModelEntity } from './types';

/** 手动添加弹窗里的一行输入：模型 ID 必填，显示名可选。 */
export interface ManualModelInput {
  id: string;
  label: string;
}

/**
 * 把手动输入的模型合进已有列表：同 ID 视为覆盖（只更新显示名），否则追加。
 *
 * 返回新数组，绝不改动 `existing`：`modelRepository.get()` 交出的是缓存里的数组本身，
 * 原地 push 会让紧随其后的 `save()` 比对出“没有变化”，从而既不落盘也不通知订阅者，
 * 于是添加成功后列表仍然显示为空。
 */
export function mergeManualModels(
  provider: string,
  existing: readonly ModelEntity[],
  inputs: readonly ManualModelInput[],
): ModelEntity[] {
  const next: ModelEntity[] = [...existing];
  const indexById = new Map(
    next.map((m, index) => [String(m.name).toLowerCase(), index]),
  );

  for (const input of inputs) {
    const index = indexById.get(input.id.toLowerCase());
    if (index !== undefined) {
      const current = next[index];
      next[index] = { ...current, label: input.label || current.label };
      continue;
    }
    indexById.set(input.id.toLowerCase(), next.length);
    next.push({
      provider,
      name: input.id,
      label: input.label || undefined,
      aliases: [input.id],
    });
  }

  return next;
}

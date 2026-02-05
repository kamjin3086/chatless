/**
 * 通用同步框架 - 冲突解决器
 * 
 * 使用时间戳和设备ID进行确定性冲突解决
 */

import type { ConflictMetadata, SyncMetadataEntry } from './types';

/**
 * 字符串字典序比较
 */
function lexCompare(a: string | undefined | null, b: string | undefined | null): number {
  const aa = a || '';
  const bb = b || '';
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

/**
 * 判断本地是否胜出
 * 
 * 冲突解决规则：
 * 1. 首先比较 updated_at 时间戳，较新的胜出
 * 2. 如果时间戳相同，比较 device_id 字典序，较大的胜出
 * 
 * @param local 本地数据的元数据
 * @param remote 远端数据的元数据，不存在时返回 true
 * @returns 如果本地应该覆盖远端返回 true
 */
export function shouldLocalWin(
  local: ConflictMetadata,
  remote?: SyncMetadataEntry | null
): boolean {
  if (!remote) return true;
  
  if (local.updated_at !== remote.updated_at) {
    return local.updated_at > remote.updated_at;
  }
  
  return lexCompare(local.device_id, remote.device_id) > 0;
}

/**
 * 判断远端是否胜出
 * 
 * @param remote 远端数据的元数据
 * @param local 本地数据的元数据，不存在时返回 true
 * @returns 如果远端应该覆盖本地返回 true
 */
export function shouldRemoteWin(
  remote: SyncMetadataEntry,
  local?: ConflictMetadata | null
): boolean {
  if (!local) return true;
  
  if (remote.updated_at !== local.updated_at) {
    return remote.updated_at > local.updated_at;
  }
  
  return lexCompare(remote.device_id, local.device_id) > 0;
}

/**
 * 获取冲突解决结果的胜出者
 * 
 * @param local 本地元数据
 * @param remote 远端元数据
 * @returns 'local' | 'remote' | 'equal'
 */
export function getConflictWinner(
  local: ConflictMetadata,
  remote: SyncMetadataEntry
): 'local' | 'remote' | 'equal' {
  if (local.updated_at !== remote.updated_at) {
    return local.updated_at > remote.updated_at ? 'local' : 'remote';
  }
  
  const cmp = lexCompare(local.device_id, remote.device_id);
  if (cmp === 0) return 'equal';
  return cmp > 0 ? 'local' : 'remote';
}

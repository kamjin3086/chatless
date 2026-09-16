/**
 * Windows 路径/文件名安全处理工具
 */

const WINDOWS_MAX_PATH = 260;
const WINDOWS_MAX_COMPONENT = 255;
const RESERVED_PHYSICAL_PREFIX_LENGTH = 37; // uuid + underscore

/**
 * 从原始文件名生成安全的物理存储名（保留扩展名，basename 截断）
 */
export function buildSafePhysicalFileName(originalName: string, id: string): string {
  const sanitized = originalName.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'file';
  const dotIndex = sanitized.lastIndexOf('.');
  const hasExt = dotIndex > 0 && dotIndex < sanitized.length - 1;
  const ext = hasExt ? sanitized.slice(dotIndex) : '';
  const base = hasExt ? sanitized.slice(0, dotIndex) : sanitized;

  const maxBaseLength = Math.max(
    16,
    WINDOWS_MAX_COMPONENT - RESERVED_PHYSICAL_PREFIX_LENGTH - ext.length
  );
  const truncatedBase =
    base.length > maxBaseLength ? base.slice(0, maxBaseLength) : base;

  return `${truncatedBase}${ext}`;
}

/**
 * 校验完整路径长度（Windows 友好提示）
 */
export function validatePathLength(fullPath: string): { ok: boolean; message?: string } {
  if (fullPath.length > WINDOWS_MAX_PATH) {
    return {
      ok: false,
      message: `文件路径过长（${fullPath.length} 字符），请缩短文件名后重试`,
    };
  }
  return { ok: true };
}

/**
 * 给用户展示截断后的文件名
 */
export function truncateDisplayName(name: string, maxLength = 48): string {
  if (name.length <= maxLength) return name;
  const extIndex = name.lastIndexOf('.');
  if (extIndex > 0 && name.length - extIndex <= 12) {
    const ext = name.slice(extIndex);
    const keep = maxLength - ext.length - 1;
    return `${name.slice(0, Math.max(8, keep))}…${ext}`;
  }
  return `${name.slice(0, maxLength - 1)}…`;
}

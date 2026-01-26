/**
 * Skills 完整性/审计工具
 *
 * 注意：本模块运行在浏览器/tauri webview 环境，尽量避免 Node.js API。
 */

/**
 * 计算文本的 SHA-256（hex）。
 *
 * - 若运行时不支持 WebCrypto（极少数环境），返回 null。
 */
export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;

    const data = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export function inferOriginKind(repoUrl?: string, source?: 'local' | 'remote'): 'official' | 'third_party' | 'local' | 'unknown' {
  if (source === 'local') return 'local';
  if (!repoUrl) return 'unknown';

  const u = repoUrl.toLowerCase();
  // anthropics/skills 官方仓库
  if (u.includes('github.com/anthropics/skills')) return 'official';
  if (u.includes('anthropics/skills')) return 'official';
  return 'third_party';
}


import type { Conversation } from '@/types/chat';

export interface TitleGeneratorOptions {
  maxLength?: number; // 期望的最大长度（字符）
  language?: 'zh' | 'en';
  /**
   * 失败时的回退策略：
   * - 'trim'：使用用户消息裁剪作为标题
   * - 'none'：不做回退（返回空字符串，由调用方决定是否保持默认标题）
   */
  fallbackPolicy?: 'trim' | 'none';
}

/**
 * 规范化与裁剪标题，移除不需要的符号并限制长度
 */
export function normalizeTitle(raw: string, maxLength: number): string {
  if (!raw) return '';
  let title = String(raw).trim();

  // 移除反引号包裹
  title = title.replace(/`/g, '');

  // 若包含 JSON 形态的 {"title":"..."}，先直接提取值
  try {
    const jsonLike = title.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    if (jsonLike && jsonLike[1]) {
      // 还原转义字符
      const unescaped = jsonLike[1].replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\"/g, '"');
      title = unescaped;
    }
  } catch { /* ignore regex parse */ }

  // 去除 R1 等模型输出的思考标签与任意 HTML/XML 标签
  title = title.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // 移除孤立的 </think> 闭合标签
  title = title.replace(/<\/think>/gi, '');
  // 移除其他 HTML/XML 标签
  title = title.replace(/<[^>]+>/g, '');

  // 去除换行与多余空白
  title = title.replace(/\s+/g, ' ');

  // 去除包裹引号、句号、尾随标点与 emoji 等非常见符号
  title = title
    .replace(/^["'""'']+|["'""'']+$/g, '')
    .replace(/[\r\n]/g, ' ')
    .replace(/[。！？!?,;；]+$/g, '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');

  // 再次 trim
  title = title.trim();

  // 裁剪到最大长度
  if (title.length > maxLength) {
    title = title.slice(0, maxLength);
  }

  return title || '';
}

/**
 * 判断是否为默认会话标题（用于新建会话占位）
 */
export function isDefaultTitle(title: string | undefined | null): boolean {
  const t = (title || '').trim();
  // 注意：JS 的 \b 对中文不友好，使用 startsWith 判断更稳健
  return t.startsWith('新对话');
}

/**
 * 从会话中提取第一条用户消息内容，作为标题生成的种子
 */
export function extractFirstUserMessageSeed(conversation: Conversation | null | undefined): string {
  if (!conversation || !Array.isArray(conversation.messages)) return '';
  const msg = conversation.messages.find(m => m.role === 'user');
  return (msg?.content || '').trim();
}

/**
 * 是否在"首次助手回复完成后"触发标题生成：
 * - 当前标题仍为默认
 * - 对话中助手消息数量正好为 1（即首条回复刚完成）
 */
export function shouldGenerateTitleAfterAssistantComplete(conversation: Conversation | null | undefined): boolean {
  if (!conversation) return false;

  // 1) 仍为默认标题
  if (!isDefaultTitle(conversation.title)) return false;

  // 2) 至少已有一条助手回复（确保不是空会话）
  const assistantCount = conversation.messages?.filter(m => m.role === 'assistant').length ?? 0;
  if (assistantCount === 0) return false;

  // 3) 首条用户消息存在
  const firstSeed = extractFirstUserMessageSeed(conversation);
  return !!firstSeed;
}

// 已迁移到 TitleService 作为唯一生成入口；此文件保留解析/判断工具函数

/**
 * 从文本中提取最后一个完整的 JSON 对象
 * 通过从后向前扫描，找到最后一个 `}` 并匹配其对应的 `{`
 */
function extractLastJsonObject(text: string): string | null {
  let braceCount = 0;
  let endIdx = -1;
  let startIdx = -1;
  
  // 从后向前扫描，找到最后一个完整的 {...}
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') {
      if (endIdx === -1) endIdx = i;
      braceCount++;
    } else if (ch === '{') {
      braceCount--;
      if (braceCount === 0 && endIdx !== -1) {
        startIdx = i;
        break;
      }
    }
  }
  
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return text.slice(startIdx, endIdx + 1);
  }
  return null;
}

/**
 * 从模型输出解析标题
 * 
 * 核心策略：找到文本中最后一个完整的 JSON 对象，提取其 title 字段
 * 这样可以跳过所有思考过程、反引号、标签等干扰内容
 */
export function extractTitleFromOutput(raw: string, maxLength: number): string {
  if (!raw) return '';
  const text = String(raw);

  // 策略1：提取最后一个完整的 JSON 对象并解析 title
  try {
    const jsonStr = extractLastJsonObject(text);
    if (jsonStr) {
      const obj = JSON.parse(jsonStr);
      if (obj && typeof obj.title === 'string') {
        return normalizeTitle(obj.title, maxLength);
      }
    }
  } catch { /* ignore json parse error */ }

  // 策略2：用正则提取最后一个 "title":"..." 模式（处理不完整 JSON 的情况）
  try {
    // 匹配所有 "title":"..." 模式，取最后一个
    const matches = text.matchAll(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi);
    let lastMatch: string | null = null;
    for (const m of matches) {
      if (m[1]) lastMatch = m[1];
    }
    if (lastMatch) {
      const unescaped = lastMatch
        .replace(/\\n/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\"/g, '"');
      return normalizeTitle(unescaped, maxLength);
    }
  } catch { /* ignore regex error */ }

  // 策略3：XML/HTML 标签 <title>...</title>
  try {
    const xmlMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
    if (xmlMatch && xmlMatch[1]) {
      return normalizeTitle(xmlMatch[1], maxLength);
    }
  } catch { /* ignore */ }

  // 策略4：形如 "标题: xxx" 或 "Title: xxx" 的行
  try {
    const line = text.split(/\r?\n/).find(l => /^(标题|Title)\s*[:：]/i.test(l));
    if (line) {
      const val = line.replace(/^(标题|Title)\s*[:：]/i, '');
      const norm = normalizeTitle(val, maxLength);
      if (norm) return norm;
    }
  } catch { /* ignore */ }

  return '';
}

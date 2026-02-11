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
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
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
 * 是否在“首次助手回复完成后”触发标题生成：
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
 * 从模型输出解析标题，优先识别 JSON 或标签格式
 */
export function extractTitleFromOutput(raw: string, maxLength: number): string {
  if (!raw) return '';
  let text = String(raw).trim();

  // 去掉可能的代码块围栏，降低解析失败概率
  text = text.replace(/```[a-zA-Z]*\n([\s\S]*?)\n```/g, '$1');
  
  // 移除反引号包裹（部分模型会输出 `{...}`）
  text = text.replace(/`/g, '');
  
  // 移除 <think>...</think> 块（完整标签对）
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // 移除孤立的 </think> 闭合标签（模型可能只输出闭合标签或截断）
  text = text.replace(/<\/think>/gi, '');
  
  // 移除孤立的 <think> 开始标签及其后的内容直到遇到 JSON 或结尾
  text = text.replace(/<think>[\s\S]*/gi, '');

  // 优先用正则在任意位置提取 \"title\" 字段（无需完整 JSON），成功即返回
  try {
    const m = text.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    if (m && m[1]) {
      const unescaped = m[1]
        .replace(/\\n/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\"/g, '"');
      return normalizeTitle(unescaped, maxLength);
    }
  } catch { /* ignore regex parse */ }

  // 1) JSON 解析：{ "title": "..." }
  try {
    // 宽松提取 JSON：允许跨行与额外文本；优先匹配包含 "title" 的最短片段
    const idx = text.indexOf('{');
    const lastIdx = text.lastIndexOf('}');
    if (idx !== -1 && lastIdx !== -1 && lastIdx > idx) {
      const slice = text.slice(idx, lastIdx + 1);
      // 尝试逐步收缩到包含 "title" 的片段
      const titlePos = slice.toLowerCase().indexOf('"title"');
      if (titlePos !== -1) {
        // 从开头到第一个可能的结尾进行多次尝试
        for (let end = slice.length; end > titlePos + 7; end--) {
          const candidate = slice.slice(0, end);
          try {
            const obj = JSON.parse(candidate);
            if (obj && typeof obj.title === 'string') {
              return normalizeTitle(obj.title, maxLength);
            }
          } catch { /* ignore partial parse step */ }
        }
      }
      // 直接尝试整体解析
      try {
        const obj = JSON.parse(slice);
        if (obj && typeof obj.title === 'string') {
          return normalizeTitle(obj.title, maxLength);
        }
      } catch { /* ignore full parse step */ }
    }
  } catch { /* ignore json block outer */ }

  // 2) XML/HTML 标签：<title>...</title>
  const xmlMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
  if (xmlMatch && xmlMatch[1]) {
    return normalizeTitle(xmlMatch[1], maxLength);
  }

  // 3) 形如“标题: xxx”或“Title: xxx”的行
  const line = text.split(/\r?\n/).find(l => /^(标题|Title)\s*[:：]/i.test(l));
  if (line) {
    const val = line.replace(/^(标题|Title)\s*[:：]/i, '');
    const norm = normalizeTitle(val, maxLength);
    if (norm) return norm;
  }

  return '';
}


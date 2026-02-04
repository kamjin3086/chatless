import { ChatGateway } from './ChatGateway';
import type { Message } from '@/lib/llm/types';
import { extractTitleFromOutput, normalizeTitle } from './TitleGenerator';

/**
 * 正在进行中的标题生成请求缓存
 * key: `${provider}/${model}/${seed}` 的 hash
 * value: Promise<string>
 */
const pendingTitleRequests = new Map<string, Promise<string>>();

/**
 * 已完成的标题生成结果缓存（短期缓存，避免重复请求）
 * key: seed 内容的前100字符
 * value: { title: string, timestamp: number }
 */
const titleCache = new Map<string, { title: string; timestamp: number }>();
const TITLE_CACHE_TTL_MS = 60_000; // 60秒缓存

/**
 * 生成请求的唯一 key
 */
function getRequestKey(seed: string): string {
  // 使用 seed 的前 100 字符作为 key（足够区分不同请求）
  return seed.slice(0, 100);
}

export async function generateTitle(
  provider: string,
  model: string,
  seed: string,
  opts?: { maxLength?: number; language?: 'zh'|'en' }
): Promise<string> {
  const requestKey = getRequestKey(seed);
  
  // 1. 检查是否有相同请求正在进行中
  const pending = pendingTitleRequests.get(requestKey);
  if (pending) {
    console.debug('[TitleService] 复用正在进行的标题生成请求');
    return pending;
  }
  
  // 2. 检查短期缓存（仅当缓存的标题有效时才使用）
  const cached = titleCache.get(requestKey);
  if (cached && cached.title && cached.title.trim() && Date.now() - cached.timestamp < TITLE_CACHE_TTL_MS) {
    console.debug('[TitleService] 使用缓存的标题:', cached.title);
    return cached.title;
  }
  
  // 3. 创建新的请求并缓存 Promise
  const requestPromise = (async () => {
    const max = opts?.maxLength ?? 24;
    const lang = opts?.language ?? 'zh';
    const system =
      lang === 'zh'
        ? `你是一个标题助手。请基于用户第一句消息生成一个会话标题。
严格遵循以下要求：
1) 仅输出一个 JSON 对象，格式严格为：{"title":"<标题>"}
2) 标题不超过${max}个字符，不含引号、句号、换行、表情或多余空白
3) 贴近用户原话关键词，避免过度概括
4) 不输出任何解释、前后缀、示例、思考过程或其它文本（包括 <think> 标签）
5) 直接给出 JSON，不要使用代码块标记，不要换行`
        : `You are a title assistant. Generate a title from the user's first message.
Follow these rules strictly:
1) Output ONLY a JSON object of the form {"title":"<title>"}
2) Title max ${max} chars, no quotes, punctuation, line breaks or emojis
3) Keep key phrases from the original message, avoid over-generalization
4) Do NOT output explanations, prefixes, suffixes, examples, or thoughts (including <think>)
5) Output JSON only, no code fences, no extra lines`;

    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: seed },
    ];
    const gateway = new ChatGateway({ provider, model, options: { temperature: 0.2 } });
    const { content } = await gateway.chat(messages);
    console.debug('[TitleService] 模型原始输出:', content);
    const parsed = extractTitleFromOutput(content, max);
    console.debug('[TitleService] 解析结果:', parsed, '| 归一化结果:', normalizeTitle(content, max));
    return parsed || normalizeTitle(content, max);
  })();
  
  // 将请求 Promise 添加到 pending 缓存
  pendingTitleRequests.set(requestKey, requestPromise);
  
  try {
    const title = await requestPromise;
    // 仅缓存有效的标题（非空）
    if (title && title.trim()) {
      titleCache.set(requestKey, { title, timestamp: Date.now() });
      console.debug('[TitleService] 标题生成成功并缓存:', title);
    } else {
      console.debug('[TitleService] 标题生成返回空值，不缓存');
    }
    return title;
  } finally {
    // 请求完成后从 pending 缓存中移除
    pendingTitleRequests.delete(requestKey);
  }
}


